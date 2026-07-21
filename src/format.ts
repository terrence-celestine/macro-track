/**
 * Every line the tool prints.
 *
 * Kept apart from the modules that do the work so both entry points render
 * identically — commander joins these with console.log, clack hands them to
 * log.message. Nothing here reads or writes the data file; it takes values and
 * returns strings.
 */

import chalk from "chalk"
import { hasGoals } from "./goals.js"
import {
    type DayRecord, type Favorite, type Goals, type Macros, type Meal,
} from "./types.js"
import { type FavoriteFailure } from "./favorites.js"
import { type MealFailure } from "./meals.js"

/** Trims a trailing ".0" so whole numbers read as 14 rather than 14.0. */
const grams = (n: number): string => `${Math.round(n * 10) / 10}`

/**
 * The macro breakdown shared by every "here's the meal" line.
 *
 * Added, repeated and updated meals all printed this identically; only the verb
 * differed. formatMeal deliberately does not use it — that one omits calories,
 * which is a real difference in output rather than a duplicate.
 */
const describeMacros = (meal: Meal): string =>
    `${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs} - Calories: ${meal.cals}`

/* --- meals --- */

export const formatAdded = (meal: Meal): string =>
    chalk.green(`✓ Added meal: ${describeMacros(meal)}`)

export const formatRepeated = (meal: Meal): string =>
    chalk.green(`✓ Logged again: ${describeMacros(meal)}`)

export const formatEdited = (meal: Meal): string =>
    chalk.green(`✓ Updated meal: ${describeMacros(meal)}`)

export const formatDeleted = (meal: Meal): string =>
    chalk.green(`✓ Deleted meal: ${meal.title} (id ${meal.id})`)

export const formatMeal = (meal: Meal): string =>
    chalk.green(
        `✓ Found meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs}`,
    )

/** Why a change failed, in words. The verb differs, the reasons do not. */
export const formatMealFailure = (id: number, reason: MealFailure, verb: string): string =>
    reason === "not-found"
        ? chalk.red(`No meal with id ${id}. Run \`list\` to see the ids.`)
        : chalk.yellowBright(`Meal ${id} belongs to a day that's already recorded, so it can't be ${verb}.`)

export const formatDeleteFailure = (id: number, reason: MealFailure): string =>
    formatMealFailure(id, reason, "deleted")

export const formatEditFailure = (id: number, reason: MealFailure): string =>
    formatMealFailure(id, reason, "edited")

/* --- favorites --- */

export const formatFavorited = (favorite: Favorite): string =>
    chalk.green(`✓ Saved favorite: ${favorite.name} — log it with \`repeat ${favorite.name}\``)

export const formatFavoriteFailure = (reason: FavoriteFailure, id: number, name?: string): string => {
    if (reason === "not-found") return chalk.red(`No meal with id ${id}. Run \`list --all\` to see the ids.`)
    if (reason === "empty-name") return chalk.red(`A favorite needs a name.`)
    return chalk.yellowBright(`You already have a favorite called "${name}". Pick another name with --as.`)
}

/** The saved favorites, for `favorite list`. */
export const formatFavorites = (favorites: Favorite[]): string[] => {
    if (favorites.length === 0) {
        return [chalk.red("No favorites yet — save one with `favorite add <id>`")]
    }

    return [
        chalk.bold("Favorites"),
        ...favorites.map(favorite =>
            `  ${chalk.cyan(favorite.name)} — ${grams(favorite.cals)} kcal  P ${grams(favorite.protein)}g  C ${grams(favorite.carbs)}g  F ${grams(favorite.fats)}g`,
        ),
    ]
}

/* --- totals, goals and history --- */

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
