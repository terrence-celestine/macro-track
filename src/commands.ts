/**
 * The actual work behind each command.
 *
 * These were inline in commander's .action() handlers, which meant the menu
 * would have had to duplicate them. Pulled out here so both entry points call
 * the same code and print the same output.
 */

import chalk from "chalk"
import { defaultData, readData, writeData } from "./storage.js"
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

    const meal: Meal = {
        id: data.nextId,
        title: input.title,
        cals: input.kcals,
        protein: input.protein,
        carbs: input.carbs,
        fats: input.fats,
        createdAt: new Date().toISOString(),
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
