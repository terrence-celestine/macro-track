import { describe, it, expect } from "vitest";

import { useCliSandbox, ADD_ARGS } from "./helpers/cli.js";

const { run, readData, writeData } = useCliSandbox();

/**
 * Puts weigh-ins on specific days.
 *
 * Written straight to the file because `weigh` only ever records today — there
 * is no CLI path that produces a multi-day series.
 */
const seedWeights = async (...days: [string, number][]) => {
  // One real weigh-in first, so the data file exists to be rewritten.
  await run("weigh", "180");
  const data = await readData();
  data.weights = days.map(([date, weight]) => ({
    date,
    weight,
    recordedAt: `${date}T08:00:00.000Z`,
  }));
  await writeData(data);
};

describe("weigh", () => {
  it("records a weight and exits 0", async () => {
    const { code, stdout } = await run("weigh", "182.4");

    expect(code).toBe(0);
    expect(stdout).toContain("182.4");
    expect((await readData()).weights).toHaveLength(1);
  });

  it("dates the entry today", async () => {
    await run("weigh", "182.4");

    const { weights } = await readData();
    expect(weights[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("replaces an earlier reading the same day", async () => {
    await run("weigh", "182.4");
    await run("weigh", "181.8");

    const { weights } = await readData();
    expect(weights).toHaveLength(1);
    expect(weights[0].weight).toBe(181.8);
  });

  it("accepts a decimal", async () => {
    await run("weigh", "82.35");

    expect((await readData()).weights[0].weight).toBe(82.35);
  });

  it("rejects a non-numeric weight", async () => {
    expect((await run("weigh", "abc")).code).not.toBe(0);
  });

  it("rejects a negative weight", async () => {
    expect((await run("weigh", "-4")).code).not.toBe(0);
  });

  it("requires a value", async () => {
    expect((await run("weigh")).code).not.toBe(0);
  });
});

describe("weight", () => {
  it("reports nothing recorded yet", async () => {
    const { code, stdout } = await run("weight");

    expect(code).toBe(0);
    expect(stdout).toContain("No weigh-ins yet");
  });

  it("does not create a data file just by asking", async () => {
    await run("weight");

    await expect(readData()).rejects.toThrow();
  });

  it("shows the entry and its average", async () => {
    await run("weigh", "182.4");

    const { stdout } = await run("weight");

    expect(stdout).toContain("182.4");
    expect(stdout).toContain("average");
  });

  it("averages across recorded days", async () => {
    await seedWeights(
      ["2026-07-17", 180],
      ["2026-07-18", 182],
      ["2026-07-19", 184],
    );

    const { stdout } = await run("weight");

    expect(stdout).toContain("182");
  });

  it("lists newest first", async () => {
    await seedWeights(["2026-07-17", 180], ["2026-07-19", 184]);

    const { stdout } = await run("weight");

    expect(stdout.indexOf("2026-07-19")).toBeLessThan(
      stdout.indexOf("2026-07-17"),
    );
  });

  it("honours --days", async () => {
    await seedWeights(["2026-07-17", 180], ["2026-07-19", 184]);

    const { stdout } = await run("weight", "--days", "1");

    expect(stdout).toContain("2026-07-19");
    expect(stdout).not.toContain("2026-07-17");
  });

  it("leaves the data file unchanged", async () => {
    await run("weigh", "182.4");
    const before = await readData();

    await run("weight");

    expect(await readData()).toEqual(before);
  });

  it("survives clearing the meal log", async () => {
    await run(...ADD_ARGS);
    await run("weigh", "182.4");

    await run("clear");

    expect((await readData()).weights).toHaveLength(1);
  });
});

describe("weight remove", () => {
  it("forgets one day's weigh-in", async () => {
    await seedWeights(["2026-07-17", 180], ["2026-07-19", 184]);

    const { code } = await run("weight", "remove", "2026-07-17");

    expect(code).toBe(0);
    expect((await readData()).weights.map((w) => w.date)).toEqual([
      "2026-07-19",
    ]);
  });

  it("exits non-zero for a day with nothing recorded", async () => {
    const { code, stderr } = await run("weight", "remove", "2020-01-01");

    expect(code).not.toBe(0);
    expect(stderr).toContain("2020-01-01");
  });

  it("requires a date", async () => {
    expect((await run("weight", "remove")).code).not.toBe(0);
  });

  it("leaves the bare weight listing working", async () => {
    // `show` is a default subcommand, so adding `remove` must not have turned
    // plain `weight` into an unknown-command error.
    await seedWeights(["2026-07-19", 184]);

    const { code, stdout } = await run("weight");

    expect(code).toBe(0);
    expect(stdout).toContain("184");
  });

  it("leaves --days working on the bare listing", async () => {
    await seedWeights(["2026-07-17", 180], ["2026-07-19", 184]);

    const { stdout } = await run("weight", "--days", "1");

    expect(stdout).toContain("2026-07-19");
    expect(stdout).not.toContain("2026-07-17");
  });
});
