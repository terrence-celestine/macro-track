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

### `history`

Closed days, most recent first.

| Flag | Alias | Description |
| --- | --- | --- |
| `--days <count>` | `-d` | How many days to show (default 7) |

```bash
npm start -- history
```

```
History
  2026-07-19  ✗  2800 kcal  P 40g  C 300g  F 90g
  2026-07-18  ✓  1800 kcal  P 200g  C 100g  F 30g
```

Days are frozen automatically: the first command you run on a new day closes out every earlier day that has meals and no record yet. There's no daemon and no cron — closing is a side effect of using the tool, and running a command when nothing is stale writes nothing at all.

A closed day stores its own totals, a **snapshot of the goals as they stood at close**, and a hit verdict. The snapshot is the point: raising your protein target in August must not retroactively turn July's hits into misses.

Closing freezes a summary, it does not delete. The underlying meals stay put, so `list --all` still shows everything.

#### The hit verdict

Goals point in a direction. **Protein is a floor** — exceeding it is a win. **Carbs, fats and calories are ceilings.** A day hits when every macro *that has a target* satisfies its direction; macros you never set a target for are ignored, so a protein-only goal is judged on protein alone.

The verdict has three states, not two:

| | Meaning |
| --- | --- |
| `✓` | Every target met |
| `✗` | At least one target missed |
| `–` | No goals were set that day — unjudged, not failed |

Direction is a fixed convention rather than per-goal configuration. Making it configurable later means adding a field to stored goals and migrating existing records.

### `goal set`

Set daily targets. Every flag is optional and values merge into what's already stored, so you can adjust one macro without restating the rest. Passing no flags at all is an error rather than a silent no-op.

| Flag | Alias | Description |
| --- | --- | --- |
| `--protein <grams>` | `-p` | Protein target |
| `--carbs <grams>` | `-c` | Carbs target |
| `--fats <grams>` | `-f` | Fats target |
| `--kcals <cals>` | `-k` | Calorie target |

```bash
npm start -- goal set -p 180 -k 2000
npm start -- goal set -c 200          # protein and calories are kept
```

### `goal show` / `goal clear`

Print the current targets, or remove them all. Targets survive `clear` — wiping the meal log doesn't discard what you were aiming for.

### `today`

Running totals for the local day, followed by the meals behind them. Macros with a target show progress and what's left; macros without one render plain.

```bash
npm start -- today
```

```
Today — 2 meals
  Calories: 400 / 2000        1600 left
  Protein:  18.5g / 180g      161.5g left
  Carbs:    65g
  Fats:     7g

✓ Found meal: ground beef : Protein: 14 - Fats: 6 - Carbs: 20
✓ Found meal: rice : Protein: 4.5 - Fats: 1 - Carbs: 45
```

Going past a target reads `600 over` instead. An empty day prints zeros rather than nothing, so the command always answers the question it was asked.

### `list`

Print today's meals.

| Flag | Alias | Description |
| --- | --- | --- |
| `--all` | `-a` | Every meal on record, not just today's |

```bash
npm start -- list
npm start -- list --all
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
  "nextId": 2,
  "goals": { "protein": 180, "cals": 2000 },
  "days": [
    {
      "date": "2026-07-18",
      "totals": { "protein": 200, "carbs": 100, "fats": 30, "cals": 1800 },
      "goals": { "protein": 180, "cals": 2000 },
      "hit": true,
      "mealCount": 4,
      "closedAt": "2026-07-19T08:12:44.301Z"
    }
  ]
}
```

`goals` is partial by design — an unset macro is meaningfully different from a target of zero, and `goal set` merges rather than replaces.

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
| `src/days.ts` | Goal direction, hit verdict, lazy close, history |
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
- [x] `today` — running totals for the local day
- [x] `goal set` — daily macro targets, stored in the data file
- [x] `today` against goals — remaining macros per target
- [x] Day records — totals, goals snapshot, and a `hit` verdict frozen per day
- [x] Lazy day close on the first command of a new day
- [ ] `delete <id>` — remove a single meal, so a typo doesn't need `clear`
- [ ] Per-goal direction, if the protein-floor convention ever stops fitting