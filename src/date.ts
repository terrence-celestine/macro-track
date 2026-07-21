/**
 * Local-day helpers.
 *
 * Meals carry a `localDate` alongside `createdAt` because the two disagree for
 * exactly the meals you care most about. `createdAt` is UTC, so a 9pm dinner in
 * a western timezone is already tomorrow in UTC and would be filed against the
 * wrong day's totals. The local date is what a person means by "today", so day
 * grouping reads that field and never the timestamp.
 *
 * Both are stored: `createdAt` remains the precise instant for ordering,
 * `localDate` is the day bucket.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Formats a Date as YYYY-MM-DD in the machine's local timezone.
 *
 * getFullYear/getMonth/getDate are the local-time accessors — the UTC variants
 * would reintroduce the bug this field exists to fix. Sorts correctly as a
 * plain string, which is why it is not stored as a Date.
 */
export const toLocalDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The current local day, as YYYY-MM-DD. */
export const todayLocalDate = (): string => toLocalDate(new Date());
