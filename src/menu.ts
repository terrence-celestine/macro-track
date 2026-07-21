/**
 * The interactive main menu, shown when macro-track is run with no arguments.
 *
 * The flag interface (`macro-track add ...`) is unchanged and remains the
 * scriptable path.
 *
 * The menu's "list" means all-time, while the `list` command defaults to today.
 * They differ deliberately: the menu already has a Today entry directly above
 * it, so a today-scoped list there would just be a worse Today.
 */

import { intro, outro, select, text, isCancel, cancel, log } from "@clack/prompts"
import chalk from "chalk"

import {
    addMeal, clearMeals, listMeals, todaysMeals, sumMacros,
    formatAdded, formatMeal, formatTotals,
} from "./commands.js"
import { validateGrams } from "./validate.js"

type Action = "today" | "add" | "list" | "clear" | "exit"

/**
 * clack returns a cancel symbol rather than throwing when the user hits Ctrl+C,
 * so every prompt result has to be checked. This narrows the type and bails out
 * cleanly in one place.
 */
function exitIfCancelled<T>(value: T | symbol): T {
    if (isCancel(value)) {
        cancel("Cancelled.")
        process.exit(0)
    }
    return value as T
}

async function promptGrams(label: string): Promise<number> {
    const value = exitIfCancelled(
        await text({
            message: label,
            placeholder: "0",
            validate: (input) => validateGrams(input ?? ""),
        }),
    )
    return Number(value.trim())
}

async function runAdd(): Promise<void> {
    const title = exitIfCancelled(
        await text({
            message: "What did you eat?",
            placeholder: "ground beef",
            validate: (input) => (input?.trim() ? undefined : "Enter a meal name"),
        }),
    ).trim()

    const protein = await promptGrams("Protein (g)")
    const carbs = await promptGrams("Carbs (g)")
    const fats = await promptGrams("Fats (g)")
    const kcals = await promptGrams("Calories")

    const meal = await addMeal({ title, protein, carbs, fats, kcals })
    log.success(formatAdded(meal))
}

async function runToday(): Promise<void> {
    const meals = await todaysMeals()

    log.message(formatTotals(sumMacros(meals), meals.length).join("\n"))

    if (meals.length === 0) {
        log.warn(chalk.red("Nothing logged yet today"))
        return
    }

    for (const meal of meals) log.message(formatMeal(meal))
}

async function runList(): Promise<void> {
    const meals = await listMeals()

    if (meals.length === 0) {
        log.warn(chalk.red("You have no meals to show"))
        return
    }

    for (const meal of meals) log.message(formatMeal(meal))
}

async function runClear(): Promise<void> {
    const meals = await listMeals()

    if (meals.length === 0) {
        log.warn(chalk.red("You have no meals to clear, add a meal first"))
        return
    }

    await clearMeals()
    log.success(chalk.green("You cleared all your meals"))
}

const promptAction = async (): Promise<Action> =>
    exitIfCancelled(
        await select<Action>({
            message: "What do you want to do?",
            options: [
                { value: "today", label: "Today", hint: "running totals and today's meals" },
                { value: "add", label: "Add a meal", hint: "log protein, carbs, fats, calories" },
                { value: "list", label: "All meals", hint: "everything logged so far" },
                { value: "clear", label: "Clear meals", hint: "wipe the log and reset ids" },
                { value: "exit", label: "Exit" },
            ],
        }),
    )

/**
 * intro/outro are once per session; the prompt and the action are once per
 * iteration. Looping rather than recursing keeps that split honest — a nested
 * runMenu() would reprint the banner on the way in and stack up an outro on
 * the way out, one per level.
 */
export const runMenu = async (): Promise<void> => {
    intro(chalk.bgGreen.black(" macro-track "))

    let running = true
    while (running) {
        const action = await promptAction()

        switch (action) {
            case "today":
                await runToday()
                break
            case "add":
                await runAdd()
                break
            case "list":
                await runList()
                break
            case "clear":
                await runClear()
                break
            case "exit":
                running = false
                break
        }
    }

    outro("Done.")
}
