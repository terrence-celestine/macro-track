/**
 * Menu actions over the meal log: adding, editing, deleting, listing, clearing,
 * and today's totals.
 */

import { text, confirm, group, log } from "@clack/prompts";
import chalk from "chalk";

import {
  addMeal,
  clearMeals,
  listMeals,
  todaysMeals,
  sumMacros,
  openMeals,
  deleteMeal,
  editMeal,
  getGoals,
  formatAdded,
  formatMeal,
  formatTotals,
  formatDeleted,
  formatDeleteFailure,
  formatEdited,
  formatEditFailure,
  type MealEdit,
} from "./commands.js";
import {
  cancelSession,
  exitIfCancelled,
  gramsPrompt,
  optionalGramsPrompt,
  optionalNumber,
  macroHint,
  pickFrom,
} from "./menu-prompts.js";
import { type Meal } from "./types.js";

/**
 * Picks one meal that is still open to change.
 *
 * Meals from a recorded day are not offered at all rather than offered and
 * refused — there is nothing useful you could do with them here.
 */
const pickOpenMeal = async (message: string): Promise<Meal | null> =>
  pickFrom(await openMeals(), {
    message,
    value: (meal) => meal.id,
    label: (meal) => meal.title,
    hint: macroHint,
  });

export async function runAdd(): Promise<void> {
  // group runs the sequence and routes a cancel at any step to one handler,
  // instead of every prompt needing its own check.
  const answers = await group(
    {
      title: () =>
        text({
          message: "What did you eat?",
          placeholder: "ground beef",
          validate: (input) =>
            input?.trim() ? undefined : "Enter a meal name",
        }),
      protein: () => gramsPrompt("Protein (g)"),
      carbs: () => gramsPrompt("Carbs (g)"),
      fats: () => gramsPrompt("Fats (g)"),
      kcals: () => gramsPrompt("Calories"),
    },
    { onCancel: cancelSession },
  );

  const meal = await addMeal({
    title: answers.title.trim(),
    protein: Number(answers.protein),
    carbs: Number(answers.carbs),
    fats: Number(answers.fats),
    kcals: Number(answers.kcals),
  });

  log.success(formatAdded(meal));
}

export async function runToday(): Promise<void> {
  const meals = await todaysMeals();

  log.message(
    formatTotals(sumMacros(meals), meals.length, await getGoals()).join("\n"),
  );

  if (meals.length === 0) {
    log.warn(chalk.red("Nothing logged yet today"));
    return;
  }

  for (const meal of meals) log.message(formatMeal(meal));
}

export async function runEdit(): Promise<void> {
  const chosen = await pickOpenMeal("Edit which meal?");

  if (chosen === null) {
    log.warn(
      chalk.red(
        "Nothing to edit — logged days that are already recorded can't be changed",
      ),
    );
    return;
  }

  // Blank keeps the current value, same convention as the goal prompts.
  const answers = await group(
    {
      title: () =>
        text({ message: "Title", placeholder: chosen.title, defaultValue: "" }),
      cals: () => optionalGramsPrompt("Calories", chosen.cals),
      protein: () => optionalGramsPrompt("Protein (g)", chosen.protein),
      carbs: () => optionalGramsPrompt("Carbs (g)", chosen.carbs),
      fats: () => optionalGramsPrompt("Fats (g)", chosen.fats),
    },
    { onCancel: cancelSession },
  );

  const update: MealEdit = {
    title: answers.title.trim() === "" ? undefined : answers.title.trim(),
    cals: optionalNumber(answers.cals),
    protein: optionalNumber(answers.protein),
    carbs: optionalNumber(answers.carbs),
    fats: optionalNumber(answers.fats),
  };

  const result = await editMeal(chosen.id, update);

  if (!result.ok) {
    log.warn(formatEditFailure(chosen.id, result.reason));
    return;
  }

  log.success(formatEdited(result.meal));
}

export async function runDelete(): Promise<void> {
  const chosen = await pickOpenMeal("Delete which meal?");

  if (chosen === null) {
    log.warn(
      chalk.red(
        "Nothing to delete — logged days that are already recorded can't be changed",
      ),
    );
    return;
  }

  const confirmed = exitIfCancelled(
    await confirm({
      message: `Delete "${chosen.title}"?`,
      initialValue: false,
    }),
  );

  if (!confirmed) {
    log.message(chalk.dim("Left it alone."));
    return;
  }

  const result = await deleteMeal(chosen.id);

  if (!result.ok) {
    log.warn(formatDeleteFailure(chosen.id, result.reason));
    return;
  }

  log.success(formatDeleted(result.meal));
}

export async function runList(): Promise<void> {
  const meals = await listMeals();

  if (meals.length === 0) {
    log.warn(chalk.red("You have no meals to show"));
    return;
  }

  for (const meal of meals) log.message(formatMeal(meal));
}

export async function runClear(): Promise<void> {
  const meals = await listMeals();

  if (meals.length === 0) {
    log.warn(chalk.red("You have no meals to clear, add a meal first"));
    return;
  }

  await clearMeals();
  log.success(chalk.green("You cleared all your meals"));
}
