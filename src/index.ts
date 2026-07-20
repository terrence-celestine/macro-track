#!/usr/bin/env -S npx tsx
import { Command, InvalidArgumentError } from "commander"
import chalk from "chalk"

import { addMeal, clearMeals, listMeals, formatAdded, formatMeal } from "./commands.js"
import { validateGrams } from "./validate.js"
import { runMenu } from "./menu.js"

const program = new Command()

const parseGrams = (value: string) => {
    const error = validateGrams(value)
    if (error) throw new InvalidArgumentError(error)
    return Number(value.trim())
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
            program.error(chalk.yellowBright(`Missing ${missingOptions.join(", ")} value`))
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

program.command('list')
    .description("List all meals")
    .action(async () => {
        const meals = await listMeals();
        if (meals.length === 0)
            console.log(chalk.red(`You have no meals to show`))

        for (const meal of meals) {
            console.log(formatMeal(meal))
        }
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

// No arguments means a bare `macro-track`, so open the menu. Anything else
// stays on the flag path, which is what scripts and the test suite use.
if (process.argv.length <= 2) {
    await runMenu()
} else {
    program.parse()
}
