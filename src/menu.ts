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

import {
  intro,
  outro,
  select,
  text,
  confirm,
  group,
  isCancel,
  cancel,
  log,
} from "@clack/prompts";
import chalk from "chalk";

import {
  addMeal,
  clearMeals,
  listMeals,
  todaysMeals,
  sumMacros,
  getGoals,
  setGoals,
  openMeals,
  deleteMeal,
  editMeal,
  repeatFavorite,
  addFavorite,
  getFavorites,
  formatAdded,
  formatMeal,
  formatTotals,
  formatGoals,
  formatHistory,
  formatDeleted,
  formatDeleteFailure,
  formatEdited,
  formatEditFailure,
  formatRepeated,
  formatFavorited,
  formatFavoriteFailure,
  formatWeighed,
  formatWeights,
  type MealEdit,
} from "./commands.js";
import { getHistory } from "./days.js";
import {
  recordWeight,
  getWeights,
  trailingAverage,
  trailingChange,
} from "./weight.js";
import { validateGrams } from "./validate.js";
import { type Goals, type Macros, type Meal } from "./types.js";

type Action =
  | "today"
  | "add"
  | "repeat"
  | "favorite"
  | "edit"
  | "delete"
  | "goals"
  | "weigh"
  | "weight"
  | "history"
  | "list"
  | "clear"
  | "exit";

/**
 * Ctrl+C at any prompt ends the session.
 *
 * clack signals cancellation by returning a symbol rather than throwing, so it
 * has to be handled explicitly. `group` gives one hook for a whole sequence;
 * standalone prompts still go through exitIfCancelled below.
 */
const cancelSession = (): never => {
  cancel("Cancelled.");
  process.exit(0);
};

/** The single-prompt equivalent of group's onCancel. */
function exitIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) cancelSession();
  return value as T;
}

/** A required macro amount. Returned as text; group callers convert. */
const gramsPrompt = (label: string) =>
  text({
    message: label,
    placeholder: "0",
    validate: (input) => validateGrams(input ?? ""),
  });

/**
 * An optional amount, pre-filled with the current value. Blank means "leave
 * this one alone", which is how the menu expresses the same partial-merge the
 * `goal set` flags give you — you can change protein without restating the rest.
 */
const optionalGramsPrompt = (label: string, current: number | undefined) =>
  text({
    message: label,
    placeholder:
      current === undefined ? "not set — leave blank to skip" : `${current}`,
    defaultValue: "",
    validate: (input) => (input?.trim() ? validateGrams(input) : undefined),
  });

/**
 * The one-line macro summary under a select option.
 *
 * Takes Macros rather than Meal so the meal pickers and the favourites picker
 * share it — they were three copies of the same template literal.
 */
const macroHint = (m: Macros): string =>
  `${m.cals} kcal · P ${m.protein}g · C ${m.carbs}g · F ${m.fats}g`;

/** Blank answers mean "unchanged", so they become undefined rather than 0. */
const optionalNumber = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number(value.trim());

async function runAdd(): Promise<void> {
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

async function runGoals(): Promise<void> {
  const current = await getGoals();

  const answers = await group(
    {
      cals: () => optionalGramsPrompt("Calorie target", current.cals),
      protein: () => optionalGramsPrompt("Protein target (g)", current.protein),
      carbs: () => optionalGramsPrompt("Carbs target (g)", current.carbs),
      fats: () => optionalGramsPrompt("Fats target (g)", current.fats),
    },
    { onCancel: cancelSession },
  );

  const update: Goals = {
    cals: optionalNumber(answers.cals),
    protein: optionalNumber(answers.protein),
    carbs: optionalNumber(answers.carbs),
    fats: optionalNumber(answers.fats),
  };

  log.message(formatGoals(await setGoals(update)).join("\n"));
}

async function runToday(): Promise<void> {
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

/**
 * Picks one meal that is still open to change.
 *
 * Meals from a recorded day are not shown at all rather than shown and refused
 * — there is nothing useful you could do with them here. Returns null when
 * there is nothing to pick, so the caller can explain rather than show an
 * empty list.
 */
async function pickOpenMeal(message: string): Promise<Meal | null> {
  const meals = await openMeals();
  if (meals.length === 0) return null;

  const id = exitIfCancelled(
    await select<number>({
      message,
      options: meals.map((meal) => ({
        value: meal.id,
        label: meal.title,
        hint: macroHint(meal),
      })),
    }),
  );

  return meals.find((meal) => meal.id === id)!;
}

async function runRepeat(): Promise<void> {
  const favorites = await getFavorites();

  if (favorites.length === 0) {
    log.warn(chalk.red("No favorites yet — save one from a logged meal first"));
    return;
  }

  const name = exitIfCancelled(
    await select<string>({
      message: "Log which favorite?",
      options: favorites.map((favorite) => ({
        value: favorite.name,
        label: favorite.name,
        hint: macroHint(favorite),
      })),
    }),
  );

  const result = await repeatFavorite(name);

  // No confirm: this adds rather than destroys, and a stray copy is one
  // delete away.
  if (!result.ok) {
    log.warn(chalk.red(`No favorite called "${name}".`));
    return;
  }

  log.success(formatRepeated(result.meal));
}

/**
 * Saves one of today's meals as a favourite.
 *
 * Scoped to today because you favourite something just after logging it. The
 * `favorite add <id>` command takes any meal id for the rarer case.
 */
async function runSaveFavorite(): Promise<void> {
  const meals = await todaysMeals();

  if (meals.length === 0) {
    log.warn(chalk.red("Nothing logged today to save"));
    return;
  }

  const id = exitIfCancelled(
    await select<number>({
      message: "Save which meal?",
      options: meals.map((meal) => ({
        value: meal.id,
        label: meal.title,
        hint: macroHint(meal),
      })),
    }),
  );

  const chosen = meals.find((meal) => meal.id === id)!;

  // Blank keeps the meal's title, same convention as the other prompts.
  const name = exitIfCancelled(
    await text({
      message: "Call it what?",
      placeholder: chosen.title,
      defaultValue: "",
    }),
  ).trim();

  const result = await addFavorite(id, name === "" ? undefined : name);

  if (!result.ok) {
    log.warn(formatFavoriteFailure(result.reason, id, name));
    return;
  }

  log.success(formatFavorited(result.favorite));
}

async function runEdit(): Promise<void> {
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

async function runDelete(): Promise<void> {
  const chosen = await pickOpenMeal("Delete which meal?");

  if (chosen === null) {
    log.warn(
      chalk.red(
        "Nothing to delete — logged days that are already recorded can't be changed",
      ),
    );
    return;
  }

  const id = chosen.id;

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

  const result = await deleteMeal(id);

  if (!result.ok) {
    log.warn(formatDeleteFailure(id, result.reason));
    return;
  }

  log.success(formatDeleted(result.meal));
}

async function runWeigh(): Promise<void> {
  const value = exitIfCancelled(
    await text({
      message: "What did you weigh?",
      placeholder: "182.4",
      validate: (input) => validateGrams(input ?? ""),
    }),
  );

  log.success(formatWeighed(await recordWeight(Number(value.trim()))));
}

async function runWeight(): Promise<void> {
  const weights = await getWeights();

  log.message(
    formatWeights(
      weights,
      trailingAverage(weights),
      trailingChange(weights),
      14,
    ).join("\n"),
  );
}

async function runHistory(): Promise<void> {
  log.message(formatHistory(await getHistory(7)).join("\n"));
}

async function runList(): Promise<void> {
  const meals = await listMeals();

  if (meals.length === 0) {
    log.warn(chalk.red("You have no meals to show"));
    return;
  }

  for (const meal of meals) log.message(formatMeal(meal));
}

async function runClear(): Promise<void> {
  const meals = await listMeals();

  if (meals.length === 0) {
    log.warn(chalk.red("You have no meals to clear, add a meal first"));
    return;
  }

  await clearMeals();
  log.success(chalk.green("You cleared all your meals"));
}

const promptAction = async (): Promise<Action> =>
  exitIfCancelled(
    await select<Action>({
      message: "What do you want to do?",
      options: [
        {
          value: "today",
          label: "Today",
          hint: "running totals and today's meals",
        },
        {
          value: "add",
          label: "Add a meal",
          hint: "log protein, carbs, fats, calories",
        },
        {
          value: "repeat",
          label: "Log a favorite",
          hint: "one of your saved meals",
        },
        {
          value: "favorite",
          label: "Save a favorite",
          hint: "keep one of today's meals for later",
        },
        {
          value: "edit",
          label: "Edit a meal",
          hint: "fix a title or the macros",
        },
        { value: "delete", label: "Delete a meal", hint: "remove one entry" },
        {
          value: "goals",
          label: "Set goals",
          hint: "daily targets — blank keeps the current value",
        },
        { value: "weigh", label: "Record weight", hint: "today's weigh-in" },
        {
          value: "weight",
          label: "Weight trend",
          hint: "recent weigh-ins and the average",
        },
        { value: "history", label: "History", hint: "the last 7 closed days" },
        { value: "list", label: "All meals", hint: "everything logged so far" },
        {
          value: "clear",
          label: "Clear meals",
          hint: "wipe the log and reset ids",
        },
        { value: "exit", label: "Exit" },
      ],
    }),
  );

/**
 * intro/outro are once per session; the prompt and the action are once per
 * iteration. Looping rather than recursing keeps that split honest — a nested
 * runMenu() would reprint the banner on the way in and stack up an outro on
 * the way out, one per level.
 */
export const runMenu = async (): Promise<void> => {
  intro(chalk.bgGreen.black(" macro-track "));

  let running = true;
  while (running) {
    const action = await promptAction();

    switch (action) {
      case "today":
        await runToday();
        break;
      case "add":
        await runAdd();
        break;
      case "repeat":
        await runRepeat();
        break;
      case "favorite":
        await runSaveFavorite();
        break;
      case "edit":
        await runEdit();
        break;
      case "delete":
        await runDelete();
        break;
      case "goals":
        await runGoals();
        break;
      case "weigh":
        await runWeigh();
        break;
      case "weight":
        await runWeight();
        break;
      case "history":
        await runHistory();
        break;
      case "list":
        await runList();
        break;
      case "clear":
        await runClear();
        break;
      case "exit":
        running = false;
        break;
    }
  }

  outro("Done.");
};
