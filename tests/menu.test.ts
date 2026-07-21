import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm, readFile } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { MealsData } from "../src/types.js"

/**
 * The menu is driven through a mocked @clack/prompts rather than real
 * keystrokes: we queue up what each prompt should return, then assert on what
 * the menu did with it. That covers dispatch, looping, persistence and the
 * validation wiring. It deliberately does not cover arrow-key navigation or
 * rendering — that is clack's code, not ours.
 */

const CANCEL = Symbol("clack:cancel")

const mocks = vi.hoisted(() => {
    return {
        selectQueue: [] as unknown[],
        textQueue: [] as unknown[],
        confirmQueue: [] as unknown[],
        select: vi.fn(),
        text: vi.fn(),
        confirm: vi.fn(),
        intro: vi.fn(),
        outro: vi.fn(),
        cancel: vi.fn(),
        logSuccess: vi.fn(),
        logWarn: vi.fn(),
        logMessage: vi.fn(),
    }
})

vi.mock("@clack/prompts", () => ({
    intro: mocks.intro,
    outro: mocks.outro,
    cancel: mocks.cancel,
    log: {
        success: mocks.logSuccess,
        warn: mocks.logWarn,
        message: mocks.logMessage,
    },
    // The real isCancel tests for clack's private symbol; ours stands in for it.
    isCancel: (value: unknown) => value === CANCEL,
    select: mocks.select,
    text: mocks.text,
    confirm: mocks.confirm,
}))

let dataDir: string
let exitSpy: ReturnType<typeof vi.spyOn>

/** Thrown in place of a real process.exit so a test can assert the menu bailed. */
class ProcessExit extends Error {
    constructor(public code: number) {
        super(`process.exit(${code})`)
    }
}

/** Queue the values the select prompt should return, in order. */
const queueSelect = (...values: unknown[]) => mocks.selectQueue.push(...values)

/** Queue the values the text prompt should return, in order. */
const queueText = (...values: unknown[]) => mocks.textQueue.push(...values)

/** Queue the answers the confirm prompt should return, in order. */
const queueConfirm = (...values: unknown[]) => mocks.confirmQueue.push(...values)

/**
 * storage.ts reads MACRO_TRACK_DIR once at import time, so the env var has to
 * be set before the module graph loads. resetModules + dynamic import gives
 * each test a fresh graph pointed at its own throwaway directory.
 */
async function loadMenu() {
    vi.resetModules()
    const { runMenu } = await import("../src/menu.js")
    return runMenu
}

const dataFile = () => join(dataDir, "macros.json")

const readData = async (): Promise<MealsData> =>
    JSON.parse(await readFile(dataFile(), "utf-8"))

/**
 * Writes starting data for a test. Resets the graph first for the same reason
 * loadMenu does — a cached storage module is still bound to whichever temp
 * directory was live when it was first imported.
 */
const seed = async (data: Partial<MealsData>) => {
    vi.resetModules()
    const { writeData, defaultData } = await import("../src/storage.js")
    await writeData({ ...defaultData(), ...data })
}

const meal = (over: Partial<MealsData["meals"][number]> = {}) => ({
    id: 1,
    title: "ground beef",
    cals: 200,
    protein: 14,
    carbs: 20,
    fats: 6,
    createdAt: new Date().toISOString(),
    localDate: "2026-07-19",
    ...over,
})

/** The five answers the add flow asks for, in prompt order. */
const ADD_ANSWERS = ["ground beef", "14", "20", "6", "200"]

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-menu-"))
    process.env.MACRO_TRACK_DIR = dataDir

    mocks.selectQueue.length = 0
    mocks.textQueue.length = 0
    mocks.confirmQueue.length = 0
    vi.clearAllMocks()

    mocks.select.mockImplementation(async () => {
        if (mocks.selectQueue.length === 0) throw new Error("select called more times than queued")
        return mocks.selectQueue.shift()
    })
    mocks.text.mockImplementation(async () => {
        if (mocks.textQueue.length === 0) throw new Error("text called more times than queued")
        return mocks.textQueue.shift()
    })
    mocks.confirm.mockImplementation(async () => {
        if (mocks.confirmQueue.length === 0) throw new Error("confirm called more times than queued")
        return mocks.confirmQueue.shift()
    })

    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new ProcessExit(code ?? 0)
    }) as never)
})

afterEach(async () => {
    exitSpy.mockRestore()
    delete process.env.MACRO_TRACK_DIR
    await rm(dataDir, { recursive: true, force: true })
})

describe("menu dispatch", () => {
    it("exits without touching the data file", async () => {
        queueSelect("exit")

        await (await loadMenu())()

        expect(existsSync(dataFile())).toBe(false)
    })

    it("shows the banner once and the outro once", async () => {
        queueSelect("list", "list", "exit")

        await (await loadMenu())()

        // Regression: recursing into runMenu reprinted the intro on the way in
        // and stacked an outro per level on the way out.
        expect(mocks.intro).toHaveBeenCalledTimes(1)
        expect(mocks.outro).toHaveBeenCalledTimes(1)
    })

    it("returns to the menu after an action", async () => {
        queueSelect("list", "list", "list", "exit")

        await (await loadMenu())()

        expect(mocks.select).toHaveBeenCalledTimes(4)
    })
})

describe("menu: add", () => {
    it("persists the meal", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const data = await readData()
        expect(data.meals).toHaveLength(1)
        expect(data.meals[0]).toMatchObject({
            id: 1,
            title: "ground beef",
            protein: 14,
            carbs: 20,
            fats: 6,
            cals: 200,
        })
    })

    it("asks for title and four macros, in order", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const asked = mocks.text.mock.calls.map(([opts]) => (opts as { message: string }).message)
        expect(asked).toEqual([
            "What did you eat?",
            "Protein (g)",
            "Carbs (g)",
            "Fats (g)",
            "Calories",
        ])
    })

    it("trims the title", async () => {
        queueSelect("add", "exit")
        queueText("  ground beef  ", "14", "20", "6", "200")

        await (await loadMenu())()

        expect((await readData()).meals[0].title).toBe("ground beef")
    })

    it("stores macros as numbers, not strings", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const stored = (await readData()).meals[0]
        for (const key of ["protein", "carbs", "fats", "cals"] as const) {
            expect(typeof stored[key]).toBe("number")
        }
    })

    it("accepts zero and decimal values", async () => {
        queueSelect("add", "exit")
        queueText("olive oil", "0", "0", "14.2", "126")

        await (await loadMenu())()

        expect((await readData()).meals[0]).toMatchObject({ protein: 0, carbs: 0, fats: 14.2 })
    })

    it("increments ids across repeated adds in one session", async () => {
        queueSelect("add", "add", "exit")
        queueText(...ADD_ANSWERS, "rice", "4", "45", "1", "200")

        await (await loadMenu())()

        const data = await readData()
        expect(data.meals.map(m => m.id)).toEqual([1, 2])
        expect(data.nextId).toBe(3)
    })

    it("stamps a parseable createdAt", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const { createdAt } = (await readData()).meals[0]
        expect(Number.isNaN(Date.parse(createdAt))).toBe(false)
    })

    it("stamps today's local date", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const { todayLocalDate } = await import("../src/date.js")
        expect((await readData()).meals[0].localDate).toBe(todayLocalDate())
    })

    it("derives localDate from local time, not the UTC timestamp", async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)

        await (await loadMenu())()

        const { createdAt, localDate } = (await readData()).meals[0]
        const { toLocalDate } = await import("../src/date.js")

        // These differ whenever the machine's offset pushes the instant across
        // midnight — that divergence is the reason the field exists.
        expect(localDate).toBe(toLocalDate(new Date(createdAt)))
    })
})

describe("menu: add validation", () => {
    /** Pulls the validate fn clack was handed for a given prompt. */
    const validatorFor = (message: string) => {
        const call = mocks.text.mock.calls.find(([opts]) => (opts as { message: string }).message === message)
        if (!call) throw new Error(`no prompt asked "${message}"`)
        return (call[0] as { validate: (v: string) => string | undefined }).validate
    }

    beforeEach(async () => {
        queueSelect("add", "exit")
        queueText(...ADD_ANSWERS)
        await (await loadMenu())()
    })

    it("rejects a non-numeric macro", () => {
        expect(validatorFor("Protein (g)")("abc")).toBeTruthy()
    })

    it("rejects a partially numeric macro", () => {
        // Regression: parseFloat("12abc") silently returned 12.
        expect(validatorFor("Protein (g)")("12abc")).toBeTruthy()
    })

    it("rejects a negative macro", () => {
        expect(validatorFor("Carbs (g)")("-4")).toBeTruthy()
    })

    it("rejects an empty macro", () => {
        expect(validatorFor("Fats (g)")("")).toBeTruthy()
    })

    it("accepts zero", () => {
        expect(validatorFor("Protein (g)")("0")).toBeUndefined()
    })

    it("accepts a decimal", () => {
        expect(validatorFor("Calories")("164.5")).toBeUndefined()
    })

    it("rejects a blank title", () => {
        expect(validatorFor("What did you eat?")("   ")).toBeTruthy()
    })

    it("accepts a real title", () => {
        expect(validatorFor("What did you eat?")("rice")).toBeUndefined()
    })
})

describe("menu: list", () => {
    it("warns when there is nothing logged", async () => {
        queueSelect("list", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("no meals"))
    })

    it("prints a line per meal", async () => {
        await seed({ meals: [meal(), meal({ id: 2, title: "rice" })], nextId: 3 })
        queueSelect("list", "exit")

        await (await loadMenu())()

        expect(mocks.logMessage).toHaveBeenCalledTimes(2)
        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed).toContain("ground beef")
        expect(printed).toContain("rice")
    })

    it("leaves the data file unchanged", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        const before = await readData()
        queueSelect("list", "exit")

        await (await loadMenu())()

        expect(await readData()).toEqual(before)
    })
})

describe("menu: today", () => {
    it("prints totals with nothing logged", async () => {
        queueSelect("today", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("Nothing logged yet today"))
    })

    it("sums today's meals", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        const today = todayLocalDate()
        await seed({
            meals: [
                meal({ localDate: today }),
                meal({ id: 2, title: "rice", protein: 4, carbs: 45, fats: 1, cals: 200, localDate: today }),
            ],
            nextId: 3,
        })
        queueSelect("today", "exit")

        await (await loadMenu())()

        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed).toContain("2 meals")
        expect(printed).toContain("400")
        expect(printed).toContain("18")
    })

    it("excludes meals from other days", async () => {
        await seed({ meals: [meal({ localDate: "2020-01-01" })], nextId: 2 })
        queueSelect("today", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("Nothing logged yet today"))
        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed).not.toContain("ground beef")
    })

    it("lists today's meals after the totals", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({ meals: [meal({ localDate: todayLocalDate() })], nextId: 2 })
        queueSelect("today", "exit")

        await (await loadMenu())()

        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed.indexOf("Calories")).toBeLessThan(printed.indexOf("ground beef"))
    })
})

describe("menu: goals", () => {
    it("stores what was entered", async () => {
        queueSelect("goals", "exit")
        queueText("2000", "180", "200", "60")

        await (await loadMenu())()

        const { getGoals } = await import("../src/commands.js")
        expect(await getGoals()).toEqual({ cals: 2000, protein: 180, carbs: 200, fats: 60 })
    })

    it("treats a blank answer as leave-this-alone", async () => {
        await seed({ goals: { protein: 180, cals: 2000 } })
        queueSelect("goals", "exit")
        queueText("", "", "200", "")

        await (await loadMenu())()

        const { getGoals } = await import("../src/commands.js")
        expect(await getGoals()).toEqual({ protein: 180, cals: 2000, carbs: 200 })
    })

    it("pre-fills the prompt with the current target", async () => {
        await seed({ goals: { protein: 180 } })
        queueSelect("goals", "exit")
        queueText("", "", "", "")

        await (await loadMenu())()

        const proteinPrompt = mocks.text.mock.calls
            .map(([opts]) => opts as { message: string; placeholder?: string })
            .find(o => o.message.startsWith("Protein target"))!

        expect(proteinPrompt.placeholder).toBe("180")
    })

    it("asks for all four targets", async () => {
        queueSelect("goals", "exit")
        queueText("", "", "", "")

        await (await loadMenu())()

        expect(mocks.text).toHaveBeenCalledTimes(4)
    })

    it("validates entered targets", async () => {
        queueSelect("goals", "exit")
        queueText("", "", "", "")

        await (await loadMenu())()

        const validate = (mocks.text.mock.calls[0][0] as { validate: (v: string) => string | undefined }).validate
        expect(validate("abc")).toBeTruthy()
        expect(validate("-4")).toBeTruthy()
        // Blank is how you skip, so it must not be rejected.
        expect(validate("")).toBeUndefined()
    })
})

describe("menu: today against goals", () => {
    it("shows remaining once a goal is set", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({
            meals: [meal({ localDate: todayLocalDate() })],
            nextId: 2,
            goals: { protein: 180 },
        })
        queueSelect("today", "exit")

        await (await loadMenu())()

        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed).toContain("166")
        expect(printed).toContain("left")
    })
})

describe("menu: delete", () => {
    const closedDay = (date: string) => ({
        date,
        totals: { protein: 14, carbs: 20, fats: 6, cals: 200 },
        goals: {},
        hit: null,
        mealCount: 1,
        closedAt: "2026-07-20T00:00:00.000Z",
    })

    it("says so when there is nothing deletable", async () => {
        queueSelect("delete", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("Nothing to delete"))
    })

    it("deletes the chosen meal once confirmed", async () => {
        await seed({ meals: [meal({ id: 1 }), meal({ id: 2, title: "rice" })], nextId: 3 })
        queueSelect("delete", 1, "exit")
        queueConfirm(true)

        await (await loadMenu())()

        expect((await readData()).meals.map(m => m.title)).toEqual(["rice"])
    })

    it("keeps the meal when the confirm is declined", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        queueSelect("delete", 1, "exit")
        queueConfirm(false)

        await (await loadMenu())()

        expect((await readData()).meals).toHaveLength(1)
    })

    it("defaults the confirm to no", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        queueSelect("delete", 1, "exit")
        queueConfirm(false)

        await (await loadMenu())()

        const [opts] = mocks.confirm.mock.calls[0] as [{ initialValue: boolean }]
        // Enter-by-reflex should not destroy anything.
        expect(opts.initialValue).toBe(false)
    })

    it("names the meal in the confirm prompt", async () => {
        await seed({ meals: [meal({ id: 1, title: "typo meal" })], nextId: 2 })
        queueSelect("delete", 1, "exit")
        queueConfirm(false)

        await (await loadMenu())()

        const [opts] = mocks.confirm.mock.calls[0] as [{ message: string }]
        expect(opts.message).toContain("typo meal")
    })

    it("does not offer meals from recorded days", async () => {
        await seed({
            meals: [
                meal({ id: 1, localDate: "2026-07-18", title: "locked" }),
                meal({ id: 2, localDate: "2026-07-19", title: "open" }),
            ],
            nextId: 3,
            days: [closedDay("2026-07-18")],
        })
        queueSelect("delete", 2, "exit")
        queueConfirm(true)

        await (await loadMenu())()

        // The picker is the second select call; the first is the main menu.
        const [opts] = mocks.select.mock.calls[1] as [{ options: { label: string }[] }]
        expect(opts.options.map(o => o.label)).toEqual(["open"])
    })

    it("does not confirm when there is nothing to delete", async () => {
        queueSelect("delete", "exit")

        await (await loadMenu())()

        expect(mocks.confirm).not.toHaveBeenCalled()
    })
})

describe("menu: edit", () => {
    const closedDay = (date: string) => ({
        date,
        totals: { protein: 14, carbs: 20, fats: 6, cals: 200 },
        goals: {},
        hit: null,
        mealCount: 1,
        closedAt: "2026-07-20T00:00:00.000Z",
    })

    it("says so when there is nothing editable", async () => {
        queueSelect("edit", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("Nothing to edit"))
    })

    it("applies the values entered", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        queueSelect("edit", 1, "exit")
        queueText("chicken", "300", "40", "10", "5")

        await (await loadMenu())()

        expect((await readData()).meals[0]).toMatchObject({
            title: "chicken", cals: 300, protein: 40, carbs: 10, fats: 5,
        })
    })

    it("treats a blank answer as leave-this-alone", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        queueSelect("edit", 1, "exit")
        queueText("", "", "40", "", "")

        await (await loadMenu())()

        const stored = (await readData()).meals[0]
        expect(stored.protein).toBe(40)
        expect(stored.title).toBe("ground beef")
        expect(stored.cals).toBe(200)
    })

    it("pre-fills each prompt with the current value", async () => {
        await seed({ meals: [meal({ id: 1, title: "ground beef", protein: 14 })], nextId: 2 })
        queueSelect("edit", 1, "exit")
        queueText("", "", "", "", "")

        await (await loadMenu())()

        const prompts = mocks.text.mock.calls
            .map(([opts]) => opts as { message: string; placeholder?: string })

        expect(prompts.find(p => p.message === "Title")!.placeholder).toBe("ground beef")
        expect(prompts.find(p => p.message === "Protein (g)")!.placeholder).toBe("14")
    })

    it("does not offer meals from recorded days", async () => {
        await seed({
            meals: [
                meal({ id: 1, localDate: "2026-07-18", title: "locked" }),
                meal({ id: 2, localDate: "2026-07-19", title: "open" }),
            ],
            nextId: 3,
            days: [closedDay("2026-07-18")],
        })
        queueSelect("edit", 2, "exit")
        queueText("", "", "", "", "")

        await (await loadMenu())()

        const [opts] = mocks.select.mock.calls[1] as [{ options: { label: string }[] }]
        expect(opts.options.map(o => o.label)).toEqual(["open"])
    })

    it("does not confirm — editing is not destructive", async () => {
        await seed({ meals: [meal({ id: 1 })], nextId: 2 })
        queueSelect("edit", 1, "exit")
        queueText("", "", "", "", "")

        await (await loadMenu())()

        expect(mocks.confirm).not.toHaveBeenCalled()
    })
})

describe("menu: history", () => {
    const day = (date: string, hit: boolean | null) => ({
        date,
        totals: { protein: 100, carbs: 150, fats: 40, cals: 1500 },
        goals: {},
        hit,
        mealCount: 2,
        closedAt: "2026-07-19T00:00:00.000Z",
    })

    it("says so when nothing is closed", async () => {
        queueSelect("history", "exit")

        await (await loadMenu())()

        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed).toContain("No days closed yet")
    })

    it("lists closed days, most recent first", async () => {
        await seed({ days: [day("2026-07-17", true), day("2026-07-18", false)] })
        queueSelect("history", "exit")

        await (await loadMenu())()

        const printed = mocks.logMessage.mock.calls.map(([line]) => line).join("\n")
        expect(printed.indexOf("2026-07-18")).toBeLessThan(printed.indexOf("2026-07-17"))
    })
})

describe("menu: clear", () => {
    it("removes all meals and resets the counter", async () => {
        await seed({ meals: [meal(), meal({ id: 2, title: "rice" })], nextId: 3 })
        queueSelect("clear", "exit")

        await (await loadMenu())()

        expect(await readData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [] })
    })

    it("warns and writes nothing when there is nothing to clear", async () => {
        queueSelect("clear", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("no meals to clear"))
        expect(existsSync(dataFile())).toBe(false)
    })

    it("lets meals be added again afterwards", async () => {
        await seed({ meals: [meal()], nextId: 2 })
        queueSelect("clear", "add", "exit")
        queueText("rice", "4", "45", "1", "200")

        await (await loadMenu())()

        const data = await readData()
        expect(data.meals).toHaveLength(1)
        expect(data.meals[0].id).toBe(1)
    })
})

describe("menu: cancellation", () => {
    it("exits zero when cancelled at the main menu", async () => {
        queueSelect(CANCEL)

        await expect((await loadMenu())()).rejects.toThrow(ProcessExit)
        expect(exitSpy).toHaveBeenCalledWith(0)
    })

    it("says it cancelled", async () => {
        queueSelect(CANCEL)

        await expect((await loadMenu())()).rejects.toThrow(ProcessExit)
        expect(mocks.cancel).toHaveBeenCalled()
    })

    it("writes nothing when cancelled partway through an add", async () => {
        queueSelect("add")
        queueText("ground beef", "14", CANCEL)

        await expect((await loadMenu())()).rejects.toThrow(ProcessExit)

        // A half-entered meal must not reach disk.
        expect(existsSync(dataFile())).toBe(false)
    })

    it("stops prompting once cancelled", async () => {
        queueSelect("add")
        queueText("ground beef", CANCEL)

        await expect((await loadMenu())()).rejects.toThrow(ProcessExit)

        // Title + protein, then it bails — carbs/fats/calories never asked.
        expect(mocks.text).toHaveBeenCalledTimes(2)
    })
})
