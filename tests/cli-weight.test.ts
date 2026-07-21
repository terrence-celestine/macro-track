import { describe, it, expect } from "vitest";

import { useCliSandbox, ADD_ARGS } from "./helpers/cli.js";

const { run, readData, writeData } = useCliSandbox();

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
    // Written directly because the CLI only ever records today.
    await run("weigh", "180");
    const data = await readData();
    data.weights = [
      {
        date: "2026-07-17",
        weight: 180,
        recordedAt: "2026-07-17T08:00:00.000Z",
      },
      {
        date: "2026-07-18",
        weight: 182,
        recordedAt: "2026-07-18T08:00:00.000Z",
      },
      {
        date: "2026-07-19",
        weight: 184,
        recordedAt: "2026-07-19T08:00:00.000Z",
      },
    ];
    await writeData(data);

    const { stdout } = await run("weight");

    expect(stdout).toContain("182");
  });

  it("lists newest first", async () => {
    await run("weigh", "180");
    const data = await readData();
    data.weights = [
      {
        date: "2026-07-17",
        weight: 180,
        recordedAt: "2026-07-17T08:00:00.000Z",
      },
      {
        date: "2026-07-19",
        weight: 184,
        recordedAt: "2026-07-19T08:00:00.000Z",
      },
    ];
    await writeData(data);

    const { stdout } = await run("weight");

    expect(stdout.indexOf("2026-07-19")).toBeLessThan(
      stdout.indexOf("2026-07-17"),
    );
  });

  it("honours --days", async () => {
    await run("weigh", "180");
    const data = await readData();
    data.weights = [
      {
        date: "2026-07-17",
        weight: 180,
        recordedAt: "2026-07-17T08:00:00.000Z",
      },
      {
        date: "2026-07-19",
        weight: 184,
        recordedAt: "2026-07-19T08:00:00.000Z",
      },
    ];
    await writeData(data);

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
