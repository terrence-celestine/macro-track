import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { DayRecord, Goals, Macros, Meal, MealsData } from "../src/types.js"

/**
 * Day records freeze a finished day. Most of what matters is what stays frozen:
 * a record must not move when goals change later, and closing twice must not
 * produce two records for one day.
 */

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-days-"))
    process.env.MACRO_TRACK_DIR = dataDir
})

afterEach(async () => {
    vi.useRealTimers()
    delete process.env.MACRO_TRACK_DIR
    await rm(dataDir, { recursive: true, force: true })
})

const load = async () => {
    vi.resetModules()
    return import("../src/days.js")
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

const dataFile = () => join(dataDir, "macros.json")

let nextId = 1
beforeEach(() => { nextId = 1 })

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

const macros = (over: Partial<Macros> = {}): Macros =>
    ({ protein: 100, carbs: 150, fats: 40, cals: 1500, ...over })

describe("GOAL_DIRECTION", () => {
    it("treats protein as a floor and the rest as ceilings", async () => {
        const { GOAL_DIRECTION } = await load()

        // This convention is what makes a hit verdict possible at all. Eating
        // 200g of protein against a 180g target is a win; eating 2400 calories
        // against a 2000 target is not.
        expect(GOAL_DIRECTION.protein).toBe("min")
        expect(GOAL_DIRECTION.carbs).toBe("max")
        expect(GOAL_DIRECTION.fats).toBe("max")
        expect(GOAL_DIRECTION.cals).toBe("max")
    })
})

describe("macroHit", () => {
    it("counts exceeding a protein target as a hit", async () => {
        const { macroHit } = await load()

        expect(macroHit("protein", 200, 180)).toBe(true)
    })

    it("counts falling short of protein as a miss", async () => {
        const { macroHit } = await load()

        expect(macroHit("protein", 150, 180)).toBe(false)
    })

    it("counts staying under a calorie target as a hit", async () => {
        const { macroHit } = await load()

        expect(macroHit("cals", 1800, 2000)).toBe(true)
    })

    it("counts exceeding calories as a miss", async () => {
        const { macroHit } = await load()

        expect(macroHit("cals", 2400, 2000)).toBe(false)
    })

    it("counts landing exactly on the target as a hit, both directions", async () => {
        const { macroHit } = await load()

        expect(macroHit("protein", 180, 180)).toBe(true)
        expect(macroHit("cals", 2000, 2000)).toBe(true)
    })
})

describe("dayHit", () => {
    it("is null when no goals were set", async () => {
        const { dayHit } = await load()

        // Unjudged, not failed — a day you never set targets for did not "miss".
        expect(dayHit(macros(), {})).toBeNull()
    })

    it("is true when every set macro hits", async () => {
        const { dayHit } = await load()

        expect(dayHit(macros({ protein: 200, cals: 1800 }), { protein: 180, cals: 2000 })).toBe(true)
    })

    it("is false when any set macro misses", async () => {
        const { dayHit } = await load()

        expect(dayHit(macros({ protein: 200, cals: 2400 }), { protein: 180, cals: 2000 })).toBe(false)
    })

    it("ignores macros with no target", async () => {
        const { dayHit } = await load()

        // Carbs are wildly over, but no carb target was set, so it cannot count
        // against the day.
        expect(dayHit(macros({ protein: 200, carbs: 9999 }), { protein: 180 })).toBe(true)
    })

    it("judges a zero target properly rather than treating it as unset", async () => {
        const { dayHit } = await load()

        expect(dayHit(macros({ carbs: 0 }), { carbs: 0 })).toBe(true)
        expect(dayHit(macros({ carbs: 10 }), { carbs: 0 })).toBe(false)
    })
})

describe("buildDayRecord", () => {
    const goals: Goals = { protein: 180, cals: 2000 }

    it("freezes the totals", async () => {
        const { buildDayRecord } = await load()

        const record = buildDayRecord("2026-07-19", [meal(), meal()], goals)

        expect(record.totals).toEqual({ protein: 28, carbs: 40, fats: 12, cals: 400 })
    })

    it("records how many meals it summed", async () => {
        const { buildDayRecord } = await load()

        expect(buildDayRecord("2026-07-19", [meal(), meal()], goals).mealCount).toBe(2)
    })

    it("copies the goals rather than referencing them", async () => {
        const { buildDayRecord } = await load()
        const live: Goals = { protein: 180 }

        const record = buildDayRecord("2026-07-19", [meal()], live)
        live.protein = 999

        // The whole reason records are frozen: changing a goal later must not
        // rewrite what you were aiming for back then.
        expect(record.goals.protein).toBe(180)
    })

    it("stamps a parseable closedAt", async () => {
        const { buildDayRecord } = await load()

        const { closedAt } = buildDayRecord("2026-07-19", [meal()], goals)
        expect(Number.isNaN(Date.parse(closedAt))).toBe(false)
    })

    it("handles a day with no meals", async () => {
        const { buildDayRecord } = await load()

        const record = buildDayRecord("2026-07-19", [], goals)

        expect(record.totals).toEqual({ protein: 0, carbs: 0, fats: 0, cals: 0 })
        expect(record.mealCount).toBe(0)
    })
})

describe("closeStaleDays", () => {
    it("closes a day that is already past", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { closeStaleDays } = await load()

        const created = await closeStaleDays("2026-07-19")

        expect(created.map(d => d.date)).toEqual(["2026-07-18"])
    })

    it("leaves today open", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-19" })], nextId: 2 })
        const { closeStaleDays } = await load()

        expect(await closeStaleDays("2026-07-19")).toEqual([])
    })

    it("writes nothing when there is nothing to close", async () => {
        const { closeStaleDays } = await load()

        await closeStaleDays("2026-07-19")

        // Read-only commands run this on every invocation; it must not create
        // a data file as a side effect.
        expect(existsSync(dataFile())).toBe(false)
    })

    it("does not close the same day twice", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { closeStaleDays } = await load()

        await closeStaleDays("2026-07-19")
        const second = await closeStaleDays("2026-07-19")

        expect(second).toEqual([])
        expect((await readAll()).days).toHaveLength(1)
    })

    it("closes several stale days at once, oldest first", async () => {
        await seed({
            meals: [
                meal({ localDate: "2026-07-17" }),
                meal({ localDate: "2026-07-16" }),
                meal({ localDate: "2026-07-18" }),
            ],
            nextId: 4,
        })
        const { closeStaleDays } = await load()

        const created = await closeStaleDays("2026-07-19")

        expect(created.map(d => d.date)).toEqual(["2026-07-16", "2026-07-17", "2026-07-18"])
    })

    it("groups each day's meals into its own record", async () => {
        await seed({
            meals: [
                meal({ localDate: "2026-07-17" }),
                meal({ localDate: "2026-07-17" }),
                meal({ localDate: "2026-07-18" }),
            ],
            nextId: 4,
        })
        const { closeStaleDays } = await load()

        const created = await closeStaleDays("2026-07-19")

        expect(created.map(d => d.mealCount)).toEqual([2, 1])
    })

    it("snapshots the goals as they stand at close", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18" })],
            nextId: 2,
            goals: { protein: 180 },
        })
        const { closeStaleDays } = await load()

        const [record] = await closeStaleDays("2026-07-19")

        expect(record.goals).toEqual({ protein: 180 })
    })

    it("leaves a closed record alone when goals change afterwards", async () => {
        await seed({
            meals: [meal({ localDate: "2026-07-18", protein: 200 })],
            nextId: 2,
            goals: { protein: 180 },
        })
        const { closeStaleDays } = await load()
        await closeStaleDays("2026-07-19")

        const { setGoals } = await import("../src/commands.js")
        await setGoals({ protein: 300 })

        const [record] = (await readAll()).days
        expect(record.goals).toEqual({ protein: 180 })
        expect(record.hit).toBe(true)
    })

    it("keeps the meals it closed", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { closeStaleDays } = await load()

        await closeStaleDays("2026-07-19")

        // Closing freezes a summary; it is not a delete. `list --all` still works.
        expect((await readAll()).meals).toHaveLength(1)
    })

    it("records an unjudged day when no goals were set", async () => {
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { closeStaleDays } = await load()

        const [record] = await closeStaleDays("2026-07-19")

        expect(record.hit).toBeNull()
    })

    it("uses the real local day when none is passed", async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 19, 9, 0))
        await seed({ meals: [meal({ localDate: "2026-07-18" })], nextId: 2 })
        const { closeStaleDays } = await load()

        expect((await closeStaleDays()).map(d => d.date)).toEqual(["2026-07-18"])
    })
})

describe("getHistory", () => {
    const day = (date: string): DayRecord => ({
        date,
        totals: macros(),
        goals: {},
        hit: null,
        mealCount: 1,
        closedAt: "2026-07-19T00:00:00.000Z",
    })

    it("is empty before anything is closed", async () => {
        const { getHistory } = await load()

        expect(await getHistory()).toEqual([])
    })

    it("returns most recent first", async () => {
        await seed({ days: [day("2026-07-16"), day("2026-07-18"), day("2026-07-17")] })
        const { getHistory } = await load()

        expect((await getHistory()).map(d => d.date)).toEqual(["2026-07-18", "2026-07-17", "2026-07-16"])
    })

    it("honours a limit", async () => {
        await seed({ days: [day("2026-07-16"), day("2026-07-17"), day("2026-07-18")] })
        const { getHistory } = await load()

        expect((await getHistory(2)).map(d => d.date)).toEqual(["2026-07-18", "2026-07-17"])
    })

    it("returns everything when the limit exceeds what exists", async () => {
        await seed({ days: [day("2026-07-18")] })
        const { getHistory } = await load()

        expect(await getHistory(7)).toHaveLength(1)
    })

    it("does not mutate the stored order", async () => {
        await seed({ days: [day("2026-07-16"), day("2026-07-18")] })
        const { getHistory } = await load()

        await getHistory()

        expect((await readAll()).days.map(d => d.date)).toEqual(["2026-07-16", "2026-07-18"])
    })
})

describe("formatHistory", () => {
    const day = (over: Partial<DayRecord> = {}): DayRecord => ({
        date: "2026-07-18",
        totals: macros(),
        goals: {},
        hit: null,
        mealCount: 2,
        closedAt: "2026-07-19T00:00:00.000Z",
        ...over,
    })

    it("says so when nothing is closed", async () => {
        const { formatHistory } = await import("../src/commands.js")

        expect(formatHistory([]).join("\n")).toContain("No days closed yet")
    })

    it("shows the date and the frozen totals", async () => {
        const { formatHistory } = await import("../src/commands.js")

        const text = formatHistory([day()]).join("\n")

        expect(text).toContain("2026-07-18")
        expect(text).toContain("1500")
        expect(text).toContain("100")
    })

    it("marks hit, miss and unjudged differently", async () => {
        const { formatHistory } = await import("../src/commands.js")

        const hit = formatHistory([day({ hit: true })]).join("\n")
        const miss = formatHistory([day({ hit: false })]).join("\n")
        const unjudged = formatHistory([day({ hit: null })]).join("\n")

        expect(hit).toContain("✓")
        expect(miss).toContain("✗")
        // A day with no goals must not read as a failure.
        expect(unjudged).not.toContain("✗")
        expect(unjudged).not.toContain("✓")
    })

    it("prints one line per day plus a header", async () => {
        const { formatHistory } = await import("../src/commands.js")

        expect(formatHistory([day(), day({ date: "2026-07-17" })])).toHaveLength(3)
    })
})
