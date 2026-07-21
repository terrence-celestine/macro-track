import { describe, it, expect, vi } from "vitest";
import { existsSync } from "fs";

import type { WeighIn } from "../src/types.js";
import { useDataSandbox, freshModules } from "./helpers/data.js";
import { weighIn } from "./helpers/fixtures.js";

/**
 * Weight is one number per local day. The interesting parts are same-day
 * replacement and the trailing average, which is deliberately over recorded
 * weigh-ins rather than calendar days — a skipped Tuesday should widen the
 * window, not drag the mean toward nothing.
 */

const { seed, readAll, dataFile } = useDataSandbox("weight");

const load = async () => {
  freshModules();
  return import("../src/weight.js");
};

/** A run of consecutive days, oldest first. */
const series = (weights: number[], startDay = 1): WeighIn[] =>
  weights.map((w, i) =>
    weighIn(`2026-07-${String(startDay + i).padStart(2, "0")}`, w),
  );

describe("recordWeight", () => {
  it("stores the weight", async () => {
    const { recordWeight } = await load();

    await recordWeight(182.4, "2026-07-19");

    expect((await readAll()).weights).toHaveLength(1);
  });

  it("returns the entry it stored", async () => {
    const { recordWeight } = await load();

    expect(await recordWeight(182.4, "2026-07-19")).toMatchObject({
      date: "2026-07-19",
      weight: 182.4,
    });
  });

  it("keeps the number exactly as given", async () => {
    const { recordWeight } = await load();

    await recordWeight(82.35, "2026-07-19");

    // No unit, no rounding at the storage layer — display rounds, data does not.
    expect((await readAll()).weights[0].weight).toBe(82.35);
  });

  it("stamps a parseable recordedAt", async () => {
    const { recordWeight } = await load();

    const { recordedAt } = await recordWeight(182.4, "2026-07-19");
    expect(Number.isNaN(Date.parse(recordedAt))).toBe(false);
  });

  it("replaces an earlier reading for the same day", async () => {
    await seed({ weights: [weighIn("2026-07-19", 182.4)] });
    const { recordWeight } = await load();

    await recordWeight(181.8, "2026-07-19");

    const { weights } = await readAll();
    expect(weights).toHaveLength(1);
    expect(weights[0].weight).toBe(181.8);
  });

  it("keeps other days when replacing one", async () => {
    await seed({
      weights: [weighIn("2026-07-18", 183), weighIn("2026-07-19", 182.4)],
    });
    const { recordWeight } = await load();

    await recordWeight(181.8, "2026-07-19");

    const { weights } = await readAll();
    expect(weights).toHaveLength(2);
    expect(weights.find((w) => w.date === "2026-07-18")!.weight).toBe(183);
  });

  it("defaults to today's local day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 19, 8, 0));
    const { recordWeight } = await load();

    expect((await recordWeight(182.4)).date).toBe("2026-07-19");
  });

  it("accepts zero without treating it as missing", async () => {
    const { recordWeight } = await load();

    await recordWeight(0, "2026-07-19");

    expect((await readAll()).weights[0].weight).toBe(0);
  });

  it("leaves meals and goals alone", async () => {
    await seed({ goals: { protein: 180 } });
    const { recordWeight } = await load();

    await recordWeight(182.4, "2026-07-19");

    const data = await readAll();
    expect(data.goals).toEqual({ protein: 180 });
    expect(data.meals).toEqual([]);
  });
});

describe("getWeights", () => {
  it("is empty before anything is recorded", async () => {
    const { getWeights } = await load();

    expect(await getWeights()).toEqual([]);
  });

  it("returns oldest first regardless of stored order", async () => {
    await seed({
      weights: [
        weighIn("2026-07-19", 182),
        weighIn("2026-07-17", 184),
        weighIn("2026-07-18", 183),
      ],
    });
    const { getWeights } = await load();

    expect((await getWeights()).map((w) => w.date)).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
  });

  it("does not reorder what is on disk", async () => {
    await seed({
      weights: [weighIn("2026-07-19", 182), weighIn("2026-07-17", 184)],
    });
    const { getWeights } = await load();

    await getWeights();

    expect((await readAll()).weights.map((w) => w.date)).toEqual([
      "2026-07-19",
      "2026-07-17",
    ]);
  });
});

describe("removeWeight", () => {
  it("forgets one day", async () => {
    await seed({
      weights: [weighIn("2026-07-18", 183), weighIn("2026-07-19", 182)],
    });
    const { removeWeight, getWeights } = await load();

    expect(await removeWeight("2026-07-19")).toBe(true);
    expect((await getWeights()).map((w) => w.date)).toEqual(["2026-07-18"]);
  });

  it("reports a day with nothing recorded", async () => {
    await seed({ weights: [weighIn("2026-07-18", 183)] });
    const { removeWeight } = await load();

    expect(await removeWeight("2020-01-01")).toBe(false);
  });

  it("writes nothing when there was nothing to remove", async () => {
    const { removeWeight } = await load();

    await removeWeight("2020-01-01");

    expect(existsSync(dataFile())).toBe(false);
  });
});

describe("trailingAverage", () => {
  it("is null with no weigh-ins", async () => {
    const { trailingAverage } = await load();

    // No honest number to show, which is different from zero.
    expect(trailingAverage([])).toBeNull();
  });

  it("is the value itself for a single weigh-in", async () => {
    const { trailingAverage } = await load();

    expect(trailingAverage(series([182]))).toBe(182);
  });

  it("averages fewer than a full window", async () => {
    const { trailingAverage } = await load();

    expect(trailingAverage(series([180, 182, 184]))).toBe(182);
  });

  it("uses only the last window when there are more", async () => {
    const { trailingAverage } = await load();

    // Ten readings, window of 7: the first three must not count.
    const weights = series([100, 100, 100, 200, 200, 200, 200, 200, 200, 200]);
    expect(trailingAverage(weights, 7)).toBe(200);
  });

  it("counts recorded weigh-ins, not calendar days", async () => {
    const { trailingAverage } = await load();

    // A gap in the dates must not shrink the window or dilute the mean.
    const sparse = [
      weighIn("2026-07-01", 180),
      weighIn("2026-07-10", 182),
      weighIn("2026-07-20", 184),
    ];
    expect(trailingAverage(sparse, 3)).toBe(182);
  });

  it("honours a custom window", async () => {
    const { trailingAverage } = await load();

    expect(trailingAverage(series([100, 100, 200, 200]), 2)).toBe(200);
  });
});

describe("trailingChange", () => {
  it("is null without two full windows", async () => {
    const { trailingChange } = await load();

    // Comparing half-empty or overlapping windows would produce a number
    // that looks meaningful and is not.
    expect(trailingChange(series([180, 181, 182]), 7)).toBeNull();
    expect(trailingChange(series(Array(13).fill(180)), 7)).toBeNull();
  });

  it("compares the last window against the one before it", async () => {
    const { trailingChange } = await load();

    const weights = series([...Array(7).fill(180), ...Array(7).fill(178)]);
    expect(trailingChange(weights, 7)).toBe(-2);
  });

  it("is positive when weight went up", async () => {
    const { trailingChange } = await load();

    const weights = series([...Array(3).fill(180), ...Array(3).fill(183)]);
    expect(trailingChange(weights, 3)).toBe(3);
  });

  it("is zero when the windows match", async () => {
    const { trailingChange } = await load();

    expect(trailingChange(series(Array(6).fill(180)), 3)).toBe(0);
  });

  it("ignores readings older than the two windows", async () => {
    const { trailingChange } = await load();

    const weights = series([999, ...Array(3).fill(180), ...Array(3).fill(178)]);
    expect(trailingChange(weights, 3)).toBe(-2);
  });
});

describe("weight output", () => {
  it("says so when nothing is recorded", async () => {
    const { formatWeights } = await import("../src/format.js");

    expect(formatWeights([], null, null, 14).join("\n")).toContain(
      "No weigh-ins yet",
    );
  });

  it("leads with the trailing average", async () => {
    const { formatWeights } = await import("../src/format.js");

    const text = formatWeights(series([182]), 182, null, 14).join("\n");

    expect(text).toContain("average");
    expect(text).toContain("182");
  });

  it("omits the change line when there is not enough history", async () => {
    const { formatWeights } = await import("../src/format.js");

    const text = formatWeights(series([182]), 182, null, 14).join("\n");

    expect(text).not.toContain("previous week");
  });

  it("says which way the trend moved", async () => {
    const { formatWeights } = await import("../src/format.js");

    const down = formatWeights(series([182]), 182, -1.5, 14).join("\n");
    const up = formatWeights(series([182]), 182, 1.5, 14).join("\n");

    expect(down).toContain("down 1.5");
    expect(up).toContain("up 1.5");
  });

  it("reads flat rather than 'up 0' when unchanged", async () => {
    const { formatWeights } = await import("../src/format.js");

    expect(formatWeights(series([182]), 182, 0, 14).join("\n")).toContain(
      "flat",
    );
  });

  it("lists newest first", async () => {
    const { formatWeights } = await import("../src/format.js");

    const text = formatWeights(series([180, 181, 182]), 181, null, 14).join(
      "\n",
    );

    expect(text.indexOf("2026-07-03")).toBeLessThan(text.indexOf("2026-07-01"));
  });

  it("honours the list limit", async () => {
    const { formatWeights } = await import("../src/format.js");

    const text = formatWeights(series([180, 181, 182]), 181, null, 2).join(
      "\n",
    );

    expect(text).toContain("2026-07-03");
    expect(text).not.toContain("2026-07-01");
  });

  it("rounds display without touching stored precision", async () => {
    const { formatWeights } = await import("../src/format.js");

    const text = formatWeights(series([182]), 181.66666, null, 14).join("\n");

    expect(text).toContain("181.7");
  });
});

describe("clear and weight", () => {
  it("keeps weigh-ins when the meal log is wiped", async () => {
    await seed({
      meals: [
        {
          id: 1,
          title: "ground beef",
          protein: 14,
          carbs: 20,
          fats: 6,
          cals: 200,
          createdAt: "2026-07-19T14:32:05.123Z",
          localDate: "2026-07-19",
        },
      ],
      nextId: 2,
      weights: [weighIn("2026-07-19", 182.4)],
    });
    vi.resetModules();
    const { clearMeals } = await import("../src/meals.js");

    await clearMeals();

    // Weight is its own series — clearing what you ate should not erase it.
    const data = await readAll();
    expect(data.meals).toEqual([]);
    expect(data.weights).toHaveLength(1);
  });
});
