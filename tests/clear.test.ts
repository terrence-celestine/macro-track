import { describe, it, expect } from "vitest";

import type { MealsData } from "../src/types.js";
import { useDataSandbox, freshModules } from "./helpers/data.js";
import {
  meal,
  dayRecord,
  favorite as makeFavorite,
  weighIn as makeWeighIn,
} from "./helpers/fixtures.js";

/**
 * `clear` empties the meal log. These tests exist to pin what it must *not*
 * touch.
 *
 * It used to rebuild the file from defaultData() and copy a couple of fields
 * back, so every new top-level key silently became something clear destroyed —
 * day records and favourites both went that way unnoticed, because every
 * existing test cleared a file that had nothing else in it.
 */

const { seed, readAll } = useDataSandbox("clear");

const load = async () => {
  freshModules();
  return import("../src/meals.js");
};

const record = dayRecord({
  goals: { protein: 180 },
  hit: false,
  closedAt: "2026-07-19T00:00:00.000Z",
});
const favorite = makeFavorite();
const weighIn = makeWeighIn("2026-07-19", 182.4);

/** Everything a fully-populated data file holds. */
const populated = (): Partial<MealsData> => ({
  meals: [meal({ id: 1 }), meal({ id: 2, title: "rice" })],
  nextId: 3,
  goals: { protein: 180, cals: 2000 },
  days: [record],
  favorites: [favorite],
  weights: [weighIn],
});

describe("clearMeals", () => {
  it("removes every meal", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    expect((await readAll()).meals).toEqual([]);
  });

  it("restarts the id counter", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    expect((await readAll()).nextId).toBe(1);
  });

  it("lets meals be added again afterwards", async () => {
    await seed(populated());
    const { clearMeals, addMeal } = await load();

    await clearMeals();
    const added = await addMeal({
      title: "rice",
      protein: 4,
      carbs: 45,
      fats: 1,
      kcals: 200,
    });

    expect(added.id).toBe(1);
  });
});

describe("what clear must not touch", () => {
  it("keeps frozen day records", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    // Day records cannot be rebuilt from anything — the meals behind them
    // are exactly what clear just removed.
    expect((await readAll()).days).toEqual([record]);
  });

  it("keeps favorites", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    // Favourites are shortcuts, not meals. Clearing what you ate should not
    // make you re-save them.
    expect((await readAll()).favorites).toEqual([favorite]);
  });

  it("keeps goals", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    expect((await readAll()).goals).toEqual({ protein: 180, cals: 2000 });
  });

  it("keeps weigh-ins", async () => {
    await seed(populated());
    const { clearMeals } = await load();

    await clearMeals();

    expect((await readAll()).weights).toEqual([weighIn]);
  });

  it("changes only meals and nextId", async () => {
    await seed(populated());
    const before = await readAll();
    const { clearMeals } = await load();

    await clearMeals();

    // The catch-all: a new top-level key added later is preserved by
    // default rather than silently destroyed, which is the bug this whole
    // file exists for.
    expect(await readAll()).toEqual({ ...before, meals: [], nextId: 1 });
  });
});
