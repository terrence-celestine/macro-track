import { describe, it, expect } from "vitest"

import { useCliSandbox, ADD_ARGS } from "./helpers/cli.js"

const { run, readData, writeData, backdateMeals } = useCliSandbox()

describe("list", () => {
    it("exits 0 with no meals", async () => {
        const { code, stdout } = await run("list")

        expect(code).toBe(0)
        expect(stdout).toContain("no meals")
    })

    it("prints each meal", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const { stdout } = await run("list")

        expect(stdout).toContain("ground beef")
        expect(stdout).toContain("rice")
    })

    it("leaves the data file unchanged", async () => {
        await run(...ADD_ARGS)
        const before = await readData()

        await run("list")

        expect(await readData()).toEqual(before)
    })

    it("shows only today by default", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeData(data)

        const { stdout } = await run("list")

        expect(stdout).not.toContain("ground beef")
        expect(stdout).toContain("rice")
    })

    it("shows every meal with --all", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeData(data)

        const { stdout } = await run("list", "--all")

        expect(stdout).toContain("ground beef")
        expect(stdout).toContain("rice")
    })

    it("supports the -a short flag", async () => {
        await run(...ADD_ARGS)

        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeData(data)

        const { stdout } = await run("list", "-a")

        expect(stdout).toContain("ground beef")
    })
})

describe("today", () => {
    it("exits 0 with nothing logged", async () => {
        const { code, stdout } = await run("today")

        expect(code).toBe(0)
        expect(stdout).toContain("Nothing logged yet today")
    })

    it("shows zeros rather than an empty block on a blank day", async () => {
        const { stdout } = await run("today")

        expect(stdout).toContain("0 meals")
    })

    it("sums the day's macros", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const { stdout } = await run("today")

        expect(stdout).toContain("2 meals")
        expect(stdout).toContain("400")   // calories
        expect(stdout).toContain("18")    // protein
        expect(stdout).toContain("65")    // carbs
    })

    it("lists the day's meals under the totals", async () => {
        await run(...ADD_ARGS)

        const { stdout } = await run("today")

        expect(stdout).toContain("ground beef")
        expect(stdout.indexOf("Calories")).toBeLessThan(stdout.indexOf("ground beef"))
    })

    it("ignores meals from other days", async () => {
        await run(...ADD_ARGS)

        // Rewrite the stored meal onto a different local day, which is what a
        // meal logged yesterday looks like on disk.
        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeData(data)

        const { stdout } = await run("today")

        expect(stdout).toContain("Nothing logged yet today")
        expect(stdout).not.toContain("ground beef")
    })

    it("leaves the data file unchanged", async () => {
        await run(...ADD_ARGS)
        const before = await readData()

        await run("today")

        expect(await readData()).toEqual(before)
    })
})

describe("goal", () => {
    it("reports nothing set before any target exists", async () => {
        const { code, stdout } = await run("goal", "show")

        expect(code).toBe(0)
        expect(stdout).toContain("No goals set")
    })

    it("stores a full set of targets", async () => {
        await run("goal", "set", "-p", "180", "-c", "200", "-f", "60", "-k", "2000")

        const { stdout } = await run("goal", "show")
        expect(stdout).toContain("180")
        expect(stdout).toContain("2000")
    })

    it("accepts a single macro", async () => {
        const { code } = await run("goal", "set", "-p", "180")

        expect(code).toBe(0)
        expect((await readData()).goals).toEqual({ protein: 180 })
    })

    it("merges a later partial set into the earlier one", async () => {
        await run("goal", "set", "-p", "180", "-k", "2000")
        await run("goal", "set", "-c", "200")

        // Regression: spreading commander's options object writes undefined
        // over the macros this call did not mention, wiping them.
        expect((await readData()).goals).toEqual({ protein: 180, cals: 2000, carbs: 200 })
    })

    it("rejects a set with no flags", async () => {
        const { code, stderr } = await run("goal", "set")

        expect(code).not.toBe(0)
        expect(stderr).toContain("at least one")
    })

    it("validates targets the same way meals are validated", async () => {
        expect((await run("goal", "set", "-p", "abc")).code).not.toBe(0)
        expect((await run("goal", "set", "-p", "-4")).code).not.toBe(0)
        expect((await run("goal", "set", "-p", "12abc")).code).not.toBe(0)
    })

    it("clears every target", async () => {
        await run("goal", "set", "-p", "180", "-k", "2000")

        const { code } = await run("goal", "clear")

        expect(code).toBe(0)
        expect((await readData()).goals).toEqual({})
    })

    it("survives clearing the meal log", async () => {
        await run(...ADD_ARGS)
        await run("goal", "set", "-p", "180")

        await run("clear")

        expect((await readData()).goals).toEqual({ protein: 180 })
    })
})

describe("today against goals", () => {
    it("shows remaining macros once a goal is set", async () => {
        await run("goal", "set", "-p", "180")
        await run(...ADD_ARGS)

        const { stdout } = await run("today")

        expect(stdout).toContain("180")
        expect(stdout).toContain("166")   // 180 - 14
        expect(stdout).toContain("left")
    })

    it("says over once the target is passed", async () => {
        await run("goal", "set", "-p", "10")
        await run(...ADD_ARGS)

        const { stdout } = await run("today")

        expect(stdout).toContain("over")
    })

    it("looks unchanged when no goal is set", async () => {
        await run(...ADD_ARGS)

        const { stdout } = await run("today")

        expect(stdout).not.toContain("left")
        expect(stdout).not.toContain("over")
    })
})

describe("history", () => {
    it("reports nothing before any day is closed", async () => {
        const { code, stdout } = await run("history")

        expect(code).toBe(0)
        expect(stdout).toContain("No days closed yet")
    })

    it("does not create a data file just by asking", async () => {
        await run("history")

        // Lazy close runs on every command; a read-only command must stay
        // read-only when there is nothing stale.
        await expect(readData()).rejects.toThrow()
    })

    it("closes a past day on the next command", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        const { stdout } = await run("history")

        expect(stdout).toContain("2020-01-01")
    })

    it("freezes the totals into the record", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")

        const [record] = (await readData()).days
        expect(record.totals).toEqual({ protein: 14, carbs: 20, fats: 6, cals: 200 })
        expect(record.mealCount).toBe(1)
    })

    it("does not double-close on repeated commands", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")
        await run("history")
        await run("today")

        expect((await readData()).days).toHaveLength(1)
    })

    it("keeps the meals after closing", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")

        expect((await readData()).meals).toHaveLength(1)
        expect((await run("list", "--all")).stdout).toContain("ground beef")
    })

    it("judges the day against the goals that were set", async () => {
        await run("goal", "set", "-p", "10")
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")

        // 14g protein against a 10g floor is a hit.
        expect((await readData()).days[0].hit).toBe(true)
    })

    it("marks a missed protein floor", async () => {
        await run("goal", "set", "-p", "180")
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")

        expect((await readData()).days[0].hit).toBe(false)
    })

    it("leaves a day unjudged when no goals were set", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        await run("history")

        expect((await readData()).days[0].hit).toBeNull()
    })

    it("does not rewrite a closed day when goals change later", async () => {
        await run("goal", "set", "-p", "10")
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")
        await run("history")

        await run("goal", "set", "-p", "500")

        const [record] = (await readData()).days
        expect(record.goals).toEqual({ protein: 10 })
        expect(record.hit).toBe(true)
    })

    it("limits the number of days shown", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")
        await run("history")
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")
        await backdateMeals("2020-01-02")

        const { stdout } = await run("history", "--days", "1")

        expect(stdout).toContain("2020-01-02")
        expect(stdout).not.toContain("2020-01-01")
    })

    it("excludes closed days from today's totals", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")

        const { stdout } = await run("today")

        expect(stdout).toContain("Nothing logged yet today")
    })
})
