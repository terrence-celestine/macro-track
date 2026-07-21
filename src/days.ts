/**
 * Day records: freezing a finished day into a verdict.
 *
 * Two ideas live here. First, goals point in a direction — protein is a floor
 * you want to clear, calories are a ceiling you want to stay under — so "hit"
 * cannot be a single comparison. Second, a day is frozen rather than derived,
 * so changing a goal today does not rewrite whether you hit it last week.
 */

import { readData, writeData } from "./storage.js"
import { todayLocalDate } from "./date.js"
import { sumMacros } from "./meals.js"
import { type DayRecord, type Goals, type Macros, type Meal } from "./types.js"

/**
 * Which way each target points.
 *
 * Protein is a minimum — eating more than the target is a win. The other three
 * are maximums.
 *
 * Fixed by decision, not by omission: this doesn't vary in practice, and making
 * it configurable would mean a direction field on every stored goal plus a
 * migration for existing day records. If that ever changes, those are the two
 * costs to plan for.
 */
export const GOAL_DIRECTION = {
    protein: "min",
    carbs: "max",
    fats: "max",
    cals: "max",
} as const satisfies Record<keyof Macros, "min" | "max">

const MACRO_KEYS = Object.keys(GOAL_DIRECTION) as (keyof Macros)[]

/** Whether one macro met its target, respecting that macro's direction. */
export const macroHit = (key: keyof Macros, total: number, goal: number): boolean =>
    GOAL_DIRECTION[key] === "min" ? total >= goal : total <= goal

/**
 * The whole-day verdict.
 *
 * Returns null when no goals were set, which is not the same as missing them —
 * a day you never set targets for should read as unjudged, not as a failure.
 * Macros without a target are ignored, so a protein-only goal is judged on
 * protein alone.
 */
export const dayHit = (totals: Macros, goals: Goals): boolean | null => {
    const judged = MACRO_KEYS.filter(key => goals[key] !== undefined)
    if (judged.length === 0) return null

    return judged.every(key => macroHit(key, totals[key], goals[key]!))
}

/** Freezes one day's meals into a record. */
export const buildDayRecord = (
    date: string,
    meals: Meal[],
    goals: Goals,
    closedAt: string = new Date().toISOString(),
): DayRecord => {
    const totals = sumMacros(meals)

    return {
        date,
        totals,
        // Copied, not referenced — a later goal change must not reach in here.
        goals: { ...goals },
        hit: dayHit(totals, goals),
        mealCount: meals.length,
        closedAt,
    }
}

/**
 * Freezes every past day that has meals and no record yet.
 *
 * Called at the start of each command, so the first thing you run on a new day
 * closes out the ones before it. Days are matched on `localDate`, so "past"
 * means past for the person, not past in UTC.
 *
 * Returns the records it created, and writes nothing when there is nothing to
 * close — commands that only read must not touch the file.
 */
export const closeStaleDays = async (today: string = todayLocalDate()): Promise<DayRecord[]> => {
    const data = await readData()

    const alreadyClosed = new Set(data.days.map(day => day.date))
    const stale = [...new Set(data.meals.map(meal => meal.localDate))]
        .filter(date => date < today && !alreadyClosed.has(date))
        .sort()

    if (stale.length === 0) return []

    const created = stale.map(date =>
        buildDayRecord(date, data.meals.filter(meal => meal.localDate === date), data.goals),
    )

    data.days.push(...created)
    await writeData(data)

    return created
}

/** Closed days, most recent first. */
export const getHistory = async (limit?: number): Promise<DayRecord[]> => {
    const data = await readData()
    const ordered = [...data.days].sort((a, b) => b.date.localeCompare(a.date))

    return limit === undefined ? ordered : ordered.slice(0, limit)
}
