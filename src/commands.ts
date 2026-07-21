/**
 * Re-export barrel over the command modules.
 *
 * The work lives in meals.ts, favorites.ts, goals.ts and format.ts — this file
 * exists so callers can pull from one place, and so the split did not have to
 * touch every import in the codebase at once.
 *
 * Nothing new should be defined here. New code is better off importing the
 * specific module, which says which area it depends on.
 */

export {
    type MealInput, type MealFailure, type MealResult, type MealEdit,
    addMeal, listMeals, openMeals, deleteMeal, editMeal,
    mealsOn, todaysMeals, clearMeals, sumMacros,
} from "./meals.js"

export {
    type FavoriteFailure, type AddFavoriteResult, type RepeatResult,
    getFavorites, findFavorite, addFavorite, removeFavorite, repeatFavorite,
} from "./favorites.js"

export {
    getGoals, hasGoals, setGoals, clearGoals,
} from "./goals.js"

export {
    formatAdded, formatRepeated, formatEdited, formatDeleted, formatMeal,
    formatMealFailure, formatDeleteFailure, formatEditFailure,
    formatFavorited, formatFavoriteFailure, formatFavorites,
    formatTotals, formatGoals, formatHistory,
} from "./format.js"
