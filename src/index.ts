#!/usr/bin/env -S npx tsx
import { Command, InvalidArgumentError } from "commander"
import chalk from "chalk"

import {
    addMeal, clearMeals, listMeals, todaysMeals, sumMacros, deleteMeal, editMeal,
    getGoals, setGoals, clearGoals,
    formatAdded, formatMeal, formatTotals, formatGoals, formatHistory,
    formatDeleted, formatDeleteFailure, formatEdited, formatEditFailure,
} from "./commands.js"
import { closeStaleDays, getHistory } from "./days.js"
import { validateGrams } from "./validate.js"
import { runMenu } from "./menu.js"

const program = new Command()

const parseGrams = (value: string) => {
    const error = validateGrams(value)
    if (error) throw new InvalidArgumentError(error)
    return Number(value.trim())
}

/**
 * Reports a usage error and exits.
 *
 * Wraps program.error purely for its return type: commander types that method
 * as void even though it never returns, so TypeScript keeps narrowing past it
 * and a `if (!result.ok) program.error(...)` block silently falls through to
 * code that assumes success. Declaring `never` here makes the compiler treat
 * this as terminal, so a forgotten `return` becomes a type error rather than a
 * runtime surprise.
 */
// The annotation on the const is load-bearing, not decorative: TypeScript only
// lets a never-returning call cut off control flow when the *variable* carries
// an explicit type. Written as `const fail = (m: string): never => ...` the
// narrowing silently stops working.
const fail: (message: string) => never = (message) => {
    program.error(message)

    // Unreachable: program.error exits the process. It exists so the compiler
    // accepts the `never` return, since commander's own typing doesn't say so.
    throw new Error(message)
}

program
    .name("macro-track")
    .description("Track my macros and meals for the day").version("0.1.0")

program.command('add')
    .description("Add a new meal")
    .argument("<title>", "the meal title")
    .option("-p, --protein <grams>", "protein in grams", parseGrams)
    .option("-c, --carbs <grams>", "carbs in grams", parseGrams)
    .option("-f, --fats <grams>", "fats in grams", parseGrams)
    .option("-k --kcals <cals>", "meal calories", parseGrams)
    .action(async (title: string, options: { protein: number, fats: number, carbs: number, kcals: number }) => {
        const REQUIRED_OPTS = ["protein", "fats", "carbs", "kcals"] as const;
        const missingOptions = REQUIRED_OPTS.filter(key => options[key] === undefined);

        if (missingOptions.length > 0) {
            fail(chalk.yellowBright(`Missing ${missingOptions.join(", ")} value`))
        }

        const meal = await addMeal({
            title,
            protein: options.protein,
            carbs: options.carbs,
            fats: options.fats,
            kcals: options.kcals,
        })
        console.log(formatAdded(meal))
    })

program.command('history')
    .description("Closed days, most recent first")
    .option("-d, --days <count>", "how many days to show", parseGrams, 7)
    .action(async (options: { days: number }) => {
        for (const line of formatHistory(await getHistory(options.days))) {
            console.log(line)
        }
    })

const goal = program.command('goal')
    .description("Daily macro targets")

goal.command('set')
    .description("Set or update daily targets — any subset of the four")
    .option("-p, --protein <grams>", "protein in grams", parseGrams)
    .option("-c, --carbs <grams>", "carbs in grams", parseGrams)
    .option("-f, --fats <grams>", "fats in grams", parseGrams)
    .option("-k --kcals <cals>", "calorie target", parseGrams)
    .action(async (options: { protein?: number, fats?: number, carbs?: number, kcals?: number }) => {
        const update = {
            protein: options.protein,
            carbs: options.carbs,
            fats: options.fats,
            cals: options.kcals,
        }

        // Merging nothing into the stored goals would report success while
        // changing nothing, which reads as a silent failure.
        if (Object.values(update).every(value => value === undefined)) {
            fail(chalk.yellowBright(`Set at least one of --protein, --carbs, --fats, --kcals`))
        }

        for (const line of formatGoals(await setGoals(update))) {
            console.log(line)
        }
    })

goal.command('show')
    .description("Print the current targets")
    .action(async () => {
        for (const line of formatGoals(await getGoals())) {
            console.log(line)
        }
    })

goal.command('clear')
    .description("Remove all targets")
    .action(async () => {
        await clearGoals()
        console.log(chalk.green(`Cleared your goals`))
    })

program.command('today')
    .description("Today's running totals and meals")
    .action(async () => {
        const meals = await todaysMeals()

        for (const line of formatTotals(sumMacros(meals), meals.length, await getGoals())) {
            console.log(line)
        }

        if (meals.length === 0) {
            console.log(chalk.red(`Nothing logged yet today`))
            return
        }

        console.log()
        for (const meal of meals) {
            console.log(formatMeal(meal))
        }
    })

program.command('list')
    .description("List today's meals")
    .option("-a, --all", "every meal on record, not just today's")
    .action(async (options: { all?: boolean }) => {
        const meals = options.all ? await listMeals() : await todaysMeals()

        if (meals.length === 0)
            console.log(chalk.red(`You have no meals to show`))

        for (const meal of meals) {
            console.log(formatMeal(meal))
        }
    })

program.command('edit')
    .description("Change a meal's title or macros — any subset")
    .argument("<id>", "the meal id, as shown by `list`", parseGrams)
    .option("-t, --title <title>", "the meal title")
    .option("-p, --protein <grams>", "protein in grams", parseGrams)
    .option("-c, --carbs <grams>", "carbs in grams", parseGrams)
    .option("-f, --fats <grams>", "fats in grams", parseGrams)
    .option("-k --kcals <cals>", "meal calories", parseGrams)
    .action(async (id: number, options: { title?: string, protein?: number, fats?: number, carbs?: number, kcals?: number }) => {
        const update = {
            title: options.title,
            protein: options.protein,
            carbs: options.carbs,
            fats: options.fats,
            cals: options.kcals,
        }

        // Same reasoning as `goal set`: an edit that changes nothing would
        // report success, which reads as a silent failure.
        if (Object.values(update).every(value => value === undefined)) {
            fail(chalk.yellowBright(`Set at least one of --title, --protein, --carbs, --fats, --kcals`))
        }

        const result = await editMeal(id, update)
        if (!result.ok) fail(formatEditFailure(id, result.reason))

        console.log(formatEdited(result.meal))
    })

program.command('delete')
    .description("Delete a single meal by id")
    .argument("<id>", "the meal id, as shown by `list`", parseGrams)
    .action(async (id: number) => {
        const result = await deleteMeal(id)

        // No confirmation prompt: this is the scriptable path, and one meal is
        // cheap to re-add. The menu confirms instead.
        // fail() is typed never, so the union narrows without a trailing return.
        if (!result.ok) fail(formatDeleteFailure(id, result.reason))

        console.log(formatDeleted(result.meal))
    })

program.command('clear')
    .description("Clear all meals")
    .action(async () => {
        const meals = await listMeals();
        if (meals.length === 0)
            console.log(chalk.red(`You have no meals to clear, add a meal first`))
        await clearMeals()
        console.log(chalk.green(`You cleared all your meals`))
    })

// Lazy day close: the first command run on a new day freezes the ones before
// it. Done here rather than per-command so every entry point gets it, and it
// writes nothing when there is nothing stale, so read-only commands stay
// read-only.
await closeStaleDays()

// No arguments means a bare `macro-track`, so open the menu. Anything else
// stays on the flag path, which is what scripts and the test suite use.
if (process.argv.length <= 2) {
    await runMenu()
} else {
    program.parse()
}
