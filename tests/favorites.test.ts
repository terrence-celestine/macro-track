import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { DayRecord, Favorite, Meal, MealsData } from "../src/types.js"

/**
 * Favorites are a snapshot, not a pointer. The tests that matter most are the
 * ones proving a favourite keeps working after its source meal is edited,
 * deleted, or frozen into a day record.
 */

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-fav-"))
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

const today = async () => {
    vi.resetModules()
    const { todayLocalDate } = await import("../src/date.js")
    return todayLocalDate()
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

const favorite = (over: Partial<Favorite> = {}): Favorite => ({
    name: "beef",
    protein: 14,
    carbs: 20,
    fats: 6,
    cals: 200,
    createdAt: "2026-07-19T14:32:05.123Z",
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

describe("addFavorite", () => {
    it("saves a meal under its own title by default", async () => {
        await seed({ meals: [meal({ title: "ground beef" })], nextId: 2 })
        const { addFavorite } = await load()

        const result = await addFavorite(1)

        expect(result).toMatchObject({ ok: true, favorite: { name: "ground beef" } })
    })

    it("accepts a shorter name", async () => {
        await seed({ meals: [meal({ title: "ground beef" })], nextId: 2 })
        const { addFavorite } = await load()

        const result = await addFavorite(1, "beef")

        expect(result).toMatchObject({ ok: true, favorite: { name: "beef" } })
    })

    it("copies every macro", async () => {
        await seed({ meals: [meal({ protein: 40, carbs: 3, fats: 5, cals: 220 })], nextId: 2 })
        const { addFavorite } = await load()

        await addFavorite(1, "chicken")

        expect((await readAll()).favorites[0]).toMatchObject({
            protein: 40, carbs: 3, fats: 5, cals: 220,
        })
    })

    it("stores exactly the favorite's own fields, nothing from the meal", async () => {
        await seed({ meals: [meal({ id: 7, localDate: "2026-07-19" })], nextId: 8 })
        const { addFavorite } = await load()

        await addFavorite(7, "beef")

        // No id, title or localDate. Carrying the source meal's identity is the
        // pointer-shaped mistake this design exists to avoid, and TypeScript
        // will not catch it because spread does not trip excess-property checks.
        expect(Object.keys((await readAll()).favorites[0]).sort()).toEqual(
            ["cals", "carbs", "createdAt", "fats", "name", "protein"],
        )
    })

    it("gives the favorite its own createdAt, not the meal's", async () => {
        await seed({ meals: [meal({ createdAt: "2020-01-01T00:00:00.000Z" })], nextId: 2 })
        const { addFavorite } = await load()

        await addFavorite(1, "beef")

        expect((await readAll()).favorites[0].createdAt).not.toBe("2020-01-01T00:00:00.000Z")
    })

    it("trims the name", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { addFavorite } = await load()

        await addFavorite(1, "  beef  ")

        expect((await readAll()).favorites[0].name).toBe("beef")
    })

    it("reports a missing meal id", async () => {
        const { addFavorite } = await load()

        expect(await addFavorite(99)).toEqual({ ok: false, reason: "not-found" })
    })

    it("writes nothing when the meal id is missing", async () => {
        const { addFavorite } = await load()

        await addFavorite(99)

        expect(existsSync(join(dataDir, "macros.json"))).toBe(false)
    })

    it("refuses a name already in use", async () => {
        await seed({ meals: [meal()], nextId: 2, favorites: [favorite({ name: "beef" })] })
        const { addFavorite } = await load()

        expect(await addFavorite(1, "beef")).toEqual({ ok: false, reason: "duplicate-name" })
    })

    it("treats a differently-cased name as a duplicate", async () => {
        await seed({ meals: [meal()], nextId: 2, favorites: [favorite({ name: "beef" })] })
        const { addFavorite } = await load()

        // Otherwise "Beef" and "beef" would both exist and `repeat beef` would
        // have to pick one arbitrarily.
        expect(await addFavorite(1, "BEEF")).toEqual({ ok: false, reason: "duplicate-name" })
    })

    it("does not overwrite the existing favorite on a duplicate", async () => {
        await seed({
            meals: [meal({ protein: 999 })],
            nextId: 2,
            favorites: [favorite({ name: "beef", protein: 14 })],
        })
        const { addFavorite } = await load()

        await addFavorite(1, "beef")

        const { favorites } = await readAll()
        expect(favorites).toHaveLength(1)
        expect(favorites[0].protein).toBe(14)
    })

    it("refuses an empty name", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { addFavorite } = await load()

        expect(await addFavorite(1, "   ")).toEqual({ ok: false, reason: "empty-name" })
    })

    it("saves from a meal on a recorded day", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { addFavorite } = await load()

        // Reads the meal, writes a separate row — nothing frozen is touched.
        expect((await addFavorite(1, "beef")).ok).toBe(true)
    })

    it("leaves meals and day records alone", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18" })],
            nextId: 2,
            days: [record("2026-07-18")],
        })
        const { addFavorite } = await load()

        await addFavorite(1, "beef")

        const data = await readAll()
        expect(data.meals).toHaveLength(1)
        expect(data.days).toHaveLength(1)
    })
})

describe("favorites are snapshots", () => {
    it("survives the source meal being deleted", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const { addFavorite, deleteMeal, repeatFavorite } = await load()
        await addFavorite(1, "beef")

        await deleteMeal(1)
        const result = await repeatFavorite("beef")

        expect(result).toMatchObject({ ok: true, meal: { protein: 14, cals: 200 } })
    })

    it("does not follow later edits to the source meal", async () => {
        await seed({ meals: [meal({ protein: 14 })], nextId: 2 })
        const { addFavorite, editMeal, getFavorites } = await load()
        await addFavorite(1, "beef")

        await editMeal(1, { protein: 999 })

        // The favourite is its own copy; changing the meal must not silently
        // change what every future `repeat beef` logs.
        expect((await getFavorites())[0].protein).toBe(14)
    })
})

describe("repeatFavorite", () => {
    it("logs a meal from the favorite", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { repeatFavorite } = await load()

        await repeatFavorite("beef")

        expect((await readAll()).meals).toHaveLength(1)
    })

    it("uses the favorite's name as the meal title", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { repeatFavorite } = await load()

        const result = await repeatFavorite("beef")

        expect(result).toMatchObject({ ok: true, meal: { title: "beef" } })
    })

    it("copies every macro onto the new meal", async () => {
        await seed({ favorites: [favorite({ protein: 40, carbs: 3, fats: 5, cals: 220 })] })
        const { repeatFavorite } = await load()

        await repeatFavorite("beef")

        expect((await readAll()).meals[0]).toMatchObject({
            protein: 40, carbs: 3, fats: 5, cals: 220,
        })
    })

    it("dates the meal today", async () => {
        await seed({ favorites: [favorite()] })
        const { repeatFavorite } = await load()

        await repeatFavorite("beef")

        expect((await readAll()).meals[0].localDate).toBe(await today())
    })

    it("matches the name case-insensitively", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { repeatFavorite } = await load()

        expect((await repeatFavorite("BEEF")).ok).toBe(true)
    })

    it("ignores surrounding whitespace in the name", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { repeatFavorite } = await load()

        expect((await repeatFavorite("  beef  ")).ok).toBe(true)
    })

    it("reports an unknown name", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { repeatFavorite } = await load()

        expect(await repeatFavorite("chicken")).toEqual({ ok: false, reason: "not-found" })
    })

    it("writes nothing for an unknown name", async () => {
        const { repeatFavorite } = await load()

        await repeatFavorite("chicken")

        expect(existsSync(join(dataDir, "macros.json"))).toBe(false)
    })

    it("gives each logged copy its own id", async () => {
        await seed({ favorites: [favorite()] })
        const { repeatFavorite } = await load()

        await repeatFavorite("beef")
        await repeatFavorite("beef")

        expect((await readAll()).meals.map(m => m.id)).toEqual([1, 2])
    })

    it("leaves the favorite in place after logging", async () => {
        await seed({ favorites: [favorite()] })
        const { repeatFavorite, getFavorites } = await load()

        await repeatFavorite("beef")

        expect(await getFavorites()).toHaveLength(1)
    })

    it("counts toward today's totals", async () => {
        await seed({ favorites: [favorite()] })
        const { repeatFavorite, todaysMeals, sumMacros } = await load()

        await repeatFavorite("beef")
        await repeatFavorite("beef")

        expect(sumMacros(await todaysMeals())).toEqual({ protein: 28, carbs: 40, fats: 12, cals: 400 })
    })
})

describe("removeFavorite", () => {
    it("forgets the favorite", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { removeFavorite, getFavorites } = await load()

        expect(await removeFavorite("beef")).toBe(true)
        expect(await getFavorites()).toEqual([])
    })

    it("matches case-insensitively", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { removeFavorite } = await load()

        expect(await removeFavorite("BEEF")).toBe(true)
    })

    it("reports an unknown name", async () => {
        await seed({ favorites: [favorite({ name: "beef" })] })
        const { removeFavorite } = await load()

        expect(await removeFavorite("chicken")).toBe(false)
    })

    it("removes only the named one", async () => {
        await seed({
            favorites: [favorite({ name: "beef" }), favorite({ name: "rice" })],
        })
        const { removeFavorite, getFavorites } = await load()

        await removeFavorite("beef")

        expect((await getFavorites()).map(f => f.name)).toEqual(["rice"])
    })

    it("leaves already-logged meals alone", async () => {
        await seed({ meals: [meal()], nextId: 2, favorites: [favorite({ name: "beef" })] })
        const { removeFavorite } = await load()

        await removeFavorite("beef")

        // Forgetting the shortcut does not un-eat the food.
        expect((await readAll()).meals).toHaveLength(1)
    })
})

describe("favorite output", () => {
    it("says so when there are none", async () => {
        const { formatFavorites } = await load()

        expect(formatFavorites([]).join("\n")).toContain("No favorites yet")
    })

    it("lists each name with its macros", async () => {
        const { formatFavorites } = await load()

        const text = formatFavorites([favorite({ name: "beef", cals: 200, protein: 14 })]).join("\n")

        expect(text).toContain("beef")
        expect(text).toContain("200")
        expect(text).toContain("14")
    })

    it("tells you how to log it after saving", async () => {
        const { formatFavorited } = await load()

        expect(formatFavorited(favorite({ name: "beef" }))).toContain("repeat beef")
    })

    it("suggests --as on a duplicate name", async () => {
        const { formatFavoriteFailure } = await load()

        expect(formatFavoriteFailure("duplicate-name", 1, "beef")).toContain("--as")
    })

    it("points at list ids when the meal is missing", async () => {
        const { formatFavoriteFailure } = await load()

        expect(formatFavoriteFailure("not-found", 99)).toContain("99")
    })
})
