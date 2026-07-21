import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { DayRecord, Meal, MealsData } from "../src/types.js"

/**
 * Deleting is constrained by day records: once a day is frozen, its meals are
 * the evidence behind the frozen totals and can no longer be removed. Most of
 * these tests are about that boundary.
 */

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-delete-"))
    process.env.MACRO_TRACK_DIR = dataDir
})

afterEach(async () => {
    delete process.env.MACRO_TRACK_DIR
    await rm(dataDir, { recursive: true, force: true })
})

const load = async () => {
    vi.resetModules()
    return import("../src/commands.js")
}

const seed = async (data: Partial<MealsData>) => {
    vi.resetModules()
    const { writeData, defaultData } = await import("../src/storage.js")
    await writeData({ ...defaultData(), ...data })
}

const readAll = async (): Promise<MealsData> => {
    vi.resetModules()
    const { readData } = await import("../src/storage.js")
    return readData()
}

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
})

const record = (date: string): DayRecord => ({
    date,
    totals: { protein: 14, carbs: 20, fats: 6, cals: 200 },
    goals: {},
    hit: null,
    mealCount: 1,
    closedAt: "2026-07-20T00:00:00.000Z",
})

describe("deleteMeal", () => {
    it("removes the meal", async () => {
        await seed({ meals: [meal({ id: 1 }), meal({ id: 2, title: "rice" })], nextId: 3 })
        const { deleteMeal } = await load()

        await deleteMeal(1)

        expect((await readAll()).meals.map(m => m.title)).toEqual(["rice"])
    })

    it("returns the meal it deleted", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        const { deleteMeal } = await load()

        const result = await deleteMeal(1)

        expect(result).toMatchObject({ ok: true, meal: { id: 1, title: "ground beef" } })
    })

    it("reports a missing id rather than silently doing nothing", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        const { deleteMeal } = await load()

        expect(await deleteMeal(99)).toEqual({ ok: false, reason: "not-found" })
    })

    it("leaves the file untouched when the id is missing", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        const { deleteMeal } = await load()

        await deleteMeal(99)

        expect((await readAll()).meals).toHaveLength(1)
    })

    it("does not touch the file at all when the id is missing", async () => {
        const { deleteMeal } = await load()

        await deleteMeal(99)

        expect(existsSync(join(dataDir, "macros.json"))).toBe(false)
    })

    it("refuses a meal whose day is already recorded", async () => {
        await seed({
            meals: [meal({ id: 1, localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { deleteMeal } = await load()

        expect(await deleteMeal(1)).toEqual({ ok: false, reason: "day-closed" })
    })

    it("keeps the meal when the day is recorded", async () => {
        await seed({
            meals: [meal({ id: 1, localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { deleteMeal } = await load()

        await deleteMeal(1)

        // The frozen totals were computed from this meal; removing it would
        // leave the record describing something that no longer exists.
        expect((await readAll()).meals).toHaveLength(1)
    })

    it("still allows deleting an open day's meal when other days are closed", async () => {
        await seed({
            meals: [
                meal({ id: 1, localDate: "2026-07-18" }),
                meal({ id: 2, localDate: "2026-07-19" }),
            ],
            nextId: 3,
            days: [record("2026-07-18")],
        })
        const { deleteMeal } = await load()

        expect((await deleteMeal(2)).ok).toBe(true)
        expect((await readAll()).meals.map(m => m.id)).toEqual([1])
    })

    it("does not reuse the freed id", async () => {
        await seed({ meals: [meal({ id: 1 }), meal({ id: 2 })], nextId: 3 })
        const { deleteMeal, addMeal } = await load()

        await deleteMeal(2)
        const added = await addMeal({ title: "rice", protein: 4, carbs: 45, fats: 1, kcals: 200 })

        // A stale id from an earlier `list` must never point at a new meal.
        expect(added.id).toBe(3)
    })

    it("leaves day records alone", async () => {
        await seed({
            meals: [meal({ id: 1, localDate: "2026-07-19" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { deleteMeal } = await load()

        await deleteMeal(1)

        expect((await readAll()).days).toHaveLength(1)
    })

    it("leaves goals alone", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2, goals: { protein: 180 } })
        const { deleteMeal } = await load()

        await deleteMeal(1)

        expect((await readAll()).goals).toEqual({ protein: 180 })
    })

    it("deletes only the requested meal when several share a title", async () => {
        await seed({
            meals: [meal({ id: 1 }), meal({ id: 2 }), meal({ id: 3 })],
            nextId: 4,
        })
        const { deleteMeal } = await load()

        await deleteMeal(2)

        expect((await readAll()).meals.map(m => m.id)).toEqual([1, 3])
    })
})

describe("openMeals", () => {
    it("is empty with nothing logged", async () => {
        const { openMeals } = await load()

        expect(await openMeals()).toEqual([])
    })

    it("offers meals from days with no record", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        const { openMeals } = await load()

        expect(await openMeals()).toHaveLength(1)
    })

    it("hides meals from recorded days entirely", async () => {
        await seed({
            meals: [
                meal({ id: 1, localDate: "2026-07-18" }),
                meal({ id: 2, localDate: "2026-07-19" }),
            ],
            nextId: 3,
            days: [record("2026-07-18")],
        })
        const { openMeals } = await load()

        // Not shown and refused — just not shown.
        expect((await openMeals()).map(m => m.id)).toEqual([2])
    })

    it("is empty when every logged day is recorded", async () => {
        await seed({
            meals: [meal({ id: 1, localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { openMeals } = await load()

        expect(await openMeals()).toEqual([])
    })
})

describe("delete output", () => {
    it("names the meal and its id on success", async () => {
        const { formatDeleted } = await load()

        const text = formatDeleted(meal({ id: 7, title: "rice" }))

        expect(text).toContain("rice")
        expect(text).toContain("7")
    })

    it("points at list when the id is unknown", async () => {
        const { formatDeleteFailure } = await load()

        expect(formatDeleteFailure(99, "not-found")).toContain("99")
        expect(formatDeleteFailure(99, "not-found")).toContain("list")
    })

    it("explains the closed-day refusal rather than just failing", async () => {
        const { formatDeleteFailure } = await load()

        expect(formatDeleteFailure(1, "day-closed")).toContain("recorded")
    })
})
