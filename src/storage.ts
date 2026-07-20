import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { MealsData } from "./types"

// Where our data lives
const DATA_DIR = process.env.MACRO_TRACK_DIR ?? join(homedir(), ".macro-track")
const DATA_FILE = join(DATA_DIR, "macros.json")

export const defaultData = (): MealsData => ({
    meals: [], nextId: 1
})

/**
 * Read the macros file. If it doesn't exist, return default data
 * (and create the directory so the next write succeeds).
 */
export async function readData(): Promise<MealsData> {
    if (!existsSync(DATA_FILE)) {
        await mkdir(DATA_DIR, { recursive: true })
        return defaultData()
    }

    const raw = await readFile(DATA_FILE, "utf-8")

    // File is Empty
    if (raw.trim() === "") return defaultData()

    try {
        return { ...defaultData(), ...JSON.parse(raw) };
    } catch (err) {
        console.error(`Warning: ${DATA_FILE} contained invalid JSON. Starting fresh.`)
        return defaultData()
    }
}

/**
 * Write the notes file, pretty-printed for easy debugging.
 */
export async function writeData(data: MealsData): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8")
}