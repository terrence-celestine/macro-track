import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import type { Meal, MealsData } from "../src/types.js"

/**
 * Covers the day-scoping and summing that `today` is built on, in-process.
 * storage.ts caches its directory at import time, so every test resets the
 * module graph and re-imports — same pattern as menu.test.ts.
 */

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-totals-"))
    process.env.MACRO_TRACK_DIR = dataDir
})

afterEach(async () => {
    vi.useRealTimers()
    delete process.env.MACRO_TRACK_DIR
    await rm(dataDir, { recursive: true, force: true })
})

const load = async () => {
    vi.resetModules()
    return import("../src/commands.js")
}

const seed = async (data: MealsData) => {
    vi.resetModules()
    const { writeData } = await import("../src/storage.js")
    await writeData(data)
}

let nextId = 1
const meal = (over: Partial<Meal> = {}): Meal => ({
    id: nextId++,
    title: "ground beef",
    protein: 14,
    carbs: 20,
    fats: 6,
    cals: 200,
    createdAt: "2026-07-19T14:32:05.123Z",
    localDate: "2026-07-19",
    ...over,
})

beforeEach(() => {
    nextId = 1
})

describe("sumMacros", () => {
    it("returns zeros for no meals", async () => {
        const { sumMacros } = await load()

        expect(sumMacros([])).toEqual({ protein: 0, carbs: 0, fats: 0, cals: 0 })
    })

    it("returns the meal itself for a single meal", async () => {
        const { sumMacros } = await load()

        expect(sumMacros([meal()])).toEqual({ protein: 14, carbs: 20, fats: 6, cals: 200 })
    })

    it("adds every field across meals", async () => {
        const { sumMacros } = await load()

        const totals = sumMacros([
            meal(),
            meal({ protein: 4, carbs: 45, fats: 1, cals: 200 }),
        ])

        expect(totals).toEqual({ protein: 18, carbs: 65, fats: 7, cals: 400 })
    })

    it("handles decimals", async () => {
        const { sumMacros } = await load()

        const totals = sumMacros([
            meal({ protein: 6.5, carbs: 5.4, fats: 14.2, cals: 164 }),
            meal({ protein: 4.5, carbs: 0.6, fats: 0.8, cals: 36 }),
        ])

        expect(totals.protein).toBeCloseTo(11)
        expect(totals.carbs).toBeCloseTo(6)
        expect(totals.fats).toBeCloseTo(15)
        expect(totals.cals).toBe(200)
    })

    it("does not mutate the meals it sums", async () => {
        const { sumMacros } = await load()
        const meals = [meal(), meal()]
        const before = structuredClone(meals)

        sumMacros(meals)

        expect(meals).toEqual(before)
    })
})

describe("mealsOn", () => {
    it("returns only meals from the given day", async () => {
        await seed({
            meals: [
                meal({ localDate: "2026-07-18", title: "yesterday" }),
                meal({ localDate: "2026-07-19", title: "today" }),
                meal({ localDate: "2026-07-20", title: "tomorrow" }),
            ],
            nextId: 4,
        })
        const { mealsOn } = await load()

        const meals = await mealsOn("2026-07-19")

        expect(meals.map(m => m.title)).toEqual(["today"])
    })

    it("returns an empty array for a day with nothing logged", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { mealsOn } = await load()

        expect(await mealsOn("2026-07-19")).toEqual([])
    })

    it("returns an empty array when there is no data file at all", async () => {
        const { mealsOn } = await load()

        expect(await mealsOn("2026-07-19")).toEqual([])
    })

    it("keeps every meal from a day, not just the first", async () => {
        await seed({
            meals: [
                meal({ localDate: "2026-07-19", title: "a" }),
                meal({ localDate: "2026-07-19", title: "b" }),
                meal({ localDate: "2026-07-18", title: "c" }),
            ],
            nextId: 4,
        })
        const { mealsOn } = await load()

        expect((await mealsOn("2026-07-19")).map(m => m.title)).toEqual(["a", "b"])
    })

    it("matches on localDate, not the UTC timestamp", async () => {
        // createdAt says the 20th, localDate says the 19th. Filtering on the
        // timestamp would drop this meal from the 19th's totals.
        await seed({
            meals: [meal({ createdAt: "2026-07-20T01:30:00.000Z", localDate: "2026-07-19" })],
            nextId: 2,
        })
        const { mealsOn } = await load()

        expect(await mealsOn("2026-07-19")).toHaveLength(1)
        expect(await mealsOn("2026-07-20")).toHaveLength(0)
    })
})

describe("todaysMeals", () => {
    it("scopes to the current local day", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 19, 14, 32))

        await seed({
            meals: [
                meal({ localDate: "2026-07-18", title: "yesterday" }),
                meal({ localDate: "2026-07-19", title: "today" }),
            ],
            nextId: 3,
        })
        const { todaysMeals } = await load()

        expect((await todaysMeals()).map(m => m.title)).toEqual(["today"])
    })

    it("is empty when today has nothing logged", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 19, 14, 32))

        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { todaysMeals } = await load()

        expect(await todaysMeals()).toEqual([])
    })
})

describe("formatTotals", () => {
    const zero = { protein: 0, carbs: 0, fats: 0, cals: 0 }

    it("shows every macro and the calorie count", async () => {
        const { formatTotals } = await load()

        const text = formatTotals({ protein: 18, carbs: 65, fats: 7, cals: 400 }, 2).join("\n")

        expect(text).toContain("400")
        expect(text).toContain("18")
        expect(text).toContain("65")
        expect(text).toContain("7")
    })

    it("pluralises the meal count", async () => {
        const { formatTotals } = await load()

        expect(formatTotals(zero, 1).join("\n")).toContain("1 meal")
        expect(formatTotals(zero, 2).join("\n")).toContain("2 meals")
        expect(formatTotals(zero, 0).join("\n")).toContain("0 meals")
    })

    it("renders zeros rather than blanks on an empty day", async () => {
        const { formatTotals } = await load()

        const lines = formatTotals(zero, 0)

        expect(lines.filter(l => l.includes("0"))).toHaveLength(5)
    })

    it("trims floating-point noise", async () => {
        const { formatTotals } = await load()

        // 0.1 + 0.2 = 0.30000000000000004, which must not reach the terminal.
        const text = formatTotals({ protein: 0.1 + 0.2, carbs: 0, fats: 0, cals: 0 }, 1).join("\n")

        expect(text).toContain("0.3")
        expect(text).not.toContain("0.30000")
    })

    it("keeps whole numbers whole", async () => {
        const { formatTotals } = await load()

        const text = formatTotals({ protein: 14, carbs: 0, fats: 0, cals: 0 }, 1).join("\n")

        expect(text).toContain("14g")
        expect(text).not.toContain("14.0")
    })
})
