import { describe, it, expect } from "vitest";

import type { Goals } from "../src/types.js";
import { useDataSandbox, freshModules } from "./helpers/data.js";
import { meal } from "./helpers/fixtures.js";

/**
 * Goals merge rather than replace, so most of what matters here is what a
 * partial update leaves alone. Same module-reset pattern as the other
 * in-process suites — storage.ts binds its directory at import time.
 */

const { seed, dataFile } = useDataSandbox("goals");

/** Writes the file byte-for-byte, for shapes seed() would fill in. */
const writeRaw = async (json: string) =>
  (await import("fs/promises")).writeFile(dataFile(), json, "utf-8");

const load = async () => {
  freshModules();
  return import("../src/commands.js");
};

const FULL_GOALS: Goals = { protein: 180, carbs: 200, fats: 60, cals: 2000 };

describe("getGoals", () => {
  it("is empty before anything is set", async () => {
    const { getGoals } = await load();

    expect(await getGoals()).toEqual({});
  });

  it("is empty for a data file written before goals existed", async () => {
    // Backward compatibility: storage merges over defaults, so an older
    // file with no goals key must still read cleanly.
    await writeRaw(JSON.stringify({ meals: [meal()], nextId: 2 }));
    const { getGoals } = await load();

    expect(await getGoals()).toEqual({});
  });

  it("returns what was stored", async () => {
    await seed({ goals: FULL_GOALS });
    const { getGoals } = await load();

    expect(await getGoals()).toEqual(FULL_GOALS);
  });
});

describe("setGoals", () => {
  it("stores a full set", async () => {
    const { setGoals, getGoals } = await load();

    await setGoals(FULL_GOALS);

    expect(await getGoals()).toEqual(FULL_GOALS);
  });

  it("stores a single macro", async () => {
    const { setGoals, getGoals } = await load();

    await setGoals({ protein: 180 });

    expect(await getGoals()).toEqual({ protein: 180 });
  });

  it("merges rather than replaces", async () => {
    await seed({ goals: { protein: 180, cals: 2000 } });
    const { setGoals } = await load();

    expect(await setGoals({ carbs: 200 })).toEqual({
      protein: 180,
      cals: 2000,
      carbs: 200,
    });
  });

  it("overwrites a macro that already had a target", async () => {
    await seed({ goals: { protein: 180 } });
    const { setGoals } = await load();

    expect(await setGoals({ protein: 200 })).toEqual({ protein: 200 });
  });

  it("does not erase existing targets with undefined", async () => {
    await seed({ goals: FULL_GOALS });
    const { setGoals } = await load();

    // This is the shape commander hands over when only -c is passed: every
    // other key is present but undefined. A naive spread would blank them.
    const after = await setGoals({
      protein: undefined,
      carbs: 250,
      fats: undefined,
      cals: undefined,
    });

    expect(after).toEqual({ ...FULL_GOALS, carbs: 250 });
  });

  it("accepts zero as a target", async () => {
    const { setGoals, getGoals } = await load();

    await setGoals({ carbs: 0 });

    // Zero carbs is a real target and must survive; only undefined means
    // "leave this alone".
    expect(await getGoals()).toEqual({ carbs: 0 });
  });

  it("leaves meals untouched", async () => {
    await seed({ meals: [meal()], nextId: 2 });
    const { setGoals, listMeals } = await load();

    await setGoals({ protein: 180 });

    expect(await listMeals()).toHaveLength(1);
  });
});

describe("clearGoals", () => {
  it("removes every target", async () => {
    await seed({ goals: FULL_GOALS });
    const { clearGoals, getGoals } = await load();

    await clearGoals();

    expect(await getGoals()).toEqual({});
  });

  it("leaves meals untouched", async () => {
    await seed({ meals: [meal()], nextId: 2, goals: FULL_GOALS });
    const { clearGoals, listMeals } = await load();

    await clearGoals();

    expect(await listMeals()).toHaveLength(1);
  });
});

describe("clearMeals and goals", () => {
  it("keeps goals when the meal log is wiped", async () => {
    await seed({ meals: [meal()], nextId: 2, goals: FULL_GOALS });
    const { clearMeals, getGoals, listMeals } = await load();

    await clearMeals();

    // Clearing what you ate should not silently discard the targets you set.
    expect(await listMeals()).toEqual([]);
    expect(await getGoals()).toEqual(FULL_GOALS);
  });
});

describe("hasGoals", () => {
  it("is false for an empty object", async () => {
    const { hasGoals } = await load();

    expect(hasGoals({})).toBe(false);
  });

  it("is true when any macro is set", async () => {
    const { hasGoals } = await load();

    expect(hasGoals({ protein: 180 })).toBe(true);
  });

  it("is true for a target of zero", async () => {
    const { hasGoals } = await load();

    expect(hasGoals({ carbs: 0 })).toBe(true);
  });
});

describe("formatGoals", () => {
  it("says so when nothing is set", async () => {
    const { formatGoals } = await load();

    expect(formatGoals({}).join("\n")).toContain("No goals set");
  });

  it("lists every target that is set", async () => {
    const { formatGoals } = await load();

    const text = formatGoals(FULL_GOALS).join("\n");

    expect(text).toContain("2000");
    expect(text).toContain("180");
    expect(text).toContain("200");
    expect(text).toContain("60");
  });

  it("omits macros with no target", async () => {
    const { formatGoals } = await load();

    const text = formatGoals({ protein: 180 }).join("\n");

    expect(text).toContain("Protein");
    expect(text).not.toContain("Carbs");
    expect(text).not.toContain("Fats");
  });
});

describe("formatTotals against goals", () => {
  const totals = { protein: 100, carbs: 150, fats: 40, cals: 1200 };

  it("shows what is left when under the target", async () => {
    const { formatTotals } = await load();

    const text = formatTotals(totals, 3, { protein: 180 }).join("\n");

    expect(text).toContain("80");
    expect(text).toContain("left");
  });

  it("shows the overage when past the target", async () => {
    const { formatTotals } = await load();

    const text = formatTotals(totals, 3, { protein: 80 }).join("\n");

    expect(text).toContain("20");
    expect(text).toContain("over");
  });

  it("treats hitting the target exactly as zero left, not over", async () => {
    const { formatTotals } = await load();

    const text = formatTotals(totals, 3, { protein: 100 }).join("\n");

    expect(text).toContain("left");
    expect(text).not.toContain("over");
  });

  it("leaves macros without a target unannotated", async () => {
    const { formatTotals } = await load();

    const lines = formatTotals(totals, 3, { protein: 180 });
    const carbsLine = lines.find((l) => l.includes("Carbs"))!;

    expect(carbsLine).not.toContain("left");
    expect(carbsLine).not.toContain("/");
  });

  it("renders unchanged when no goals are set at all", async () => {
    const { formatTotals } = await load();

    expect(formatTotals(totals, 3, {})).toEqual(formatTotals(totals, 3));
  });

  it("shows the full target alongside the running value", async () => {
    const { formatTotals } = await load();

    const proteinLine = formatTotals(totals, 3, { protein: 180 }).find((l) =>
      l.includes("Protein"),
    )!;

    expect(proteinLine).toContain("100");
    expect(proteinLine).toContain("180");
  });
});
