import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type {
  DayRecord,
  Favorite,
  Meal,
  MealsData,
  WeighIn,
} from "../src/types.js";

/**
 * `clear` empties the meal log. These tests exist to pin what it must *not*
 * touch.
 *
 * It used to rebuild the file from defaultData() and copy a couple of fields
 * back, so every new top-level key silently became something clear destroyed —
 * day records and favourites both went that way unnoticed, because every
 * existing test cleared a file that had nothing else in it.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "macro-track-clear-"));
  process.env.MACRO_TRACK_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.MACRO_TRACK_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

const load = async () => {
  vi.resetModules();
  return import("../src/meals.js");
};

const seed = async (data: Partial<MealsData>) => {
  vi.resetModules();
  const { writeData, defaultData } = await import("../src/storage.js");
  await writeData({ ...defaultData(), ...data });
};

const readAll = async (): Promise<MealsData> => {
  vi.resetModules();
  const { readData } = await import("../src/storage.js");
  return readData();
};

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: 1,
  title: "ground beef",
  protein: 14,
  carbs: 20,
  fats: 6,
  cals: 200,
  createdAt: "2026-07-19T14:32:05.123Z",
  localDate: "2026-07-19",
  ...over,
});

const record: DayRecord = {
  date: "2026-07-18",
  totals: { protein: 14, carbs: 20, fats: 6, cals: 200 },
  goals: { protein: 180 },
  hit: false,
  mealCount: 1,
  closedAt: "2026-07-19T00:00:00.000Z",
};

const favorite: Favorite = {
  name: "beef",
  protein: 14,
  carbs: 20,
  fats: 6,
  cals: 200,
  createdAt: "2026-07-19T14:32:05.123Z",
};

const weighIn: WeighIn = {
  date: "2026-07-19",
  weight: 182.4,
  recordedAt: "2026-07-19T08:00:00.000Z",
};

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
