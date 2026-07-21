import type { DayRecord, Favorite, Meal, WeighIn } from "../../src/types.js";

/**
 * Stock records for tests, all overridable.
 *
 * Only the shapes that were byte-identical across suites live here. Fixtures
 * that differ meaningfully between files stay local to those files — a shared
 * fixture that every caller has to override is worse than a local one.
 */

export const meal = (over: Partial<Meal> = {}): Meal => ({
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

export const dayRecord = (over: Partial<DayRecord> = {}): DayRecord => ({
  date: "2026-07-18",
  totals: { protein: 14, carbs: 20, fats: 6, cals: 200 },
  goals: {},
  hit: null,
  mealCount: 1,
  closedAt: "2026-07-20T00:00:00.000Z",
  ...over,
});

export const favorite = (over: Partial<Favorite> = {}): Favorite => ({
  name: "beef",
  protein: 14,
  carbs: 20,
  fats: 6,
  cals: 200,
  createdAt: "2026-07-19T14:32:05.123Z",
  ...over,
});

export const weighIn = (date: string, weight: number): WeighIn => ({
  date,
  weight,
  recordedAt: `${date}T08:00:00.000Z`,
});
