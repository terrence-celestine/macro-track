#!/usr/bin/env -S npx tsx
import { Command } from "commander"
import { defaultData, readData, writeData } from "./storage.js"
import { type Meal } from "./types.js";

import chalk from "chalk"
import { InvalidArgumentError } from "commander"

const program = new Command()

const parseGrams = (value: string) => {
    const n = Number(value)
    if (Number.isNaN(n)) throw new InvalidArgumentError(`"${value}" is not a number`)
    if (n < 0) throw new InvalidArgumentError(`must be zero or positive`)
    return n
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

        const data = await readData();
        const meal: Meal = {
            id: data.nextId,
            title: title,
            cals: options.kcals,
            protein: options.protein,
            carbs: options.carbs,
            fats: options.fats,
            createdAt: new Date().toISOString(),
        }
        data.meals.push(meal)
        data.nextId += 1;
        await writeData(data);
        console.log(chalk.green(`✓ Added meal: ${title} : Protein: ${options.protein} - Fats: ${options.fats} - Carbs: ${options.carbs} - Calories: ${options.kcals}`))
    })

program.command('list')
    .description("List all meals")
    .action(async () => {
        const data = await readData();
        if (data.meals.length === 0)
            console.log(chalk.red(`You have no meals to show`))

        for (const meal of data.meals) {
            console.log(chalk.green(`✓ Found meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs}`))
        }
    })

program.command('clear')
    .description("Clear all meals")
    .action(async () => {
        const data = await readData();
        if (data.meals.length === 0)
            console.log(chalk.red(`You have no meals to clear, add a meal first`))
        await writeData(defaultData())
        console.log(chalk.green(`You cleared all your meals`))
    })

program.parse()