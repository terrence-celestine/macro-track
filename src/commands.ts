/**
 * The actual work behind each command.
 *
 * These were inline in commander's .action() handlers, which meant the menu
 * would have had to duplicate them. Pulled out here so both entry points call
 * the same code and print the same output.
 */

import chalk from "chalk"
import { defaultData, readData, writeData } from "./storage.js"
import { toLocalDate, todayLocalDate } from "./date.js"
import { type DayRecord, type Favorite, type Goals, type Macros, type Meal, type MealsData } from "./types.js"

/**
 * Drops keys whose value is undefined.
 *
 * Commander hands an action every declared flag as a key, unset ones included,
 * so spreading its options object straight onto stored data writes `undefined`
 * over fields the user never mentioned. Both `goal set` and `edit` merge, and
 * both need this first.
 */
const definedOnly = <T extends object>(update: T): Partial<T> =>
    Object.fromEntries(
        Object.entries(update).filter(([, value]) => value !== undefined),
    ) as Partial<T>

export type MealInput = {
    title: string
    protein: number
    carbs: number
    fats: number
    kcals: number
}

export const addMeal = async (input: MealInput): Promise<Meal> => {
    const data = await readData()

    // One Date for both fields, so the timestamp and the day bucket can never
    // disagree across a midnight boundary.
    const now = new Date()

    const meal: Meal = {
        id: data.nextId,
        title: input.title,
        cals: input.kcals,
        protein: input.protein,
        carbs: input.carbs,
        fats: input.fats,
        createdAt: now.toISOString(),
        localDate: toLocalDate(now),
    }

    data.meals.push(meal)
    data.nextId += 1
    await writeData(data)

    return meal
}

export const listMeals = async (): Promise<Meal[]> => {
    const data = await readData()
    return data.meals
}

/**
 * Meals on days that have not been frozen into a record yet — the ones still
 * open to change.
 *
 * A meal whose day already has a record is off limits to both delete and edit:
 * the record's totals were computed from it, and changing the meal would leave
 * the two disagreeing forever. Rather than offer such meals and reject them,
 * they are simply not offered — the constraint lives in one place and every
 * caller inherits it.
 */
export const openMeals = async (): Promise<Meal[]> => {
    const data = await readData()
    const closed = new Set(data.days.map(day => day.date))

    return data.meals.filter(meal => !closed.has(meal.localDate))
}

/**
 * Why a change to a meal could not happen. Returned rather than thrown so each
 * entry point can phrase the failure its own way — commander wants stderr and a
 * non-zero exit, clack wants a warning in the menu.
 */
export type MealFailure = "not-found" | "day-closed"

export type MealResult =
    | { ok: true; meal: Meal }
    | { ok: false; reason: MealFailure }

/** Shared precondition for delete and edit: the meal exists and its day is open. */
const findOpenMeal = (data: MealsData, id: number): MealResult => {
    const meal = data.meals.find(candidate => candidate.id === id)
    if (meal === undefined) return { ok: false, reason: "not-found" }

    const closed = new Set(data.days.map(day => day.date))
    if (closed.has(meal.localDate)) return { ok: false, reason: "day-closed" }

    return { ok: true, meal }
}

export const deleteMeal = async (id: number): Promise<MealResult> => {
    const data = await readData()

    const found = findOpenMeal(data, id)
    if (!found.ok) return found

    data.meals = data.meals.filter(candidate => candidate.id !== id)
    // nextId deliberately keeps climbing — reusing a freed id would make a
    // stale id from an earlier `list` silently point at a different meal.
    await writeData(data)

    return found
}

/**
 * The fields an edit may touch.
 *
 * Deliberately excludes id, createdAt and localDate. Editing what you ate must
 * not move the meal to a different day or renumber it — that would change which
 * day's totals it counts toward, or break ids someone already copied.
 */
export type MealEdit = Partial<Pick<Meal, "title" | "protein" | "carbs" | "fats" | "cals">>

export const editMeal = async (id: number, update: MealEdit): Promise<MealResult> => {
    const data = await readData()

    const found = findOpenMeal(data, id)
    if (!found.ok) return found

    // Same merge semantics as `goal set`: only the fields you named change, and
    // undefined means "leave alone" rather than "blank it".
    Object.assign(found.meal, definedOnly(update))
    await writeData(data)

    return found
}

/* --- favorites --- */

/**
 * Names are matched case-insensitively and ignoring surrounding space, so
 * `repeat Beef` finds a favourite saved as "beef". Stored as typed, compared
 * normalised.
 */
const normaliseName = (name: string): string => name.trim().toLowerCase()

export const getFavorites = async (): Promise<Favorite[]> => {
    const data = await readData()
    return data.favorites
}

export const findFavorite = (favorites: Favorite[], name: string): Favorite | undefined =>
    favorites.find(favorite => normaliseName(favorite.name) === normaliseName(name))

export type FavoriteFailure = "not-found" | "duplicate-name" | "empty-name"

export type AddFavoriteResult =
    | { ok: true; favorite: Favorite }
    | { ok: false; reason: FavoriteFailure }

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
export const addFavorite = async (mealId: number, name?: string): Promise<AddFavoriteResult> => {
    const data = await readData()

    const source = data.meals.find(candidate => candidate.id === mealId)
    if (source === undefined) return { ok: false, reason: "not-found" }

    const chosen = (name ?? source.title).trim()
    if (chosen === "") return { ok: false, reason: "empty-name" }

    if (findFavorite(data.favorites, chosen) !== undefined) {
        return { ok: false, reason: "duplicate-name" }
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
    }

    data.favorites.push(favorite)
    await writeData(data)

    return { ok: true, favorite }
}

export const removeFavorite = async (name: string): Promise<boolean> => {
    const data = await readData()

    const existing = findFavorite(data.favorites, name)
    if (existing === undefined) return false

    data.favorites = data.favorites.filter(favorite => favorite !== existing)
    await writeData(data)

    return true
}

export type RepeatResult =
    | { ok: true; meal: Meal }
    | { ok: false; reason: "not-found" }

/**
 * Logs a favourite onto today.
 *
 * Routed through addMeal so the new meal gets its id, timestamp and local day
 * from exactly the same path a hand-typed one would.
 */
export const repeatFavorite = async (name: string): Promise<RepeatResult> => {
    const data = await readData()

    const favorite = findFavorite(data.favorites, name)
    if (favorite === undefined) return { ok: false, reason: "not-found" }

    const meal = await addMeal({
        title: favorite.name,
        protein: favorite.protein,
        carbs: favorite.carbs,
        fats: favorite.fats,
        kcals: favorite.cals,
    })

    return { ok: true, meal }
}

/** Meals belonging to one local calendar day, YYYY-MM-DD. */
export const mealsOn = async (date: string): Promise<Meal[]> => {
    const data = await readData()
    return data.meals.filter(meal => meal.localDate === date)
}

/** Meals logged so far on the machine's current local day. */
export const todaysMeals = async (): Promise<Meal[]> => mealsOn(todayLocalDate())

export const clearMeals = async (): Promise<void> => {
    const data = await readData()
    // Goals outlive the meal log — clearing what you ate should not silently
    // wipe the targets you set.
    await writeData({ ...defaultData(), goals: data.goals })
}

/* --- goals --- */

export const getGoals = async (): Promise<Goals> => {
    const data = await readData()
    return data.goals
}

/** True when no macro has a target yet. */
export const hasGoals = (goals: Goals): boolean => Object.keys(goals).length > 0

/**
 * Merges a partial goal into whatever is already stored.
 *
 * Undefined keys are stripped first — object spread would otherwise write
 * `{ protein: undefined }` over an existing target, so `goal set -c 200` would
 * quietly erase the protein goal it was never asked to touch.
 */
export const setGoals = async (update: Goals): Promise<Goals> => {
    const data = await readData()

    data.goals = { ...data.goals, ...definedOnly(update) }
    await writeData(data)

    return data.goals
}

export const clearGoals = async (): Promise<void> => {
    const data = await readData()
    data.goals = {}
    await writeData(data)
}

/**
 * Adds up the four macro fields. Returns a Macros rather than a bare object so
 * meals, totals, and (later) goals all stay the same shape and can be compared
 * field by field without conversion.
 */
export const sumMacros = (meals: Meal[]): Macros =>
    meals.reduce<Macros>(
        (total, meal) => ({
            protein: total.protein + meal.protein,
            carbs: total.carbs + meal.carbs,
            fats: total.fats + meal.fats,
            cals: total.cals + meal.cals,
        }),
        { protein: 0, carbs: 0, fats: 0, cals: 0 },
    )

/* --- shared output helpers, so both entry points read identically --- */

export const formatAdded = (meal: Meal): string => {
    return chalk.green(
        `✓ Added meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs} - Calories: ${meal.cals}`,
    )
}

export const formatDeleted = (meal: Meal): string =>
    chalk.green(`✓ Deleted meal: ${meal.title} (id ${meal.id})`)

export const formatRepeated = (meal: Meal): string =>
    chalk.green(
        `✓ Logged again: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs} - Calories: ${meal.cals}`,
    )

export const formatFavorited = (favorite: Favorite): string =>
    chalk.green(`✓ Saved favorite: ${favorite.name} — log it with \`repeat ${favorite.name}\``)

export const formatFavoriteFailure = (reason: FavoriteFailure, id: number, name?: string): string => {
    if (reason === "not-found") return chalk.red(`No meal with id ${id}. Run \`list --all\` to see the ids.`)
    if (reason === "empty-name") return chalk.red(`A favorite needs a name.`)
    return chalk.yellowBright(`You already have a favorite called "${name}". Pick another name with --as.`)
}

/** The saved favorites, for `favorite list`. */
export const formatFavorites = (favorites: Favorite[]): string[] => {
    if (favorites.length === 0) {
        return [chalk.red("No favorites yet — save one with `favorite add <id>`")]
    }

    return [
        chalk.bold("Favorites"),
        ...favorites.map(favorite =>
            `  ${chalk.cyan(favorite.name)} — ${grams(favorite.cals)} kcal  P ${grams(favorite.protein)}g  C ${grams(favorite.carbs)}g  F ${grams(favorite.fats)}g`,
        ),
    ]
}

export const formatEdited = (meal: Meal): string =>
    chalk.green(
        `✓ Updated meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs} - Calories: ${meal.cals}`,
    )

/** Why a change failed, in words. The verb differs, the reasons do not. */
export const formatMealFailure = (id: number, reason: MealFailure, verb: string): string =>
    reason === "not-found"
        ? chalk.red(`No meal with id ${id}. Run \`list\` to see the ids.`)
        : chalk.yellowBright(`Meal ${id} belongs to a day that's already recorded, so it can't be ${verb}.`)

export const formatDeleteFailure = (id: number, reason: MealFailure): string =>
    formatMealFailure(id, reason, "deleted")

export const formatEditFailure = (id: number, reason: MealFailure): string =>
    formatMealFailure(id, reason, "edited")

export const formatMeal = (meal: Meal): string => {
    return chalk.green(
        `✓ Found meal: ${meal.title} : Protein: ${meal.protein} - Fats: ${meal.fats} - Carbs: ${meal.carbs}`,
    )
}

/** Trims a trailing ".0" so whole numbers read as 14 rather than 14.0. */
const grams = (n: number): string => `${Math.round(n * 10) / 10}`

/** The four macros in display order, with their labels and units. */
const MACRO_ROWS = [
    { key: "cals", label: "Calories", unit: "" },
    { key: "protein", label: "Protein", unit: "g" },
    { key: "carbs", label: "Carbs", unit: "g" },
    { key: "fats", label: "Fats", unit: "g" },
] as const

const LABEL_WIDTH = 9 // "Calories:" — the longest label plus its colon

/**
 * One macro's line: the running total, then the target and what's left if a
 * goal exists for that macro. Macros without a goal render exactly as they did
 * before goals existed, which is what keeps a partially-set goal readable.
 */
const formatMacroRow = (
    label: string,
    unit: string,
    total: number,
    goal: number | undefined,
): string => {
    const padded = `${label}:`.padEnd(LABEL_WIDTH)
    const value = `${chalk.cyan(grams(total))}${unit}`

    if (goal === undefined) return `  ${padded} ${value}`

    const remaining = goal - total
    const progress = `${value} / ${grams(goal)}${unit}`

    const verdict = remaining >= 0
        ? chalk.dim(`${grams(remaining)}${unit} left`)
        : chalk.yellow(`${grams(-remaining)}${unit} over`)

    return `  ${padded} ${progress.padEnd(24)} ${verdict}`
}

/**
 * The totals block for a day. Kept as an array of lines so the two entry points
 * can emit it their own way — console.log joins them, clack's log.message wants
 * them one at a time.
 *
 * `goals` is optional so callers that have no targets to show stay unchanged.
 */
export const formatTotals = (totals: Macros, mealCount: number, goals: Goals = {}): string[] => {
    const meals = `${mealCount} ${mealCount === 1 ? "meal" : "meals"}`

    return [
        chalk.bold(`Today — ${meals}`),
        ...MACRO_ROWS.map(({ key, label, unit }) =>
            formatMacroRow(label, unit, totals[key], goals[key]),
        ),
    ]
}

/**
 * One line per closed day, for `history`.
 *
 * The verdict has three states, not two: hit, missed, and unjudged for days
 * where no goals were set. Collapsing the third into "missed" would read as a
 * failure for days you never set a target on.
 */
export const formatHistory = (days: DayRecord[]): string[] => {
    if (days.length === 0) return [chalk.red("No days closed yet")]

    return [
        chalk.bold("History"),
        ...days.map(day => {
            const verdict = day.hit === null
                ? chalk.dim("–")
                : day.hit ? chalk.green("✓") : chalk.yellow("✗")

            const macros = [
                `${grams(day.totals.cals)} kcal`,
                `P ${grams(day.totals.protein)}g`,
                `C ${grams(day.totals.carbs)}g`,
                `F ${grams(day.totals.fats)}g`,
            ].join("  ")

            return `  ${day.date}  ${verdict}  ${macros}`
        }),
    ]
}

/** The goals themselves, for `goal show`. */
export const formatGoals = (goals: Goals): string[] => {
    if (!hasGoals(goals)) return [chalk.red("No goals set")]

    return [
        chalk.bold("Daily goals"),
        ...MACRO_ROWS
            .filter(({ key }) => goals[key] !== undefined)
            .map(({ key, label, unit }) =>
                `  ${`${label}:`.padEnd(LABEL_WIDTH)} ${chalk.cyan(grams(goals[key]!))}${unit}`,
            ),
    ]
}
