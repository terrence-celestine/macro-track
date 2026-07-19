#!/usr/bin/env -S npx tsx
import { Command } from "commander"
import { readData, writeData, type Meal, type MealsData } from "./storage.js"
import chalk from "chalk"

const program = new Command()

program
    .name("macro-track")
    .description("Track my macros and meals for the day").version("0.1.0")

program.command('add')
    .description("Add a new meal")
    .argument("<title>", "the meal title")
    .option("-p, --protein <grams>", "protein in grams", parseFloat)
    .option("-c, --carbs <grams>", "carbs in grams", parseFloat)
    .option("-f, --fats <grams>", "fats in grams", parseFloat)
    .option("--cals <kcals>", "meal calories", parseFloat)
    .action(async (title: string, options: { protein: number, fats: number, carbs: number, cals: number }) => {
        if (!options.carbs) {
            console.log(chalk.yellowBright(`Missing carbs value`))
            process.exit(1)
        }
        if (!options.fats) {
            console.log(chalk.yellowBright(`Missing fats value`))
            process.exit(1)
        }
        if (!options.protein) {
            console.log(chalk.yellowBright(`Missing protein value`))
            process.exit(1)
        }
        const data = await readData();
        const meal: Meal = {
            id: data.nextId,
            title: title,
            cals: options.cals,
            protein: options.protein,
            carbs: options.carbs,
            fats: options.fats,
            createdAt: new Date().toISOString(),
        }
        data.meals.push(meal)
        data.nextId += 1;
        await writeData(data);
        console.log(chalk.green(`✓ Added meal: ${title} : Protein: ${options.protein} - Fats: ${options.fats} - Carbs: ${options.carbs}`))
        process.exit(1)
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
        process.exit(1)
    })

program.command('clear')
    .description("Clear all meals")
    .action(async () => {
        const data = await readData();
        if (data.meals.length === 0)
            console.log(chalk.red(`You have no meals to clear, add a meal first`))
        await writeData({
            meals: [],
            nextId: 1,
        })
        console.log(chalk.green(`You cleared all your meals`))
        process.exit(1)
    })

program.parse()