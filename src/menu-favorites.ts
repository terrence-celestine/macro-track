/**
 * Menu actions over saved favorites: logging one, saving one, forgetting one.
 */

import { text, confirm, log } from "@clack/prompts";
import chalk from "chalk";

import {
  todaysMeals,
  repeatFavorite,
  addFavorite,
  removeFavorite,
  getFavorites,
  formatRepeated,
  formatFavorited,
  formatFavoriteFailure,
} from "./commands.js";
import { exitIfCancelled, macroHint, pickFrom } from "./menu-prompts.js";

export async function runRepeat(): Promise<void> {
  const chosen = await pickFrom(await getFavorites(), {
    message: "Log which favorite?",
    value: (favorite) => favorite.name,
    label: (favorite) => favorite.name,
    hint: macroHint,
  });

  if (chosen === null) {
    log.warn(chalk.red("No favorites yet — save one from a logged meal first"));
    return;
  }

  const result = await repeatFavorite(chosen.name);

  // No confirm: this adds rather than destroys, and a stray copy is one
  // delete away.
  if (!result.ok) {
    log.warn(chalk.red(`No favorite called "${chosen.name}".`));
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
export async function runSaveFavorite(): Promise<void> {
  const chosen = await pickFrom(await todaysMeals(), {
    message: "Save which meal?",
    value: (meal) => meal.id,
    label: (meal) => meal.title,
    hint: macroHint,
  });

  if (chosen === null) {
    log.warn(chalk.red("Nothing logged today to save"));
    return;
  }

  // Blank keeps the meal's title, same convention as the other prompts.
  const name = exitIfCancelled(
    await text({
      message: "Call it what?",
      placeholder: chosen.title,
      defaultValue: "",
    }),
  ).trim();

  const result = await addFavorite(chosen.id, name === "" ? undefined : name);

  if (!result.ok) {
    log.warn(formatFavoriteFailure(result.reason, chosen.id, name));
    return;
  }

  log.success(formatFavorited(result.favorite));
}

export async function runRemoveFavorite(): Promise<void> {
  const chosen = await pickFrom(await getFavorites(), {
    message: "Forget which favorite?",
    value: (favorite) => favorite.name,
    label: (favorite) => favorite.name,
    hint: macroHint,
  });

  if (chosen === null) {
    log.warn(chalk.red("No favorites to remove"));
    return;
  }

  // Confirmed because it is destructive, and defaulted to no for the same
  // reason deleting a meal is — enter-by-reflex should not discard anything.
  const confirmed = exitIfCancelled(
    await confirm({
      message: `Forget "${chosen.name}"?`,
      initialValue: false,
    }),
  );

  if (!confirmed) {
    log.message(chalk.dim("Left it alone."));
    return;
  }

  if (!(await removeFavorite(chosen.name))) {
    log.warn(chalk.red(`No favorite called "${chosen.name}".`));
    return;
  }

  // Removing the shortcut does not touch meals already logged from it.
  log.success(chalk.green(`✓ Removed favorite: ${chosen.name}`));
}
