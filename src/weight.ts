/**
 * Body weight: one number per local day, plus the trend that makes it readable.
 *
 * Day-to-day weight is mostly water, sodium and timing. A single reading says
 * almost nothing, which is why everything here is built around the trailing
 * average rather than the latest number.
 */

import { readData, writeData } from "./storage.js";
import { todayLocalDate } from "./date.js";
import { type WeighIn } from "./types.js";

/** How many days the headline trend looks back over. */
export const TREND_WINDOW = 7;

/** Weigh-ins oldest first, which is the order every calculation here wants. */
export const getWeights = async (): Promise<WeighIn[]> => {
  const data = await readData();
  return [...data.weights].sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Records today's weight, replacing any earlier reading for the same day.
 *
 * A second weigh-in on one day is a correction, not a second data point —
 * keeping both would mean a day with two readings quietly counts twice in the
 * average.
 */
export const recordWeight = async (
  weight: number,
  date: string = todayLocalDate(),
): Promise<WeighIn> => {
  const data = await readData();

  const entry: WeighIn = { date, weight, recordedAt: new Date().toISOString() };

  data.weights = [
    ...data.weights.filter((existing) => existing.date !== date),
    entry,
  ];
  await writeData(data);

  return entry;
};

/** Forgets one day's weigh-in. False when there was nothing recorded that day. */
export const removeWeight = async (date: string): Promise<boolean> => {
  const data = await readData();

  const remaining = data.weights.filter((existing) => existing.date !== date);
  if (remaining.length === data.weights.length) return false;

  data.weights = remaining;
  await writeData(data);

  return true;
};

/**
 * The mean of the last `window` *recorded* weigh-ins, not the last `window`
 * calendar days.
 *
 * Missing a Tuesday should not drag the average toward nothing; it should just
 * mean the window reaches one day further back. Returns null with no data,
 * since there is no honest number to show.
 */
export const trailingAverage = (
  weights: WeighIn[],
  window: number = TREND_WINDOW,
): number | null => {
  if (weights.length === 0) return null;

  const recent = weights.slice(-window);
  const total = recent.reduce((sum, entry) => sum + entry.weight, 0);

  return total / recent.length;
};

/**
 * How the trailing average has moved: the current window against the one
 * immediately before it.
 *
 * Null until there is a full earlier window to compare against — a "change"
 * computed from two overlapping or half-empty windows is noise wearing a
 * number's clothes.
 */
export const trailingChange = (
  weights: WeighIn[],
  window: number = TREND_WINDOW,
): number | null => {
  if (weights.length < window * 2) return null;

  const current = trailingAverage(weights, window);
  const previous = trailingAverage(weights.slice(0, -window), window);

  if (current === null || previous === null) return null;

  return current - previous;
};
