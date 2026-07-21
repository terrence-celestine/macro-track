import { beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { MealsData } from "../../src/types.js";

/**
 * Shared harness for the menu suites.
 *
 * The menu is driven through a mocked @clack/prompts rather than real
 * keystrokes: queue up what each prompt should return, then assert on what the
 * menu did with it. That covers dispatch, looping, persistence and the
 * validation wiring. It deliberately does not cover arrow-key navigation or
 * rendering — that is clack's code, not ours.
 *
 * Each menu test file wires the mock up with:
 *
 *   vi.mock("@clack/prompts", async () => (await import("./helpers/menu.js")).clackMock)
 *
 * The factory has to use a dynamic import because vi.mock is hoisted above the
 * file's own imports, so a statically imported binding would not exist yet.
 */

/**
 * Registered globally with Symbol.for, not Symbol().
 *
 * The vi.mock factory re-imports this helper after vi.resetModules(), and a
 * plain Symbol() would mint a second, unequal one. The mock's isCancel would
 * then never match the CANCEL the test queued, so cancelling would silently
 * fall through and the menu would loop asking for more input.
 */
export const CANCEL = Symbol.for("macro-track:clack-cancel");

type MockState = {
  selectQueue: unknown[];
  textQueue: unknown[];
  confirmQueue: unknown[];
  select: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  intro: ReturnType<typeof vi.fn>;
  outro: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  logSuccess: ReturnType<typeof vi.fn>;
  logWarn: ReturnType<typeof vi.fn>;
  logMessage: ReturnType<typeof vi.fn>;
};

/**
 * Anchored on globalThis rather than held as a module const.
 *
 * These tests call vi.resetModules() constantly, and the vi.mock factory
 * re-imports this helper afterwards. Without the anchor that re-import would
 * build a second set of spies, and the test file would be asserting on one set
 * while the menu called the other.
 */
const globalKey = Symbol.for("macro-track:menu-mocks");
const globalStore = globalThis as unknown as Record<
  symbol,
  MockState | undefined
>;

export const mocks: MockState = (globalStore[globalKey] ??= {
  selectQueue: [],
  textQueue: [],
  confirmQueue: [],
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  logSuccess: vi.fn(),
  logWarn: vi.fn(),
  logMessage: vi.fn(),
});

/** The object that stands in for the @clack/prompts module. */
export const clackMock = {
  intro: mocks.intro,
  outro: mocks.outro,
  cancel: mocks.cancel,
  log: {
    success: mocks.logSuccess,
    warn: mocks.logWarn,
    message: mocks.logMessage,
  },
  // The real isCancel tests for clack's private symbol; ours stands in for it.
  isCancel: (value: unknown) => value === CANCEL,
  select: mocks.select,
  text: mocks.text,
  confirm: mocks.confirm,

  /**
   * A stand-in for clack's `group`: run each step in order, stop at the first
   * cancel and hand control to onCancel.
   *
   * This is a reimplementation, which is the one place these tests knowingly
   * trade fidelity for control — if clack changes group's contract, this mock
   * keeps passing. A pty run against the real library is what covers that.
   */
  group: async (
    steps: Record<
      string,
      (arg: { results: Record<string, unknown> }) => Promise<unknown>
    >,
    options?: {
      onCancel?: (arg: { results: Record<string, unknown> }) => void;
    },
  ) => {
    const results: Record<string, unknown> = {};

    for (const [key, step] of Object.entries(steps)) {
      const value = await step({ results });

      if (value === CANCEL) {
        options?.onCancel?.({ results });
        return results;
      }

      results[key] = value;
    }

    return results;
  },
};

/** Thrown in place of a real process.exit so a test can assert the menu bailed. */
export class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

/** Queue the values the select prompt should return, in order. */
export const queueSelect = (...values: unknown[]) =>
  mocks.selectQueue.push(...values);

/** Queue the values the text prompt should return, in order. */
export const queueText = (...values: unknown[]) =>
  mocks.textQueue.push(...values);

/** Queue the answers the confirm prompt should return, in order. */
export const queueConfirm = (...values: unknown[]) =>
  mocks.confirmQueue.push(...values);

export const meal = (over: Partial<MealsData["meals"][number]> = {}) => ({
  id: 1,
  title: "ground beef",
  cals: 200,
  protein: 14,
  carbs: 20,
  fats: 6,
  createdAt: new Date().toISOString(),
  localDate: "2026-07-19",
  ...over,
});

/** The five answers the add flow asks for, in prompt order. */
export const ADD_ANSWERS = ["ground beef", "14", "20", "6", "200"];

export function useMenuSandbox() {
  let dataDir = "";
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-menu-"));
    process.env.MACRO_TRACK_DIR = dataDir;

    mocks.selectQueue.length = 0;
    mocks.textQueue.length = 0;
    mocks.confirmQueue.length = 0;
    vi.clearAllMocks();

    mocks.select.mockImplementation(async () => {
      if (mocks.selectQueue.length === 0)
        throw new Error("select called more times than queued");
      return mocks.selectQueue.shift();
    });
    mocks.text.mockImplementation(async () => {
      if (mocks.textQueue.length === 0)
        throw new Error("text called more times than queued");
      return mocks.textQueue.shift();
    });
    mocks.confirm.mockImplementation(async () => {
      if (mocks.confirmQueue.length === 0)
        throw new Error("confirm called more times than queued");
      return mocks.confirmQueue.shift();
    });

    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new ProcessExit(code ?? 0);
    }) as never);
  });

  afterEach(async () => {
    exitSpy.mockRestore();
    delete process.env.MACRO_TRACK_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  const dataFile = () => join(dataDir, "macros.json");

  const readData = async (): Promise<MealsData> =>
    JSON.parse(await readFile(dataFile(), "utf-8"));

  /**
   * storage.ts reads MACRO_TRACK_DIR once at import time, so the env var has
   * to be set before the module graph loads. resetModules + dynamic import
   * gives each test a fresh graph pointed at its own throwaway directory.
   */
  const loadMenu = async () => {
    vi.resetModules();
    const { runMenu } = await import("../../src/menu.js");
    return runMenu;
  };

  /**
   * Writes starting data for a test. Resets the graph first for the same
   * reason loadMenu does — a cached storage module is still bound to whichever
   * temp directory was live when it was first imported.
   */
  const seed = async (data: Partial<MealsData>) => {
    vi.resetModules();
    const { writeData, defaultData } = await import("../../src/storage.js");
    await writeData({ ...defaultData(), ...data });
  };

  // A getter, not the spy itself: the spy is created fresh in beforeEach, so
  // destructuring a plain value here would capture undefined.
  return { loadMenu, seed, readData, dataFile, getExitSpy: () => exitSpy };
}
