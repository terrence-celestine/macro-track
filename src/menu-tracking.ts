/**
 * Menu actions over the things meals are measured against: goals, weight, and
 * the frozen day history.
 */

import { text, confirm, group, log } from "@clack/prompts";
import chalk from "chalk";

import {
  getGoals,
  setGoals,
  formatGoals,
  formatHistory,
  formatWeighed,
  formatWeights,
} from "./commands.js";
import { getHistory } from "./days.js";
import {
  recordWeight,
  removeWeight,
  getWeights,
  trailingAverage,
  trailingChange,
} from "./weight.js";
import {
  cancelSession,
  exitIfCancelled,
  optionalGramsPrompt,
  optionalNumber,
  pickFrom,
} from "./menu-prompts.js";
import { validateGrams } from "./validate.js";
import { type Goals } from "./types.js";

/** How many recent weigh-ins the menu lists. */
const WEIGHT_LIST_LIMIT = 14;

export async function runGoals(): Promise<void> {
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

export async function runHistory(): Promise<void> {
  log.message(formatHistory(await getHistory(7)).join("\n"));
}

export async function runWeigh(): Promise<void> {
  const value = exitIfCancelled(
    await text({
      message: "What did you weigh?",
      placeholder: "182.4",
      validate: (input) => validateGrams(input ?? ""),
    }),
  );

  log.success(formatWeighed(await recordWeight(Number(value.trim()))));
}

export async function runWeight(): Promise<void> {
  const weights = await getWeights();

  log.message(
    formatWeights(
      weights,
      trailingAverage(weights),
      trailingChange(weights),
      WEIGHT_LIST_LIMIT,
    ).join("\n"),
  );
}

export async function runRemoveWeight(): Promise<void> {
  // Newest first: a reading you want to drop is almost always a recent one.
  const recent = [...(await getWeights())].reverse();

  const chosen = await pickFrom(recent, {
    message: "Forget which weigh-in?",
    value: (entry) => entry.date,
    label: (entry) => entry.date,
    hint: (entry) => `${entry.weight}`,
  });

  if (chosen === null) {
    log.warn(chalk.red("No weigh-ins to remove"));
    return;
  }

  const confirmed = exitIfCancelled(
    await confirm({
      message: `Forget the weigh-in for ${chosen.date}?`,
      initialValue: false,
    }),
  );

  if (!confirmed) {
    log.message(chalk.dim("Left it alone."));
    return;
  }

  if (!(await removeWeight(chosen.date))) {
    log.warn(chalk.red(`No weigh-in recorded for ${chosen.date}.`));
    return;
  }

  log.success(chalk.green(`✓ Removed the weigh-in for ${chosen.date}`));
}
