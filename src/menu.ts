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

import { intro, outro, select, text, confirm, isCancel, cancel, log } from "@clack/prompts"
import chalk from "chalk"

import {
    addMeal, clearMeals, listMeals, todaysMeals, sumMacros,
    getGoals, setGoals, openMeals, deleteMeal, editMeal,
    repeatFavorite, addFavorite, getFavorites,
    formatAdded, formatMeal, formatTotals, formatGoals, formatHistory,
    formatDeleted, formatDeleteFailure, formatEdited, formatEditFailure,
    formatRepeated, formatFavorited, formatFavoriteFailure,
    type MealEdit,
} from "./commands.js"
import { getHistory } from "./days.js"
import { validateGrams } from "./validate.js"
import { type Goals, type Meal } from "./types.js"

type Action = "today" | "add" | "repeat" | "favorite" | "edit" | "delete" | "goals" | "history" | "list" | "clear" | "exit"

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

/**
 * Prompts for one target, pre-filled with the current value. Blank means "leave
 * this one alone", which is how the menu expresses the same partial-merge the
 * `goal set` flags give you — you can change protein without restating the rest.
 */
async function promptGoal(label: string, current: number | undefined): Promise<number | undefined> {
    const value = exitIfCancelled(
        await text({
            message: label,
            placeholder: current === undefined ? "not set — leave blank to skip" : `${current}`,
            defaultValue: "",
            validate: (input) => (input?.trim() ? validateGrams(input) : undefined),
        }),
    )

    return value.trim() === "" ? undefined : Number(value.trim())
}

async function runGoals(): Promise<void> {
    const current = await getGoals()

    const update: Goals = {
        cals: await promptGoal("Calorie target", current.cals),
        protein: await promptGoal("Protein target (g)", current.protein),
        carbs: await promptGoal("Carbs target (g)", current.carbs),
        fats: await promptGoal("Fats target (g)", current.fats),
    }

    log.message(formatGoals(await setGoals(update)).join("\n"))
}

async function runToday(): Promise<void> {
    const meals = await todaysMeals()

    log.message(formatTotals(sumMacros(meals), meals.length, await getGoals()).join("\n"))

    if (meals.length === 0) {
        log.warn(chalk.red("Nothing logged yet today"))
        return
    }

    for (const meal of meals) log.message(formatMeal(meal))
}

/**
 * Picks one meal that is still open to change.
 *
 * Meals from a recorded day are not shown at all rather than shown and refused
 * — there is nothing useful you could do with them here. Returns null when
 * there is nothing to pick, so the caller can explain rather than show an
 * empty list.
 */
async function pickOpenMeal(message: string): Promise<Meal | null> {
    const meals = await openMeals()
    if (meals.length === 0) return null

    const id = exitIfCancelled(
        await select<number>({
            message,
            options: meals.map(meal => ({
                value: meal.id,
                label: meal.title,
                hint: `${meal.cals} kcal · P ${meal.protein}g · C ${meal.carbs}g · F ${meal.fats}g`,
            })),
        }),
    )

    return meals.find(meal => meal.id === id)!
}

async function runRepeat(): Promise<void> {
    const favorites = await getFavorites()

    if (favorites.length === 0) {
        log.warn(chalk.red("No favorites yet — save one from a logged meal first"))
        return
    }

    const name = exitIfCancelled(
        await select<string>({
            message: "Log which favorite?",
            options: favorites.map(favorite => ({
                value: favorite.name,
                label: favorite.name,
                hint: `${favorite.cals} kcal · P ${favorite.protein}g · C ${favorite.carbs}g · F ${favorite.fats}g`,
            })),
        }),
    )

    const result = await repeatFavorite(name)

    // No confirm: this adds rather than destroys, and a stray copy is one
    // delete away.
    if (!result.ok) {
        log.warn(chalk.red(`No favorite called "${name}".`))
        return
    }

    log.success(formatRepeated(result.meal))
}

/**
 * Saves one of today's meals as a favourite.
 *
 * Scoped to today because you favourite something just after logging it. The
 * `favorite add <id>` command takes any meal id for the rarer case.
 */
async function runSaveFavorite(): Promise<void> {
    const meals = await todaysMeals()

    if (meals.length === 0) {
        log.warn(chalk.red("Nothing logged today to save"))
        return
    }

    const id = exitIfCancelled(
        await select<number>({
            message: "Save which meal?",
            options: meals.map(meal => ({
                value: meal.id,
                label: meal.title,
                hint: `${meal.cals} kcal · P ${meal.protein}g · C ${meal.carbs}g · F ${meal.fats}g`,
            })),
        }),
    )

    const chosen = meals.find(meal => meal.id === id)!

    // Blank keeps the meal's title, same convention as the other prompts.
    const name = exitIfCancelled(
        await text({
            message: "Call it what?",
            placeholder: chosen.title,
            defaultValue: "",
        }),
    ).trim()

    const result = await addFavorite(id, name === "" ? undefined : name)

    if (!result.ok) {
        log.warn(formatFavoriteFailure(result.reason, id, name))
        return
    }

    log.success(formatFavorited(result.favorite))
}

async function runEdit(): Promise<void> {
    const chosen = await pickOpenMeal("Edit which meal?")

    if (chosen === null) {
        log.warn(chalk.red("Nothing to edit — logged days that are already recorded can't be changed"))
        return
    }

    // Blank keeps the current value, same convention as the goal prompts.
    const title = exitIfCancelled(
        await text({
            message: "Title",
            placeholder: chosen.title,
            defaultValue: "",
        }),
    ).trim()

    const update: MealEdit = {
        title: title === "" ? undefined : title,
        cals: await promptGoal("Calories", chosen.cals),
        protein: await promptGoal("Protein (g)", chosen.protein),
        carbs: await promptGoal("Carbs (g)", chosen.carbs),
        fats: await promptGoal("Fats (g)", chosen.fats),
    }

    const result = await editMeal(chosen.id, update)

    if (!result.ok) {
        log.warn(formatEditFailure(chosen.id, result.reason))
        return
    }

    log.success(formatEdited(result.meal))
}

async function runDelete(): Promise<void> {
    const chosen = await pickOpenMeal("Delete which meal?")

    if (chosen === null) {
        log.warn(chalk.red("Nothing to delete — logged days that are already recorded can't be changed"))
        return
    }

    const id = chosen.id

    const confirmed = exitIfCancelled(
        await confirm({ message: `Delete "${chosen.title}"?`, initialValue: false }),
    )

    if (!confirmed) {
        log.message(chalk.dim("Left it alone."))
        return
    }

    const result = await deleteMeal(id)

    if (!result.ok) {
        log.warn(formatDeleteFailure(id, result.reason))
        return
    }

    log.success(formatDeleted(result.meal))
}

async function runHistory(): Promise<void> {
    log.message(formatHistory(await getHistory(7)).join("\n"))
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
                { value: "repeat", label: "Log a favorite", hint: "one of your saved meals" },
                { value: "favorite", label: "Save a favorite", hint: "keep one of today's meals for later" },
                { value: "edit", label: "Edit a meal", hint: "fix a title or the macros" },
                { value: "delete", label: "Delete a meal", hint: "remove one entry" },
                { value: "goals", label: "Set goals", hint: "daily targets — blank keeps the current value" },
                { value: "history", label: "History", hint: "the last 7 closed days" },
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
            case "repeat":
                await runRepeat()
                break
            case "favorite":
                await runSaveFavorite()
                break
            case "edit":
                await runEdit()
                break
            case "delete":
                await runDelete()
                break
            case "goals":
                await runGoals()
                break
            case "history":
                await runHistory()
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
