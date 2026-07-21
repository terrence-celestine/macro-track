import { beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { MealsData } from "../../src/types.js";

/**
 * Shared harness for the in-process suites — the ones that call src functions
 * directly rather than spawning the CLI.
 *
 * storage.ts reads MACRO_TRACK_DIR once, at module load, to build its data
 * directory. Setting the env var after the module is imported has no effect, so
 * every one of these helpers resets the module registry first and re-imports.
 * Getting that wrong is silent: the test writes to a directory left over from a
 * previous file and its assertions quietly stop meaning anything.
 */
export function useDataSandbox(label: string) {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), `macro-track-${label}-`));
    process.env.MACRO_TRACK_DIR = dataDir;
  });

  afterEach(async () => {
    // Suites that fake timers do it per-test; restoring here means no file has
    // to remember to.
    vi.useRealTimers();
    delete process.env.MACRO_TRACK_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  const dataFile = () => join(dataDir, "macros.json");

  /** Writes starting data, filling in defaults for whatever is not given. */
  const seed = async (data: Partial<MealsData>) => {
    vi.resetModules();
    const { writeData, defaultData } = await import("../../src/storage.js");
    await writeData({ ...defaultData(), ...data });
  };

  /** Reads the whole file back, through the same defaults-merge as the app. */
  const readAll = async (): Promise<MealsData> => {
    vi.resetModules();
    const { readData } = await import("../../src/storage.js");
    return readData();
  };

  return { seed, readAll, dataFile };
}

/**
 * Resets the module registry so the next dynamic import binds to the current
 * MACRO_TRACK_DIR.
 *
 * Each suite keeps its own one-line `load` that calls this and then imports the
 * module under test — a shared generic loader would take the path as a string
 * and lose the return type.
 */
export const freshModules = () => vi.resetModules();
