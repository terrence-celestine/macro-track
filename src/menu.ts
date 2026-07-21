/**
 * The interactive main menu, shown when macro-track is run with no arguments.
 *
 * This file is the entry point and dispatch loop only — the actions live in
 * menu-meals.ts, menu-favorites.ts and menu-tracking.ts, and the prompt
 * primitives in menu-prompts.ts.
 *
 * The flag interface (`macro-track add ...`) is unchanged and remains the
 * scriptable path.
 *
 * The menu's "list" means all-time, while the `list` command defaults to today.
 * They differ deliberately: the menu already has a Today entry directly above
 * it, so a today-scoped list there would just be a worse Today.
 */

import { intro, outro, select } from "@clack/prompts";
import chalk from "chalk";

import { exitIfCancelled } from "./menu-prompts.js";
import {
  runAdd,
  runToday,
  runEdit,
  runDelete,
  runList,
  runClear,
} from "./menu-meals.js";
import {
  runRepeat,
  runSaveFavorite,
  runRemoveFavorite,
} from "./menu-favorites.js";
import {
  runGoals,
  runHistory,
  runWeigh,
  runWeight,
  runRemoveWeight,
} from "./menu-tracking.js";

type Action =
  | "today"
  | "add"
  | "repeat"
  | "favorite"
  | "unfavorite"
  | "edit"
  | "delete"
  | "goals"
  | "weigh"
  | "weight"
  | "unweigh"
  | "history"
  | "list"
  | "clear"
  | "exit";

/** Every menu entry, and the action each one runs. */
const ACTIONS: {
  value: Action;
  label: string;
  hint?: string;
  run?: () => Promise<void>;
}[] = [
  {
    value: "today",
    label: "Today",
    hint: "running totals and today's meals",
    run: runToday,
  },
  {
    value: "add",
    label: "Add a meal",
    hint: "log protein, carbs, fats, calories",
    run: runAdd,
  },
  {
    value: "repeat",
    label: "Log a favorite",
    hint: "one of your saved meals",
    run: runRepeat,
  },
  {
    value: "favorite",
    label: "Save a favorite",
    hint: "keep one of today's meals for later",
    run: runSaveFavorite,
  },
  {
    value: "unfavorite",
    label: "Remove a favorite",
    hint: "forget a saved meal",
    run: runRemoveFavorite,
  },
  {
    value: "edit",
    label: "Edit a meal",
    hint: "fix a title or the macros",
    run: runEdit,
  },
  {
    value: "delete",
    label: "Delete a meal",
    hint: "remove one entry",
    run: runDelete,
  },
  {
    value: "goals",
    label: "Set goals",
    hint: "daily targets — blank keeps the current value",
    run: runGoals,
  },
  {
    value: "weigh",
    label: "Record weight",
    hint: "today's weigh-in",
    run: runWeigh,
  },
  {
    value: "weight",
    label: "Weight trend",
    hint: "recent weigh-ins and the average",
    run: runWeight,
  },
  {
    value: "unweigh",
    label: "Remove a weigh-in",
    hint: "forget one day's reading",
    run: runRemoveWeight,
  },
  {
    value: "history",
    label: "History",
    hint: "the last 7 closed days",
    run: runHistory,
  },
  {
    value: "list",
    label: "All meals",
    hint: "everything logged so far",
    run: runList,
  },
  {
    value: "clear",
    label: "Clear meals",
    hint: "wipe the log and reset ids",
    run: runClear,
  },
  // No `run`: exit is the one entry that ends the loop rather than doing work.
  { value: "exit", label: "Exit" },
];

const promptAction = async (): Promise<Action> =>
  exitIfCancelled(
    await select<Action>({
      message: "What do you want to do?",
      options: ACTIONS.map(({ value, label, hint }) => ({
        value,
        label,
        ...(hint ? { hint } : {}),
      })),
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
    const entry = ACTIONS.find((candidate) => candidate.value === action)!;

    // One table drives both the options and the dispatch, so adding an entry
    // can't leave it listed but unhandled.
    if (entry.run) {
      await entry.run();
    } else {
      running = false;
    }
  }

  outro("Done.");
};
