import { describe, it, expect } from "vitest";

import { useCliSandbox, ADD_ARGS } from "./helpers/cli.js";

const { run, readData } = useCliSandbox();

describe("clear", () => {
  it("removes all meals and resets the counter", async () => {
    await run(...ADD_ARGS);

    const { code } = await run("clear");

    expect(code).toBe(0);
    expect(await readData()).toEqual({
      meals: [],
      nextId: 1,
      goals: {},
      days: [],
      favorites: [],
      weights: [],
    });
  });

  it("exits 0 when there is nothing to clear", async () => {
    const { code } = await run("clear");

    expect(code).toBe(0);
  });

  it("says nothing to clear, and does not also claim it cleared", async () => {
    const { stdout } = await run("clear");

    // Regression: a missing early return printed the warning and then
    // "You cleared all your meals" immediately after it.
    expect(stdout).toContain("no meals to clear");
    expect(stdout).not.toContain("You cleared all your meals");
  });

  it("confirms only when it actually cleared something", async () => {
    await run(...ADD_ARGS);

    const { stdout } = await run("clear");

    expect(stdout).toContain("You cleared all your meals");
    expect(stdout).not.toContain("no meals to clear");
  });

  it("lets meals be added again afterwards", async () => {
    await run(...ADD_ARGS);
    await run("clear");
    await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200");

    const data = await readData();
    expect(data.meals).toHaveLength(1);
    expect(data.meals[0].id).toBe(1);
  });
});

describe("no arguments without a terminal", () => {
  /**
   * The subprocess runner never gives the child a TTY, so these run through
   * exactly the path a cron job or a pipe would take.
   */
  it("prints help instead of hanging", async () => {
    // Regression: the menu used to open regardless, and clack would then
    // wait forever for keypresses from a stdin that has none.
    const { stdout } = await run();

    expect(stdout).toContain("Usage: macro-track");
  });

  it("exits 0", async () => {
    expect((await run()).code).toBe(0);
  });

  it("lists the commands", async () => {
    const { stdout } = await run();

    expect(stdout).toContain("add");
    expect(stdout).toContain("today");
    expect(stdout).toContain("repeat");
  });

  it("writes nothing", async () => {
    await run();

    await expect(readData()).rejects.toThrow();
  });
});

describe("program", () => {
  it("exits non-zero on an unknown command", async () => {
    const { code } = await run("frobnicate");

    expect(code).not.toBe(0);
  });

  it("prints help", async () => {
    const { code, stdout } = await run("--help");

    expect(code).toBe(0);
    expect(stdout).toContain("add");
    expect(stdout).toContain("list");
    expect(stdout).toContain("clear");
    expect(stdout).toContain("today");
  });

  it("prints a version", async () => {
    const { stdout } = await run("--version");

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
