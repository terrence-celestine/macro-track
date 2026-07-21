import { beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

import type { MealsData } from "../../src/types.js";

/**
 * Shared harness for the subprocess tests.
 *
 * Every CLI suite runs the real binary against its own throwaway data
 * directory. Calling useCliSandbox() in a file registers the per-test setup and
 * returns the handles that need the current directory.
 */

const exec = promisify(execFile);
const CLI = resolve(__dirname, "../../src/index.ts");
const TSX = resolve(__dirname, "../../node_modules/.bin/tsx");

export type Result = { code: number; stdout: string; stderr: string };

export const ADD_ARGS = [
  "add",
  "ground beef",
  "-p",
  "14",
  "-c",
  "20",
  "-f",
  "6",
  "-k",
  "200",
];

/** What the local day is in a given timezone, right now. "en-CA" is YYYY-MM-DD. */
export const localDayIn = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function useCliSandbox() {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-cli-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const dataFile = () => join(dataDir, "macros.json");

  /**
   * Runs the real CLI as a subprocess against the throwaway data directory.
   * MACRO_TRACK_DIR is the only injection point that works here — there is no
   * function to pass a path to across a process boundary.
   */
  const runWithEnv = async (
    extra: Record<string, string>,
    ...args: string[]
  ): Promise<Result> => {
    const env = {
      ...process.env,
      MACRO_TRACK_DIR: dataDir,
      NO_COLOR: "1",
      ...extra,
    };
    try {
      const { stdout, stderr } = await exec(TSX, [CLI, ...args], { env });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        code: e.code ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      };
    }
  };

  const run = (...args: string[]): Promise<Result> => runWithEnv({}, ...args);

  const readData = async (): Promise<MealsData> =>
    JSON.parse(await readFile(dataFile(), "utf-8"));

  /** Writes the data file directly, for setting up states the CLI can't produce. */
  const writeData = async (data: MealsData) =>
    writeFile(dataFile(), JSON.stringify(data), "utf-8");

  /**
   * Rewrites *every* stored meal onto a given local day, simulating a past
   * day. Tests that need to backdate only one meal read, mutate and call
   * writeData themselves — that is a different operation.
   */
  const backdateMeals = async (date: string) => {
    const data = await readData();
    for (const meal of data.meals) meal.localDate = date;
    await writeData(data);
  };

  return { run, runWithEnv, readData, writeData, backdateMeals, dataFile };
}
