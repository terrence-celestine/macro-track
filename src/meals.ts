/**
 * Logging, reading, changing and removing meals.
 *
 * The rule that runs through this file: a meal whose day already has a frozen
 * record can no longer be changed. `openMeals` and `findOpenMeal` are the two
 * places that decide it, so every caller inherits the same answer.
 */

import { defaultData, readData, writeData } from "./storage.js"
import { toLocalDate, todayLocalDate } from "./date.js"
import { definedOnly } from "./util.js"
import { type Macros, type Meal, type MealsData } from "./types.js"

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

/**
 * Adds up the four macro fields. Returns a Macros rather than a bare object so
 * meals, totals, and goals all stay the same shape and can be compared field by
 * field without conversion.
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
