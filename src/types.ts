export type Macros = {
    protein: number
    carbs: number
    fats: number
    cals: number
}

export type Meal = Macros & {
    id: number
    title: string
    createdAt: string
}

// The shape of the whole data file
export type MealsData = {
    meals: Meal[]
    nextId: number
}