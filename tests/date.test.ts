import { describe, it, expect, afterEach, vi } from "vitest";

import { toLocalDate, todayLocalDate } from "../src/date.js";

/**
 * These tests set TZ and re-import, because Node reads the timezone once per
 * process for Date's local-time accessors. vi.resetModules alone is not enough
 * to change it mid-run — but vitest workers honour a TZ set before the Date is
 * constructed, so each case builds its Date after the assignment.
 */

const withTZ = async (tz: string, fn: () => void | Promise<void>) => {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    await fn();
  } finally {
    process.env.TZ = previous;
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("toLocalDate", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(toLocalDate(new Date(2026, 6, 19, 14, 32))).toBe("2026-07-19");
  });

  it("zero-pads single-digit months and days", () => {
    // Regression guard: template literals would otherwise emit "2026-1-5",
    // which breaks both string sorting and equality against a real day key.
    expect(toLocalDate(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
  });

  it("sorts chronologically as a plain string", () => {
    const days = [
      toLocalDate(new Date(2026, 11, 1)),
      toLocalDate(new Date(2026, 0, 5)),
      toLocalDate(new Date(2026, 6, 19)),
    ];

    expect([...days].sort()).toEqual([
      "2026-01-05",
      "2026-07-19",
      "2026-12-01",
    ]);
  });

  it("uses local time, not UTC", async () => {
    // The whole point of the field: 9pm in New York is already the next day
    // in UTC, and this meal belongs to the 19th.
    await withTZ("America/New_York", () => {
      const evening = new Date("2026-07-20T01:30:00.000Z"); // 9:30pm on the 19th, ET
      expect(evening.toISOString().slice(0, 10)).toBe("2026-07-20");
      expect(toLocalDate(evening)).toBe("2026-07-19");
    });
  });

  it("handles a date that is behind UTC in the other direction", async () => {
    await withTZ("Asia/Tokyo", () => {
      const morning = new Date("2026-07-18T22:00:00.000Z"); // 7am on the 19th, JST
      expect(morning.toISOString().slice(0, 10)).toBe("2026-07-18");
      expect(toLocalDate(morning)).toBe("2026-07-19");
    });
  });

  it("rolls over at local midnight", () => {
    expect(toLocalDate(new Date(2026, 6, 19, 23, 59, 59))).toBe("2026-07-19");
    expect(toLocalDate(new Date(2026, 6, 20, 0, 0, 0))).toBe("2026-07-20");
  });

  it("handles a leap day", () => {
    expect(toLocalDate(new Date(2028, 1, 29, 12, 0))).toBe("2028-02-29");
  });

  it("does not shift the day across a DST spring-forward", async () => {
    // US DST began 2026-03-08. A meal that morning is still the 8th.
    await withTZ("America/New_York", () => {
      expect(toLocalDate(new Date(2026, 2, 8, 3, 30))).toBe("2026-03-08");
    });
  });
});

describe("todayLocalDate", () => {
  it("returns the current local day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 19, 14, 32));

    expect(todayLocalDate()).toBe("2026-07-19");
  });

  it("agrees with toLocalDate on the same instant", () => {
    const now = new Date();

    expect(todayLocalDate()).toBe(toLocalDate(now));
  });

  it("matches the format used on stored meals", () => {
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
