/**
 * Named, saved meals — the shortcut behind `repeat <name>`.
 *
 * A favourite holds its own copy of the macros rather than pointing at the meal
 * it came from. The source meal can be edited, deleted, or frozen into a day
 * record; a favourite has to keep working through all of that.
 */

import { readData, writeData } from "./storage.js";
import { addMeal } from "./meals.js";
import { type Favorite, type Meal } from "./types.js";

/**
 * Names are matched case-insensitively and ignoring surrounding space, so
 * `repeat Beef` finds a favourite saved as "beef". Stored as typed, compared
 * normalised.
 */
const normaliseName = (name: string): string => name.trim().toLowerCase();

export const getFavorites = async (): Promise<Favorite[]> => {
  const data = await readData();
  return data.favorites;
};

export const findFavorite = (
  favorites: Favorite[],
  name: string,
): Favorite | undefined =>
  favorites.find(
    (favorite) => normaliseName(favorite.name) === normaliseName(name),
  );

export type FavoriteFailure = "not-found" | "duplicate-name" | "empty-name";

export type AddFavoriteResult =
  { ok: true; favorite: Favorite } | { ok: false; reason: FavoriteFailure };

/**
 * Saves a logged meal as a favourite.
 *
 * The name defaults to the meal's title. Any meal works, including one from a
 * recorded day — this reads the meal and writes a separate row, so nothing
 * frozen is touched.
 *
 * A duplicate name is refused rather than overwritten: silently replacing the
 * macros behind a name you already use would change what every future `repeat`
 * logs, without saying so.
 */
export const addFavorite = async (
  mealId: number,
  name?: string,
): Promise<AddFavoriteResult> => {
  const data = await readData();

  const source = data.meals.find((candidate) => candidate.id === mealId);
  if (source === undefined) return { ok: false, reason: "not-found" };

  const chosen = (name ?? source.title).trim();
  if (chosen === "") return { ok: false, reason: "empty-name" };

  if (findFavorite(data.favorites, chosen) !== undefined) {
    return { ok: false, reason: "duplicate-name" };
  }

  const favorite: Favorite = {
    name: chosen,
    // Copied, not referenced — editing or deleting the source meal later
    // must not change what this favourite logs.
    protein: source.protein,
    carbs: source.carbs,
    fats: source.fats,
    cals: source.cals,
    createdAt: new Date().toISOString(),
  };

  data.favorites.push(favorite);
  await writeData(data);

  return { ok: true, favorite };
};

export const removeFavorite = async (name: string): Promise<boolean> => {
  const data = await readData();

  const existing = findFavorite(data.favorites, name);
  if (existing === undefined) return false;

  data.favorites = data.favorites.filter((favorite) => favorite !== existing);
  await writeData(data);

  return true;
};

export type RepeatResult =
  { ok: true; meal: Meal } | { ok: false; reason: "not-found" };

/**
 * Logs a favourite onto today.
 *
 * Routed through addMeal so the new meal gets its id, timestamp and local day
 * from exactly the same path a hand-typed one would.
 */
export const repeatFavorite = async (name: string): Promise<RepeatResult> => {
  const data = await readData();

  const favorite = findFavorite(data.favorites, name);
  if (favorite === undefined) return { ok: false, reason: "not-found" };

  const meal = await addMeal({
    title: favorite.name,
    protein: favorite.protein,
    carbs: favorite.carbs,
    fats: favorite.fats,
    kcals: favorite.cals,
  });

  return { ok: true, meal };
};
