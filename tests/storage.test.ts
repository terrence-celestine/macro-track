import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import type { MealsData } from "../src/types.js"

/**
 * storage.ts reads MACRO_TRACK_DIR once, at module load, to build DATA_DIR.
 * Setting the env var after the module is imported has no effect — so each
 * test points the env var at a fresh temp dir, resets the module registry,
 * and re-imports to get a module bound to that directory.
 */
let dataDir: string
let dataFile: string
let storage: typeof import("../src/storage.js")

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "macro-track-test-"))
    dataFile = join(dataDir, "macros.json")
    process.env.MACRO_TRACK_DIR = dataDir

    vi.resetModules()
    storage = await import("../src/storage.js")
})

afterEach(async () => {
    delete process.env.MACRO_TRACK_DIR
    await rm(dataDir, { recursive: true, force: true })
})

const readRaw = async (): Promise<MealsData> =>
    JSON.parse(await readFile(dataFile, "utf-8"))

const makeMeal = (over: Partial<MealsData["meals"][number]> = {}) => ({
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

describe("readData", () => {
    it("returns defaults when the file does not exist", async () => {
        const data = await storage.readData()
        expect(data).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
    })

    it("creates the data directory so a later write can succeed", async () => {
        // mkdtemp already made dataDir, so remove it to test the create path.
        await rm(dataDir, { recursive: true, force: true })
        expect(existsSync(dataDir)).toBe(false)

        await storage.readData()

        expect(existsSync(dataDir)).toBe(true)
    })

    it("returns defaults when the file is empty", async () => {
        await writeFile(dataFile, "", "utf-8")
        expect(await storage.readData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
    })

    it("returns defaults when the file is only whitespace", async () => {
        await writeFile(dataFile, "   \n  ", "utf-8")
        expect(await storage.readData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
    })

    it("warns and returns defaults when the file is malformed JSON", async () => {
        const warn = vi.spyOn(console, "error").mockImplementation(() => {})
        await writeFile(dataFile, "{ not json", "utf-8")

        expect(await storage.readData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
        expect(warn).toHaveBeenCalled()

        warn.mockRestore()
    })

    it("does not destroy the malformed file", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        await writeFile(dataFile, "{ not json", "utf-8")

        await storage.readData()

        // Recovering by starting fresh in memory is fine; silently deleting a
        // user's data on disk would not be.
        expect(await readFile(dataFile, "utf-8")).toBe("{ not json")
    })

    it("reads back what was written", async () => {
        const meal = makeMeal()
        await storage.writeData({ meals: [meal], nextId: 2, goals: {}, days: [], favorites: [] })

        expect(await storage.readData()).toEqual({ meals: [meal], nextId: 2, goals: {}, days: [], favorites: [] })
    })

    it("fills in keys missing from the file", async () => {
        // A file written before `nextId` existed.
        await writeFile(dataFile, JSON.stringify({ meals: [] }), "utf-8")

        const data = await storage.readData()

        expect(data.nextId).toBe(1)
    })

    it("prefers file values over defaults", async () => {
        await writeFile(dataFile, JSON.stringify({ meals: [], nextId: 47 }), "utf-8")

        expect((await storage.readData()).nextId).toBe(47)
    })
})

describe("shared state", () => {
    it("gives each read its own meals array", async () => {
        const first = await storage.readData()
        first.meals.push(makeMeal())

        const second = await storage.readData()

        // Regression: returning a module-level DEFAULT_DATA (or a shallow copy
        // of it) leaked the same array between calls, so the second read saw a
        // meal that was never written to disk.
        expect(second.meals).toEqual([])
    })

    it("gives each read its own top-level object", async () => {
        const first = await storage.readData()
        first.nextId = 99

        expect((await storage.readData()).nextId).toBe(1)
    })

    it("keeps defaultData() unpolluted across calls", async () => {
        const a = storage.defaultData()
        a.meals.push(makeMeal())
        a.nextId = 12

        expect(storage.defaultData()).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
    })
})

describe("writeData", () => {
    it("creates the directory if it is missing", async () => {
        await rm(dataDir, { recursive: true, force: true })

        await storage.writeData({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })

        expect(existsSync(dataFile)).toBe(true)
    })

    it("writes indented JSON", async () => {
        await storage.writeData({ meals: [makeMeal()], nextId: 2, goals: {}, days: [], favorites: [] })

        expect(await readFile(dataFile, "utf-8")).toContain('\n  "nextId"')
    })

    it("overwrites rather than appends", async () => {
        await storage.writeData({ meals: [makeMeal()], nextId: 2, goals: {}, days: [], favorites: [] })
        await storage.writeData({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })

        expect(await readRaw()).toEqual({ meals: [], nextId: 1, goals: {}, days: [], favorites: [] })
    })

    it("round-trips through a directory that already has content", async () => {
        await mkdir(dataDir, { recursive: true })
        const meals = [makeMeal({ id: 1 }), makeMeal({ id: 2, title: "rice" })]

        await storage.writeData({ meals, nextId: 3, goals: {}, days: [], favorites: [] })

        expect(await storage.readData()).toEqual({ meals, nextId: 3, goals: {}, days: [], favorites: [] })
    })
})
