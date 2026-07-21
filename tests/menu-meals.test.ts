import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@clack/prompts", async () => (await import("./helpers/menu.js")).clackMock)

import {
    useMenuSandbox, mocks, meal, queueSelect, queueText, queueConfirm, ADD_ANSWERS,
} from "./helpers/menu.js"

const { loadMenu, seed, readData } = useMenuSandbox()

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

describe("menu: picker hints", () => {
    /**
     * The hint is how you tell two similarly-named meals apart in a picker, so
     * it needs all four macros. Nothing asserted this until a mutation that
     * stripped calories out of the hint passed the whole suite.
     */
    const hintFor = (callIndex: number) =>
        (mocks.select.mock.calls[callIndex][0] as { options: { hint?: string }[] }).options[0].hint!

    it("shows every macro under a meal in the delete picker", async () => {
        await seed({ meals: [meal({ id: 1, cals: 200, protein: 14, carbs: 20, fats: 6 })], nextId: 2 })
        queueSelect("delete", 1, "exit")
        queueConfirm(false)

        await (await loadMenu())()

        const hint = hintFor(1)
        expect(hint).toContain("200")
        expect(hint).toContain("14")
        expect(hint).toContain("20")
        expect(hint).toContain("6")
    })

    it("shows every macro under a favorite in the repeat picker", async () => {
        await seed({
            favorites: [{ name: "beef", cals: 200, protein: 14, carbs: 20, fats: 6, createdAt: "2026-07-19T00:00:00.000Z" }],
        })
        queueSelect("repeat", "beef", "exit")

        await (await loadMenu())()

        const hint = hintFor(1)
        expect(hint).toContain("200")
        expect(hint).toContain("14")
    })
})
