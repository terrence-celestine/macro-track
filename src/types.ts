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

// The shape of the whole data file
export type MealsData = {
    meals: Meal[]
    nextId: number
}