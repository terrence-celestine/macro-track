# macro-track

A CLI suite to help me track my meals, weight, and macros.

## Install

```bash
npm install
```

## Usage

Run via npm during development. Note the `--` separator: without it, npm swallows the short flags before they reach the CLI.

```bash
npm start -- <command> [options]
```

Or invoke directly:

```bash
npx tsx src/index.ts <command> [options]
```

## Commands

### `add <title>`

Log a meal. All four macro flags are required.

| Flag | Alias | Description |
| --- | --- | --- |
| `--protein <grams>` | `-p` | Protein in grams |
| `--carbs <grams>` | `-c` | Carbs in grams |
| `--fats <grams>` | `-f` | Fats in grams |
| `--kcals <cals>` | `-k` | Calories |

```bash
npm start -- add "ground beef" -p 14 -c 20 -f 6 --kcals 200
```

Values must parse as non-negative numbers. Anything else is rejected at parse time with the offending flag and value named. Missing flags are reported together in a single error.

### `list`

Print every meal on record.

```bash
npm start -- list
```

### `clear`

Delete all meals and reset the ID counter.

```bash
npm start -- clear
```

## Data

Meals are stored as JSON at `~/.macro-track/macros.json`:

```json
{
  "meals": [
    {
      "id": 1,
      "title": "ground beef",
      "protein": 14,
      "cals": 200,
      "carbs": 20,
      "fats": 6,
      "createdAt": "2026-07-19T14:32:05.123Z",
      "localDate": "2026-07-19"
    }
  ],
  "nextId": 2
}
```

`createdAt` is a UTC ISO timestamp, kept as the precise instant for ordering.

`localDate` is the local calendar day, `YYYY-MM-DD`, and is the field day grouping reads. The two disagree for exactly the meals that matter most: a 9pm dinner in New York is already tomorrow in UTC, so grouping on `createdAt` would file an entire evening under the next day's totals. Stored as a string because it sorts chronologically as-is.

Both are stamped from a single `Date` at write time, so they cannot disagree across a midnight boundary.

Missing keys fall back to defaults on read, so adding fields to the data shape won't break existing files.

## Source

| File | Responsibility |
| --- | --- |
| `src/types.ts` | `Macros`, `Meal`, `MealsData` |
| `src/storage.ts` | Reading and writing the JSON file |
| `src/date.ts` | Local-day formatting (`toLocalDate`, `todayLocalDate`) |
| `src/validate.ts` | Macro-value rules, shared by the flags and the menu |
| `src/commands.ts` | The work behind each command, plus output formatting |
| `src/menu.ts` | The interactive menu shown when run with no arguments |
| `src/index.ts` | Command definitions, flag parsing, entry-point dispatch |

`Macros` holds the four numeric fields; `Meal` intersects it with `id`, `title`, and `createdAt`, so meals, goals, and daily totals all share one definition.

## Scripts

```bash
npm start -- <command>   # run
npm run dev              # run with watch
npm run typecheck        # tsc --noEmit
```

## Stack

TypeScript, Node, [commander](https://github.com/tj/commander.js) for parsing, [chalk](https://github.com/chalk/chalk) for output, [tsx](https://github.com/privatenumber/tsx) for running TS directly.

## Roadmap

- [x] `Macros` shared type across meals, goals, and daily totals
- [x] Local-date field on meals so evening meals aren't filed under the next UTC day
- [ ] `today` — running totals for the local day
- [ ] `goal set` — daily macro targets, stored in the data file
- [ ] `today` against goals — remaining macros and a `hit` verdict
- [ ] Day records — totals, goals snapshot, and a `hit` verdict frozen per day
- [ ] Lazy day close on the first command of a new day
- [ ] `delete <id>` — remove a single meal, so a typo doesn't need `clear`