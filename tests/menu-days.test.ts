import { describe, it, expect, vi } from "vitest";
import { existsSync } from "fs";

vi.mock(
  "@clack/prompts",
  async () => (await import("./helpers/menu.js")).clackMock,
);

import {
  useMenuSandbox,
  mocks,
  meal,
  queueSelect,
  queueText,
} from "./helpers/menu.js";

const { loadMenu, seed, readData, dataFile } = useMenuSandbox();

describe("menu: today", () => {
  it("prints totals with nothing logged", async () => {
    queueSelect("today", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("Nothing logged yet today"),
    );
  });

  it("sums today's meals", async () => {
    const { todayLocalDate } = await import("../src/date.js");
    const today = todayLocalDate();
    await seed({
      meals: [
        meal({ localDate: today }),
        meal({
          id: 2,
          title: "rice",
          protein: 4,
          carbs: 45,
          fats: 1,
          cals: 200,
          localDate: today,
        }),
      ],
      nextId: 3,
    });
    queueSelect("today", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("2 meals");
    expect(printed).toContain("400");
    expect(printed).toContain("18");
  });

  it("excludes meals from other days", async () => {
    await seed({ meals: [meal({ localDate: "2020-01-01" })], nextId: 2 });
    queueSelect("today", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("Nothing logged yet today"),
    );
    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).not.toContain("ground beef");
  });

  it("lists today's meals after the totals", async () => {
    const { todayLocalDate } = await import("../src/date.js");
    await seed({ meals: [meal({ localDate: todayLocalDate() })], nextId: 2 });
    queueSelect("today", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed.indexOf("Calories")).toBeLessThan(
      printed.indexOf("ground beef"),
    );
  });
});

describe("menu: today against goals", () => {
  it("shows remaining once a goal is set", async () => {
    const { todayLocalDate } = await import("../src/date.js");
    await seed({
      meals: [meal({ localDate: todayLocalDate() })],
      nextId: 2,
      goals: { protein: 180 },
    });
    queueSelect("today", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("166");
    expect(printed).toContain("left");
  });
});

describe("menu: goals", () => {
  it("stores what was entered", async () => {
    queueSelect("goals", "exit");
    queueText("2000", "180", "200", "60");

    await (
      await loadMenu()
    )();

    const { getGoals } = await import("../src/commands.js");
    expect(await getGoals()).toEqual({
      cals: 2000,
      protein: 180,
      carbs: 200,
      fats: 60,
    });
  });

  it("treats a blank answer as leave-this-alone", async () => {
    await seed({ goals: { protein: 180, cals: 2000 } });
    queueSelect("goals", "exit");
    queueText("", "", "200", "");

    await (
      await loadMenu()
    )();

    const { getGoals } = await import("../src/commands.js");
    expect(await getGoals()).toEqual({ protein: 180, cals: 2000, carbs: 200 });
  });

  it("pre-fills the prompt with the current target", async () => {
    await seed({ goals: { protein: 180 } });
    queueSelect("goals", "exit");
    queueText("", "", "", "");

    await (
      await loadMenu()
    )();

    const proteinPrompt = mocks.text.mock.calls
      .map(([opts]) => opts as { message: string; placeholder?: string })
      .find((o) => o.message.startsWith("Protein target"))!;

    expect(proteinPrompt.placeholder).toBe("180");
  });

  it("asks for all four targets", async () => {
    queueSelect("goals", "exit");
    queueText("", "", "", "");

    await (
      await loadMenu()
    )();

    expect(mocks.text).toHaveBeenCalledTimes(4);
  });

  it("validates entered targets", async () => {
    queueSelect("goals", "exit");
    queueText("", "", "", "");

    await (
      await loadMenu()
    )();

    const validate = (
      mocks.text.mock.calls[0][0] as {
        validate: (v: string) => string | undefined;
      }
    ).validate;
    expect(validate("abc")).toBeTruthy();
    expect(validate("-4")).toBeTruthy();
    // Blank is how you skip, so it must not be rejected.
    expect(validate("")).toBeUndefined();
  });
});

describe("menu: weight", () => {
  const weighIn = (date: string, weight: number) => ({
    date,
    weight,
    recordedAt: `${date}T08:00:00.000Z`,
  });

  it("records what was entered", async () => {
    queueSelect("weigh", "exit");
    queueText("182.4");

    await (
      await loadMenu()
    )();

    const { weights } = await readData();
    expect(weights).toHaveLength(1);
    expect(weights[0].weight).toBe(182.4);
  });

  it("validates the entered weight", async () => {
    queueSelect("weigh", "exit");
    queueText("182.4");

    await (
      await loadMenu()
    )();

    const [opts] = mocks.text.mock.calls[0] as [
      { validate: (v: string) => string | undefined },
    ];
    expect(opts.validate("abc")).toBeTruthy();
    expect(opts.validate("-4")).toBeTruthy();
    expect(opts.validate("182.4")).toBeUndefined();
  });

  it("says so when nothing is recorded", async () => {
    queueSelect("weight", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("No weigh-ins yet");
  });

  it("shows recent weigh-ins with the average", async () => {
    await seed({
      weights: [weighIn("2026-07-18", 180), weighIn("2026-07-19", 184)],
    });
    queueSelect("weight", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("182");
    expect(printed).toContain("2026-07-19");
  });
});

describe("menu: history", () => {
  const day = (date: string, hit: boolean | null) => ({
    date,
    totals: { protein: 100, carbs: 150, fats: 40, cals: 1500 },
    goals: {},
    hit,
    mealCount: 2,
    closedAt: "2026-07-19T00:00:00.000Z",
  });

  it("says so when nothing is closed", async () => {
    queueSelect("history", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("No days closed yet");
  });

  it("lists closed days, most recent first", async () => {
    await seed({ days: [day("2026-07-17", true), day("2026-07-18", false)] });
    queueSelect("history", "exit");

    await (
      await loadMenu()
    )();

    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed.indexOf("2026-07-18")).toBeLessThan(
      printed.indexOf("2026-07-17"),
    );
  });
});

describe("menu: list", () => {
  it("warns when there is nothing logged", async () => {
    queueSelect("list", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("no meals"),
    );
  });

  it("prints a line per meal", async () => {
    await seed({ meals: [meal(), meal({ id: 2, title: "rice" })], nextId: 3 });
    queueSelect("list", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.logMessage).toHaveBeenCalledTimes(2);
    const printed = mocks.logMessage.mock.calls
      .map(([line]) => line)
      .join("\n");
    expect(printed).toContain("ground beef");
    expect(printed).toContain("rice");
  });

  it("leaves the data file unchanged", async () => {
    await seed({ meals: [meal()], nextId: 2 });
    const before = await readData();
    queueSelect("list", "exit");

    await (
      await loadMenu()
    )();

    expect(await readData()).toEqual(before);
  });
});

describe("menu: clear", () => {
  it("removes all meals and resets the counter", async () => {
    await seed({ meals: [meal(), meal({ id: 2, title: "rice" })], nextId: 3 });
    queueSelect("clear", "exit");

    await (
      await loadMenu()
    )();

    expect(await readData()).toEqual({
      meals: [],
      nextId: 1,
      goals: {},
      days: [],
      favorites: [],
      weights: [],
    });
  });

  it("warns and writes nothing when there is nothing to clear", async () => {
    queueSelect("clear", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("no meals to clear"),
    );
    expect(existsSync(dataFile())).toBe(false);
  });

  it("lets meals be added again afterwards", async () => {
    await seed({ meals: [meal()], nextId: 2 });
    queueSelect("clear", "add", "exit");
    queueText("rice", "4", "45", "1", "200");

    await (
      await loadMenu()
    )();

    const data = await readData();
    expect(data.meals).toHaveLength(1);
    expect(data.meals[0].id).toBe(1);
  });
});
