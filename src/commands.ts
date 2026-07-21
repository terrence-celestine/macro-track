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
import { type Macros, type Meal } from "./types.js"

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
    await writeData(defaultData())
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

/**
 * The totals block for a day. Kept as an array of lines so the two entry points
 * can emit it their own way — console.log joins them, clack's log.message wants
 * them one at a time.
 */
export const formatTotals = (totals: Macros, mealCount: number): string[] => {
    const meals = `${mealCount} ${mealCount === 1 ? "meal" : "meals"}`

    return [
        chalk.bold(`Today — ${meals}`),
        `  Calories: ${chalk.cyan(grams(totals.cals))}`,
        `  Protein:  ${chalk.cyan(grams(totals.protein))}g`,
        `  Carbs:    ${chalk.cyan(grams(totals.carbs))}g`,
        `  Fats:     ${chalk.cyan(grams(totals.fats))}g`,
    ]
}
