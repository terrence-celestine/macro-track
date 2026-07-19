import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// Where our data lives
const DATA_DIR = join(homedir(), ".macro-track")
const DATA_FILE = join(DATA_DIR, "macros.json")

// The shape of a single note
export type Meal = {
    id: number
    title: string
    protein: number
    cals: number
    carbs: number
    fats: number
    createdAt: string
}

// The shape of the whole data file
export type MealsData = {
    meals: Meal[]
    nextId: number
}

// The default state when the file doesn't exist yet
const DEFAULT_DATA: MealsData = {
    meals: [],
    nextId: 1,
}

/**
 * Read the notes file. If it doesn't exist, return default data
 * (and create the directory so the next write succeeds).
 */
export async function readData(): Promise<MealsData> {
    if (!existsSync(DATA_FILE)) {
        await mkdir(DATA_DIR, { recursive: true })
        return DEFAULT_DATA
    }

    const raw = await readFile(DATA_FILE, "utf-8")

    // File is Empty
    if (raw.trim() === "") return DEFAULT_DATA

    try {
        return JSON.parse(raw) as MealsData;
    } catch (err) {
        console.error(`Warning: ${DATA_FILE} contained invalid JSON. Starting fresh.`)
        return DEFAULT_DATA
    }
}

/**
 * Write the notes file, pretty-printed for easy debugging.
 */
export async function writeData(data: MealsData): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8")
}