/**
 * The actual work behind each command.
 *
 * These were inline in commander's .action() handlers, which meant the menu
 * would have had to duplicate them. Pulled out here so both entry points call
 * the same code and print the same output.
 */

import chalk from "chalk"
import { defaultData, readData, writeData } from "./storage.js"
import { toLocalDate } from "./date.js"
import { type Meal } from "./types.js"

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

export const clearMeals = async (): Promise<void> => {
    await writeData(defaultData())
}

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
