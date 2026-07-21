import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { DayRecord, Meal, MealsData } from "../src/types.js"

/**
 * Editing merges like `goal set` and is blocked on recorded days like `delete`.
 * The tests that matter most are the ones pinning what an edit must *not*
 * touch: the id, the timestamp, and the day the meal counts toward.
 */

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-edit-"))
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

describe("editMeal", () => {
    it("changes a single macro", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        expect((await readAll()).meals[0].protein).toBe(40)
    })

    it("leaves the macros it was not asked to change", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        const stored = (await readAll()).meals[0]
        expect(stored).toMatchObject({ carbs: 20, fats: 6, cals: 200 })
    })

    it("does not blank fields commander leaves undefined", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        // The exact shape an action receives when only -p was passed.
        await editMeal(1, {
            title: undefined,
            protein: 40,
            carbs: undefined,
            fats: undefined,
            cals: undefined,
        })

        const stored = (await readAll()).meals[0]
        expect(stored.title).toBe("ground beef")
        expect(stored.carbs).toBe(20)
    })

    it("changes the title", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { title: "chicken thigh" })

        expect((await readAll()).meals[0].title).toBe("chicken thigh")
    })

    it("accepts zero as a value", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { carbs: 0 })

        // Only undefined means "leave alone"; zero is a real edit.
        expect((await readAll()).meals[0].carbs).toBe(0)
    })

    it("keeps the id", async () => {
        await seed({ meals: [meal({ id: 7 })], nextId: 8 })
        const { editMeal } = await load()

        await editMeal(7, { protein: 40 })

        expect((await readAll()).meals[0].id).toBe(7)
    })

    it("keeps createdAt", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        expect((await readAll()).meals[0].createdAt).toBe("2026-07-19T14:32:05.123Z")
    })

    it("keeps localDate", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        // Editing what you ate must not move the meal to a different day, which
        // would silently shift it into another day's totals.
        expect((await readAll()).meals[0].localDate).toBe("2026-07-19")
    })

    it("edits only the requested meal", async () => {
        await seed({ meals: [meal({ id: 1 }), meal({ id: 2 })], nextId: 3 })
        const { editMeal } = await load()

        await editMeal(2, { protein: 40 })

        const [first, second] = (await readAll()).meals
        expect(first.protein).toBe(14)
        expect(second.protein).toBe(40)
    })

    it("reports a missing id", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        expect(await editMeal(99, { protein: 40 })).toEqual({ ok: false, reason: "not-found" })
    })

    it("writes nothing when the id is missing", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        await editMeal(99, { protein: 40 })

        expect((await readAll()).meals[0].protein).toBe(14)
    })

    it("does not touch the file at all when the id is missing", async () => {
        const { editMeal } = await load()

        await editMeal(99, { protein: 40 })

        // A failed lookup is a read. Writing unchanged data back would create
        // the data file as a side effect of an operation that did nothing.
        expect(existsSync(join(dataDir, "macros.json"))).toBe(false)
    })

    it("refuses a meal whose day is recorded", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { editMeal } = await load()

        expect(await editMeal(1, { protein: 40 })).toEqual({ ok: false, reason: "day-closed" })
    })

    it("leaves the meal alone when its day is recorded", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        // The frozen totals were computed from this meal.
        expect((await readAll()).meals[0].protein).toBe(14)
    })

    it("returns the updated meal", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { editMeal } = await load()

        const result = await editMeal(1, { protein: 40 })

        expect(result).toMatchObject({ ok: true, meal: { protein: 40 } })
    })

    it("is reflected in the day's totals", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-19" })], nextId: 2 })
        const { editMeal, mealsOn, sumMacros } = await load()

        await editMeal(1, { protein: 40 })

        expect(sumMacros(await mealsOn("2026-07-19")).protein).toBe(40)
    })

    it("leaves goals and day records alone", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-19" })],
            nextId: 2,
            goals: { protein: 180 },
            days: [record("2026-07-18")],
        })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        const data = await readAll()
        expect(data.goals).toEqual({ protein: 180 })
        expect(data.days).toHaveLength(1)
    })

    it("does not change nextId", async () => {
        await seed({ meals: [meal()], nextId: 5 })
        const { editMeal } = await load()

        await editMeal(1, { protein: 40 })

        expect((await readAll()).nextId).toBe(5)
    })
})

describe("edit output", () => {
    it("shows the meal's new values", async () => {
        const { formatEdited } = await load()

        const text = formatEdited(meal({ title: "chicken", protein: 40 }))

        expect(text).toContain("chicken")
        expect(text).toContain("40")
    })

    it("points at list when the id is unknown", async () => {
        const { formatEditFailure } = await load()

        expect(formatEditFailure(99, "not-found")).toContain("list")
    })

    it("says edited, not deleted, on a closed-day refusal", async () => {
        const { formatEditFailure } = await load()

        const text = formatEditFailure(1, "day-closed")
        expect(text).toContain("edited")
        expect(text).not.toContain("deleted")
    })
})
