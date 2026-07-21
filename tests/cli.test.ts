import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFile } from "child_process"
import { promisify } from "util"
import { mkdtemp, rm, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"

import type { MealsData } from "../src/types.js"

const exec = promisify(execFile)
const CLI = resolve(__dirname, "../src/index.ts")
const TSX = resolve(__dirname, "../node_modules/.bin/tsx")

let dataDir: string

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-cli-"))
})

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
})

type Result = { code: number; stdout: string; stderr: string }

/**
 * Runs the real CLI as a subprocess against a throwaway data directory.
 * MACRO_TRACK_DIR is the only injection point that works here — there is no
 * function to pass a path to across a process boundary.
 */
async function run(...args: string[]): Promise<Result> {
    return runWithEnv({}, ...args)
}

/** Same as run, with extra environment variables layered on — TZ, mainly. */
async function runWithEnv(extra: Record<string, string>, ...args: string[]): Promise<Result> {
    const env = { ...process.env, MACRO_TRACK_DIR: dataDir, NO_COLOR: "1", ...extra }
    try {
        const { stdout, stderr } = await exec(TSX, [CLI, ...args], { env })
        return { code: 0, stdout, stderr }
    } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string }
        return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
    }
}

/** What the local day is in a given timezone, right now. "en-CA" is YYYY-MM-DD. */
const localDayIn = (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())

const readData = async (): Promise<MealsData> =>
    JSON.parse(await readFile(join(dataDir, "macros.json"), "utf-8"))

const ADD_ARGS = ["add", "ground beef", "-p", "14", "-c", "20", "-f", "6", "-k", "200"]

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
        await writeFile(join(dataDir, "macros.json"), JSON.stringify(data), "utf-8")

        const { stdout } = await run("list")

        expect(stdout).not.toContain("ground beef")
        expect(stdout).toContain("rice")
    })

    it("shows every meal with --all", async () => {
        await run(...ADD_ARGS)
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeFile(join(dataDir, "macros.json"), JSON.stringify(data), "utf-8")

        const { stdout } = await run("list", "--all")

        expect(stdout).toContain("ground beef")
        expect(stdout).toContain("rice")
    })

    it("supports the -a short flag", async () => {
        await run(...ADD_ARGS)

        const data = await readData()
        data.meals[0].localDate = "2020-01-01"
        await writeFile(join(dataDir, "macros.json"), JSON.stringify(data), "utf-8")

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
        await writeFile(join(dataDir, "macros.json"), JSON.stringify(data), "utf-8")

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

/** Rewrites every stored meal onto a given local day, simulating a past day. */
const backdateMeals = async (date: string) => {
    const data = await readData()
    for (const meal of data.meals) meal.localDate = date
    await writeFile(join(dataDir, "macros.json"), JSON.stringify(data), "utf-8")
}

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

describe("clear", () => {
    it("removes all meals and resets the counter", async () => {
        await run(...ADD_ARGS)

        const { code } = await run("clear")

        expect(code).toBe(0)
        expect(await readData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [] })
    })

    it("exits 0 when there is nothing to clear", async () => {
        const { code } = await run("clear")

        expect(code).toBe(0)
    })

    it("lets meals be added again afterwards", async () => {
        await run(...ADD_ARGS)
        await run("clear")
        await run("add", "rice", "-p", "4", "-c", "45", "-f", "1", "-k", "200")

        const data = await readData()
        expect(data.meals).toHaveLength(1)
        expect(data.meals[0].id).toBe(1)
    })
})

describe("program", () => {
    it("exits non-zero on an unknown command", async () => {
        const { code } = await run("frobnicate")

        expect(code).not.toBe(0)
    })

    it("prints help", async () => {
        const { code, stdout } = await run("--help")

        expect(code).toBe(0)
        expect(stdout).toContain("add")
        expect(stdout).toContain("list")
        expect(stdout).toContain("clear")
        expect(stdout).toContain("today")
    })

    it("prints a version", async () => {
        const { stdout } = await run("--version")

        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    })
})
