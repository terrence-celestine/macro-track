/**
 * The actual work behind each command.
 *
 * These were inline in commander's .action() handlers, which meant the menu
 * would have had to duplicate them. Pulled out here so both entry points call
 * the same code and print the same output.
 */

import chalk from "chalk"
import { defaultData, readData, writeData } from "./storage.js"
import { toLocalDate, todayLocalDate } from "./date.js"
import { type DayRecord, type Goals, type Macros, type Meal } from "./types.js"

export type MealInput = {
    title: string
    protein: number
    carbs: number
    fats: number
    kcals: number
}

export const addMeal = async (input: MealInput): Promise<Meal> => {
    const data = await readData()

    // One Date for both fields, so the timestamp and the day bucket can never
    // disagree across a midnight boundary.
    const now = new Date()

    const meal: Meal = {
        id: data.nextId,
        title: input.title,
        cals: input.kcals,
        protein: input.protein,
        carbs: input.carbs,
        fats: input.fats,
        createdAt: now.toISOString(),
        localDate: toLocalDate(now),
    }

    data.meals.push(meal)
    data.nextId += 1
    await writeData(data)

    return meal
}

export const listMeals = async (): Promise<Meal[]> => {
    const data = await readData()
    return data.meals
}

/** Meals belonging to one local calendar day, YYYY-MM-DD. */
export const mealsOn = async (date: string): Promise<Meal[]> => {
    const data = await readData()
    return data.meals.filter(meal => meal.localDate === date)
}

/** Meals logged so far on the machine's current local day. */
export const todaysMeals = async (): Promise<Meal[]> => mealsOn(todayLocalDate())

export const clearMeals = async (): Promise<void> => {
    const data = await readData()
    // Goals outlive the meal log — clearing what you ate should not silently
    // wipe the targets you set.
    await writeData({ ...defaultData(), goals: data.goals })
}

/* --- goals --- */

export const getGoals = async (): Promise<Goals> => {
    const data = await readData()
    return data.goals
}

/** True when no macro has a target yet. */
export const hasGoals = (goals: Goals): boolean => Object.keys(goals).length > 0

/**
 * Merges a partial goal into whatever is already stored.
 *
 * Undefined keys are stripped first — object spread would otherwise write
 * `{ protein: undefined }` over an existing target, so `goal set -c 200` would
 * quietly erase the protein goal it was never asked to touch.
 */
export const setGoals = async (update: Goals): Promise<Goals> => {
    const data = await readData()

    const provided = Object.fromEntries(
        Object.entries(update).filter(([, value]) => value !== undefined),
    ) as Goals

    data.goals = { ...data.goals, ...provided }
    await writeData(data)

    return data.goals
}

export const clearGoals = async (): Promise<void> => {
    const data = await readData()
    data.goals = {}
    await writeData(data)
}

/**
 * Adds up the four macro fields. Returns a Macros rather than a bare object so
 * meals, totals, and (later) goals all stay the same shape and can be compared
 * field by field without conversion.
 */
export const sumMacros = (meals: Meal[]): Macros =>
    meals.reduce<Macros>(
        (total, meal) => ({
            protein: total.protein + meal.protein,
            carbs: total.carbs + meal.carbs,
            fats: total.fats + meal.fats,
            cals: total.cals + meal.cals,
        }),
        { protein: 0, carbs: 0, fats: 0, cals: 0 },
    )

/* --- shared output helpers, so both entry points read identically --- */

export const formatAdded = (meal: Meal): string => {
    return chalk.green(
        `✓ Added meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs} - Calories: ${meal.cals}`,
    )
}

export const formatMeal = (meal: Meal): string => {
    return chalk.green(
        `✓ Found meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs}`,
    )
}

/** Trims a trailing ".0" so whole numbers read as 14 rather than 14.0. */
const grams = (n: number): string => `${Math.round(n * 10) / 10}`

/** The four macros in display order, with their labels and units. */
const MACRO_ROWS = [
    { key: "cals", label: "Calories", unit: "" },
    { key: "protein", label: "Protein", unit: "g" },
    { key: "carbs", label: "Carbs", unit: "g" },
    { key: "fats", label: "Fats", unit: "g" },
] as const

const LABEL_WIDTH = 9 // "Calories:" — the longest label plus its colon

/**
 * One macro's line: the running total, then the target and what's left if a
 * goal exists for that macro. Macros without a goal render exactly as they did
 * before goals existed, which is what keeps a partially-set goal readable.
 */
const formatMacroRow = (
    label: string,
    unit: string,
    total: number,
    goal: number | undefined,
): string => {
    const padded = `${label}:`.padEnd(LABEL_WIDTH)
    const value = `${chalk.cyan(grams(total))}${unit}`

    if (goal === undefined) return `  ${padded} ${value}`

    const remaining = goal - total
    const progress = `${value} / ${grams(goal)}${unit}`

    const verdict = remaining >= 0
        ? chalk.dim(`${grams(remaining)}${unit} left`)
        : chalk.yellow(`${grams(-remaining)}${unit} over`)

    return `  ${padded} ${progress.padEnd(24)} ${verdict}`
}

/**
 * The totals block for a day. Kept as an array of lines so the two entry points
 * can emit it their own way — console.log joins them, clack's log.message wants
 * them one at a time.
 *
 * `goals` is optional so callers that have no targets to show stay unchanged.
 */
export const formatTotals = (totals: Macros, mealCount: number, goals: Goals = {}): string[] => {
    const meals = `${mealCount} ${mealCount === 1 ? "meal" : "meals"}`

    return [
        chalk.bold(`Today — ${meals}`),
        ...MACRO_ROWS.map(({ key, label, unit }) =>
            formatMacroRow(label, unit, totals[key], goals[key]),
        ),
    ]
}

/**
 * One line per closed day, for `history`.
 *
 * The verdict has three states, not two: hit, missed, and unjudged for days
 * where no goals were set. Collapsing the third into "missed" would read as a
 * failure for days you never set a target on.
 */
export const formatHistory = (days: DayRecord[]): string[] => {
    if (days.length === 0) return [chalk.red("No days closed yet")]

    return [
        chalk.bold("History"),
        ...days.map(day => {
            const verdict = day.hit === null
                ? chalk.dim("–")
                : day.hit ? chalk.green("✓") : chalk.yellow("✗")

            const macros = [
                `${grams(day.totals.cals)} kcal`,
                `P ${grams(day.totals.protein)}g`,
                `C ${grams(day.totals.carbs)}g`,
                `F ${grams(day.totals.fats)}g`,
            ].join("  ")

            return `  ${day.date}  ${verdict}  ${macros}`
        }),
    ]
}

/** The goals themselves, for `goal show`. */
export const formatGoals = (goals: Goals): string[] => {
    if (!hasGoals(goals)) return [chalk.red("No goals set")]

    return [
        chalk.bold("Daily goals"),
        ...MACRO_ROWS
            .filter(({ key }) => goals[key] !== undefined)
            .map(({ key, label, unit }) =>
                `  ${`${label}:`.padEnd(LABEL_WIDTH)} ${chalk.cyan(grams(goals[key]!))}${unit}`,
            ),
    ]
}
