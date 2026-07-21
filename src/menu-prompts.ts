/**
 * The prompt primitives every menu action is built from.
 *
 * Nothing here reads or writes the data file — these take values and return
 * answers, so the action modules stay about what the tool does rather than how
 * it asks.
 */

import { select, text, isCancel, cancel } from "@clack/prompts";

import { validateGrams } from "./validate.js";
import { type Macros } from "./types.js";

/**
 * Ctrl+C at any prompt ends the session.
 *
 * clack signals cancellation by returning a symbol rather than throwing, so it
 * has to be handled explicitly. `group` gives one hook for a whole sequence;
 * standalone prompts go through exitIfCancelled below.
 */
export const cancelSession = (): never => {
  cancel("Cancelled.");
  process.exit(0);
};

/** The single-prompt equivalent of group's onCancel. */
export function exitIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) cancelSession();
  return value as T;
}

/** A required macro amount. Returned as text; group callers convert. */
export const gramsPrompt = (label: string) =>
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
export const optionalGramsPrompt = (
  label: string,
  current: number | undefined,
) =>
  text({
    message: label,
    placeholder:
      current === undefined ? "not set — leave blank to skip" : `${current}`,
    defaultValue: "",
    validate: (input) => (input?.trim() ? validateGrams(input) : undefined),
  });

/** Blank answers mean "unchanged", so they become undefined rather than 0. */
export const optionalNumber = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number(value.trim());

/**
 * The one-line macro summary under a select option.
 *
 * Takes Macros rather than Meal so the meal pickers and the favourites picker
 * share it — they were three copies of the same template literal.
 */
export const macroHint = (m: Macros): string =>
  `${m.cals} kcal · P ${m.protein}g · C ${m.carbs}g · F ${m.fats}g`;

/**
 * Picks one item from a list, or returns null when the list is empty.
 *
 * Five actions were each doing the same three steps — fetch, bail if empty,
 * build a select — differing only in the labels. Returning null rather than
 * printing the empty message here keeps the wording with the action, since
 * "nothing to delete" and "no favorites yet" explain different things.
 */
export async function pickFrom<T, V extends string | number>(
  items: T[],
  options: {
    message: string;
    /**
     * The identity each option carries — a meal id, a favourite name, a date.
     *
     * Deliberately the caller's choice rather than the array index. An index
     * would make the selection mean "the third one", so anything reasoning
     * about the choice would be coupled to list order rather than to the thing
     * itself.
     */
    value: (item: T) => V;
    label: (item: T) => string;
    hint?: (item: T) => string;
  },
): Promise<T | null> {
  if (items.length === 0) return null;

  const picked = exitIfCancelled(
    await select<V>({
      message: options.message,
      // clack's Option<Value> is a conditional type keyed on Value. With V
      // still generic here TypeScript cannot resolve which branch applies,
      // even though every V this is called with is a primitive and so always
      // takes the same one. The shape below is correct; the cast only tells
      // the compiler which branch it landed in.
      options: items.map((item) => ({
        value: options.value(item),
        label: options.label(item),
        hint: options.hint?.(item),
      })) as Parameters<typeof select<V>>[0]["options"],
    }),
  );

  return items.find((item) => options.value(item) === picked)!;
}
