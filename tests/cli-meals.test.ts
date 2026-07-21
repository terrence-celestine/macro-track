import { describe, it, expect } from "vitest"

import { useCliSandbox, ADD_ARGS, localDayIn } from "./helpers/cli.js"

const { run, runWithEnv, readData, backdateMeals } = useCliSandbox()

describe("add", () => {
    it("exits 0 on success", async () => {
        const { code } = await run(...ADD_ARGS)

        // Regression: every command used to end with process.exit(1), so
        // `macro-track add ... && next-thing` never ran the next thing.
        expect(code).toBe(0)
    })

    it("persists the meal", async () => {
        await run(...ADD_ARGS)

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

    it("stamps a parseable createdAt", async () => {
        await run(...ADD_ARGS)

        const { createdAt } = (await readData()).meals[0]
        expect(Number.isNaN(Date.parse(createdAt))).toBe(false)
    })

    it("stamps a localDate in YYYY-MM-DD form", async () => {
        await run(...ADD_ARGS)

        const { localDate } = (await readData()).meals[0]
        expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it("records the local day of the machine's timezone", async () => {
        const tz = "America/New_York"
        await runWithEnv({ TZ: tz }, ...ADD_ARGS)

        expect((await readData()).meals[0].localDate).toBe(localDayIn(tz))
    })

    it("files the same instant under different days in different timezones", async () => {
        // Kiritimati is UTC+14 and Midway UTC-11, so the two are never on the
        // same calendar day. If localDate were derived from the UTC timestamp
        // these would match — and a 9pm dinner would land on tomorrow's totals.
        await runWithEnv({ TZ: "Pacific/Kiritimati" }, ...ADD_ARGS)
        await runWithEnv({ TZ: "Pacific/Midway" }, "add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const [ahead, behind] = (await readData()).meals
        expect(ahead.localDate).toBe(localDayIn("Pacific/Kiritimati"))
        expect(behind.localDate).toBe(localDayIn("Pacific/Midway"))
        expect(ahead.localDate).not.toBe(behind.localDate)
    })

    it("increments ids across meals", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const data = await readData()
        expect(data.meals.map(m => m.id)).toEqual([1, 2])
        expect(data.nextId).toBe(3)
    })

    it("accepts zero as a macro value", async () => {
        // Regression: `if (!options.carbs)` treated 0 as missing, so anything
        // with no carbs — chicken breast, olive oil — could not be logged.
        const { code } = await run("add", "olive oil", "-p", "0", "-c", "0", "-f", "14", "-k", "126")

        expect(code).toBe(0)
        expect((await readData()).meals[0]).toMatchObject({ protein: 0, carbs: 0 })
    })

    it("accepts decimal values", async () => {
        await run("add", "almonds", "-p", "6.5", "-c", "5.4", "-f", "14.2", "-k", "164")

        expect((await readData()).meals[0]).toMatchObject({ protein: 6.5, fats: 14.2 })
    })

    it("supports long flags", async () => {
        const { code } = await run(
            "add", "rice",
            "--protein", "4", "--carbs", "45", "--fats", "1", "--kcals", "200",
        )

        expect(code).toBe(0)
    })
})

describe("add validation", () => {
    it("rejects a missing flag with a non-zero exit", async () => {
        const { code } = await run("add", "rice", "-p", "4", "-c", "45", "-f", "1")

        expect(code).not.toBe(0)
    })

    it("names every missing flag at once", async () => {
        const { stderr } = await run("add", "rice", "-p", "4")

        // One run should tell you everything that is wrong, not just the first.
        expect(stderr).toContain("carbs")
        expect(stderr).toContain("fats")
        expect(stderr).toContain("kcals")
    })

    it("writes nothing when validation fails", async () => {
        await run("add", "rice", "-p", "4")

        await expect(readData()).rejects.toThrow()
    })

    it("rejects a non-numeric value", async () => {
        const { code, stderr } = await run("add", "rice", "-p", "abc", "-c", "45", "-f", "1", "-k", "200")

        expect(code).not.toBe(0)
        expect(stderr).toContain("abc")
    })

    it("rejects a partially numeric value", async () => {
        // Regression: parseFloat("12abc") silently returned 12. Number() gives NaN.
        const { code } = await run("add", "rice", "-p", "12abc", "-c", "45", "-f", "1", "-k", "200")

        expect(code).not.toBe(0)
    })

    it("rejects a negative value", async () => {
        const { code } = await run("add", "rice", "-p", "-4", "-c", "45", "-f", "1", "-k", "200")

        expect(code).not.toBe(0)
    })

    it("reports errors on stderr, not stdout", async () => {
        const { stdout, stderr } = await run("add", "rice", "-p", "4")

        // So that `macro-track list > out.txt` never captures error text.
        expect(stderr.trim()).not.toBe("")
        expect(stdout).not.toContain("carbs")
    })

    it("requires a title", async () => {
        const { code } = await run("add", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        expect(code).not.toBe(0)
    })
})

describe("edit", () => {
    it("changes one macro and exits 0", async () => {
        await run(...ADD_ARGS)

        const { code, stdout } = await run("edit", "1", "-p", "40")

        expect(code).toBe(0)
        expect(stdout).toContain("40")
        expect((await readData()).meals[0].protein).toBe(40)
    })

    it("leaves the other macros alone", async () => {
        await run(...ADD_ARGS)
        await run("edit", "1", "-p", "40")

        expect((await readData()).meals[0]).toMatchObject({ carbs: 20, fats: 6, cals: 200 })
    })

    it("changes the title", async () => {
        await run(...ADD_ARGS)
        await run("edit", "1", "--title", "chicken thigh")

        expect((await readData()).meals[0].title).toBe("chicken thigh")
    })

    it("keeps id, createdAt and localDate", async () => {
        await run(...ADD_ARGS)
        const before = (await readData()).meals[0]

        await run("edit", "1", "-p", "40")

        const after = (await readData()).meals[0]
        expect(after.id).toBe(before.id)
        expect(after.createdAt).toBe(before.createdAt)
        expect(after.localDate).toBe(before.localDate)
    })

    it("rejects an edit with no flags", async () => {
        await run(...ADD_ARGS)

        const { code, stderr } = await run("edit", "1")

        expect(code).not.toBe(0)
        expect(stderr).toContain("at least one")
    })

    it("exits non-zero for an unknown id", async () => {
        const { code, stderr } = await run("edit", "99", "-p", "40")

        expect(code).not.toBe(0)
        expect(stderr).toContain("99")
    })

    it("validates macros the same way add does", async () => {
        await run(...ADD_ARGS)

        expect((await run("edit", "1", "-p", "abc")).code).not.toBe(0)
        expect((await run("edit", "1", "-p", "-4")).code).not.toBe(0)
        expect((await run("edit", "1", "-p", "12abc")).code).not.toBe(0)
    })

    it("refuses a meal from a recorded day", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")
        await run("history")

        const { code, stderr } = await run("edit", "1", "-p", "40")

        expect(code).not.toBe(0)
        expect(stderr).toContain("edited")
        expect((await readData()).meals[0].protein).toBe(14)
    })

    it("is reflected in today's totals", async () => {
        await run(...ADD_ARGS)
        await run("edit", "1", "-p", "40")

        expect((await run("today")).stdout).toContain("40")
    })
})

describe("delete", () => {
    it("removes the meal and exits 0", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const { code, stdout } = await run("delete", "1")

        expect(code).toBe(0)
        expect(stdout).toContain("ground beef")
        expect((await readData()).meals.map(m => m.title)).toEqual(["rice"])
    })

    it("exits non-zero for an unknown id", async () => {
        await run(...ADD_ARGS)

        const { code, stderr } = await run("delete", "99")

        expect(code).not.toBe(0)
        expect(stderr).toContain("99")
    })

    it("reports failures on stderr, not stdout", async () => {
        await run(...ADD_ARGS)

        const { stdout, stderr } = await run("delete", "99")

        expect(stderr.trim()).not.toBe("")
        expect(stdout).not.toContain("99")
    })

    it("rejects a non-numeric id", async () => {
        const { code } = await run("delete", "abc")

        expect(code).not.toBe(0)
    })

    it("requires an id", async () => {
        const { code } = await run("delete")

        expect(code).not.toBe(0)
    })

    it("refuses a meal from a day that is already recorded", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")
        await run("history")   // closes 2020-01-01

        const { code, stderr } = await run("delete", "1")

        expect(code).not.toBe(0)
        expect(stderr).toContain("recorded")
        expect((await readData()).meals).toHaveLength(1)
    })

    it("does not disturb the frozen record", async () => {
        await run(...ADD_ARGS)
        await backdateMeals("2020-01-01")
        await run("history")

        await run("delete", "1")

        const [record] = (await readData()).days
        expect(record.totals).toEqual({ protein: 14, carbs: 20, fats: 6, cals: 200 })
    })

    it("removes the meal from today's totals", async () => {
        await run(...ADD_ARGS)

        await run("delete", "1")

        expect((await run("today")).stdout).toContain("Nothing logged yet today")
    })

    it("does not reuse the freed id", async () => {
        await run(...ADD_ARGS)
        await run("delete", "1")
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        expect((await readData()).meals[0].id).toBe(2)
    })
})
