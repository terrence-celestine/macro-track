/**
 * Daily macro targets.
 *
 * Goals are partial: setting protein alone is valid, and an unset macro means
 * something different from a target of zero. Everything reading them has to
 * handle a field being absent.
 */

import { readData, writeData } from "./storage.js"
import { definedOnly } from "./util.js"
import { type Goals } from "./types.js"

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
