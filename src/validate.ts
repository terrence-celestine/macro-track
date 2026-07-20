/**
 * Shared macro-value validation.
 *
 * Both entry points need the same rules: the commander flags (`-p 14`) and the
 * interactive menu prompts. This module owns the rules so the two can never
 * drift apart. It deliberately knows nothing about commander or clack — it
 * returns an error message, and each caller turns that into its own kind of
 * failure.
 */

/** Returns an error message, or undefined if the value is a valid gram amount. */
export function validateGrams(value: string): string | undefined {
    const trimmed = value.trim()
    if (trimmed === "") return "Enter a number"

    // Number() rather than parseFloat(): parseFloat("12abc") silently returns 12.
    const n = Number(trimmed)
    if (Number.isNaN(n)) return `"${value}" is not a number`
    if (n < 0) return "must be zero or positive"
    return undefined
}
