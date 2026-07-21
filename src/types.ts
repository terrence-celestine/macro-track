export type Macros = {
    protein: number
    carbs: number
    fats: number
    cals: number
}

export type Meal = Macros & {
    id: number
    title: string
    /** Exact instant the meal was logged, UTC ISO 8601. Used for ordering. */
    createdAt: string
    /**
     * The local calendar day the meal belongs to, YYYY-MM-DD. This is the field
     * day grouping reads — createdAt is UTC and files late-evening meals under
     * the wrong day.
     */
    localDate: string
}

/**
 * Daily macro targets. Partial because `goal set` merges — setting protein
 * alone is valid, and an unset macro is meaningfully different from a target
 * of zero. Anything reading goals has to handle a field being absent.
 */
export type Goals = Partial<Macros>

/**
 * A finished day, frozen at close.
 *
 * Totals and goals are copied in rather than derived on read, because both
 * change underneath you: editing goals in August must not retroactively rewrite
 * whether you hit your targets in July. The snapshot is the whole point.
 */
export type DayRecord = {
    /** Local calendar day, YYYY-MM-DD. */
    date: string
    totals: Macros
    /** The targets as they stood when the day was closed. */
    goals: Goals
    /** null when no goals were set that day — unjudged, distinct from missed. */
    hit: boolean | null
    mealCount: number
    closedAt: string
}

// The shape of the whole data file
export type MealsData = {
    meals: Meal[]
    nextId: number
    goals: Goals
    days: DayRecord[]
}