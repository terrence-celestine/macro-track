/**
 * Small helpers with no domain of their own.
 */

/**
 * Drops keys whose value is undefined.
 *
 * Commander hands an action every declared flag as a key, unset ones included,
 * so spreading its options object straight onto stored data writes `undefined`
 * over fields the user never mentioned. Both `goal set` and `edit` merge, and
 * both need this first.
 */
export const definedOnly = <T extends object>(update: T): Partial<T> =>
    Object.fromEntries(
        Object.entries(update).filter(([, value]) => value !== undefined),
    ) as Partial<T>
