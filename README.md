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

| Flag                | Alias | Description      |
| ------------------- | ----- | ---------------- |
| `--protein <grams>` | `-p`  | Protein in grams |
| `--carbs <grams>`   | `-c`  | Carbs in grams   |
| `--fats <grams>`    | `-f`  | Fats in grams    |
| `--kcals <cals>`    | `-k`  | Calories         |

```bash
npm start -- add "ground beef" -p 14 -c 20 -f 6 --kcals 200
```

Values must parse as non-negative numbers. Anything else is rejected at parse time with the offending flag and value named. Missing flags are reported together in a single error.

### `weigh <weight>` / `weight`

Record today's weight, and read the trend.

```bash
npm start -- weigh 182.4
npm start -- weight
```

```
Weight
  7-day average: 182.1
  down 1.3 against the previous week

  2026-07-14  181.9
  2026-07-13  181.5
  2026-07-12  182.2
```

| Flag             | Alias | Description                             |
| ---------------- | ----- | --------------------------------------- |
| `--days <count>` | `-d`  | How many weigh-ins to list (default 14) |

**Weights are unitless** — whatever your scale reads is what gets stored and printed. Recording a unit would mean converting when it changed, for a series only ever compared against itself.

**One reading per local day.** Weighing in twice replaces the first, because a second reading is a correction rather than a second data point. Keeping both would let one day count twice in the average.

**The average leads because the daily number is noise.** Day-to-day weight moves on water, sodium and timing; the trailing average is what's worth reacting to. The change line compares the last seven weigh-ins against the seven before them, and is omitted entirely until there are fourteen — a change computed from half-empty windows looks meaningful and isn't.

The window counts _recorded weigh-ins_, not calendar days. Skipping a Tuesday widens the window rather than dragging the average toward nothing.

Weigh-ins survive `clear`, like goals do.

### `history`

Closed days, most recent first.

| Flag             | Alias | Description                       |
| ---------------- | ----- | --------------------------------- |
| `--days <count>` | `-d`  | How many days to show (default 7) |

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

Goals point in a direction. **Protein is a floor** — exceeding it is a win. **Carbs, fats and calories are ceilings.** A day hits when every macro _that has a target_ satisfies its direction; macros you never set a target for are ignored, so a protein-only goal is judged on protein alone.

The verdict has three states, not two:

|     | Meaning                                           |
| --- | ------------------------------------------------- |
| `✓` | Every target met                                  |
| `✗` | At least one target missed                        |
| `–` | No goals were set that day — unjudged, not failed |

Direction is a fixed convention, deliberately not configurable. Making it per-goal would mean a direction field on every stored goal, a migration for existing records, and more flags to learn — for a distinction that doesn't vary in practice.

### `goal set`

Set daily targets. Every flag is optional and values merge into what's already stored, so you can adjust one macro without restating the rest. Passing no flags at all is an error rather than a silent no-op.

| Flag                | Alias | Description    |
| ------------------- | ----- | -------------- |
| `--protein <grams>` | `-p`  | Protein target |
| `--carbs <grams>`   | `-c`  | Carbs target   |
| `--fats <grams>`    | `-f`  | Fats target    |
| `--kcals <cals>`    | `-k`  | Calorie target |

```bash
npm start -- goal set -p 180 -k 2000
npm start -- goal set -c 200          # protein and calories are kept
```

### `goal show` / `goal clear`

Print the current targets, or remove them all. Targets survive `clear` — see below.

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

| Flag    | Alias | Description                            |
| ------- | ----- | -------------------------------------- |
| `--all` | `-a`  | Every meal on record, not just today's |

```bash
npm start -- list
npm start -- list --all
```

### `favorite add <id>` / `favorite list` / `favorite remove <name>`

Save a meal you log often, so you never retype its macros again.

| Flag          | Description                                    |
| ------------- | ---------------------------------------------- |
| `--as <name>` | What to call it (defaults to the meal's title) |

```bash
npm start -- favorite add 3 --as beef
npm start -- favorite list
npm start -- favorite remove beef
```

Names are matched case-insensitively and ignoring surrounding space, so `repeat Beef` finds `beef`. A duplicate name is refused rather than overwritten — silently replacing the macros behind a name you already use would change what every future `repeat` logs without telling you. Use `--as` to pick another.

Any meal id works, including one from a recorded day: this reads the meal and writes a separate row, so nothing frozen is touched.

**A favorite is a snapshot, not a pointer.** It copies the macros at save time and stops being connected to the meal it came from. Delete that meal, or edit it, and the favorite keeps logging what it was saved with. Anything else would mean editing one dinner silently rewrote a shortcut you use every day.

### `repeat <name>`

Log a favorite onto today.

```bash
npm start -- repeat beef
```

The new meal gets a fresh id, a fresh timestamp and today's local date, exactly as if you'd typed it by hand. The favorite stays saved.

In the menu, **Log a favorite** picks from your saved list, and **Save a favorite** keeps one of today's meals for later.

### `edit <id>`

Change a meal's title or macros. Every flag is optional and only the fields you name change, same merge semantics as `goal set`. Passing no flags is an error rather than a silent no-op.

| Flag                | Alias | Description      |
| ------------------- | ----- | ---------------- |
| `--title <title>`   | `-t`  | The meal title   |
| `--protein <grams>` | `-p`  | Protein in grams |
| `--carbs <grams>`   | `-c`  | Carbs in grams   |
| `--fats <grams>`    | `-f`  | Fats in grams    |
| `--kcals <cals>`    | `-k`  | Calories         |

```bash
npm start -- edit 3 -p 45              # carbs, fats and calories are kept
npm start -- edit 3 --title "chicken thigh"
```

An edit never touches the meal's `id`, `createdAt` or `localDate`. Moving a meal to another day would silently shift it into a different day's totals, and renumbering would break ids you'd already copied from `list`.

Like `delete`, meals from recorded days can't be edited — see below.

### `delete <id>`

Remove a single meal. Ids come from `list`.

```bash
npm start -- delete 3
```

No confirmation prompt — this is the scriptable path, and one meal is cheap to re-add. The interactive menu confirms instead, and defaults to "no".

**Meals from recorded days can't be deleted or edited.** Once a day is closed, its frozen totals were computed from those meals; changing one would leave the record describing something that no longer exists. Both commands refuse with an explanation, and the menu's pickers don't list such meals at all — the rule lives in one place (`openMeals`) and every caller inherits it.

Ids are never reused. Deleting meal 3 and adding another gives you 4, so an id you copied from an earlier `list` can never quietly point at a different meal.

### `clear`

Delete all meals and reset the ID counter.

```bash
npm start -- clear
```

**It clears meals and nothing else.** Goals, favorites, weigh-ins and frozen day records all survive — they aren't meals, and day records in particular can't be rebuilt, since the meals behind them are exactly what `clear` just removed.

It used to work the other way round: rebuild the file from defaults and copy a couple of fields back. That meant every new top-level key silently became something `clear` destroyed, which is how it quietly started wiping day records and favorites. Naming what changes rather than what survives makes the next key safe by default.

An empty log prints "no meals to clear" and stops, rather than also claiming it cleared something.

## The interactive menu

Running `macro-track` with no arguments opens an arrow-key menu — but only when stdin is a terminal. In a cron job, a script, or anything piped, it prints help instead. The menu reads keypresses, so without a terminal it would otherwise wait forever for input that never arrives.

Prompt sequences (add, edit, goals) run through clack's `group`, so Ctrl+C at any step ends the session through a single handler rather than each prompt checking for itself.

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
  "weights": [
    {
      "date": "2026-07-19",
      "weight": 182.4,
      "recordedAt": "2026-07-19T13:02:11.004Z"
    }
  ],
  "favorites": [
    {
      "name": "beef",
      "protein": 14,
      "carbs": 20,
      "fats": 6,
      "cals": 200,
      "createdAt": "2026-07-19T14:32:05.123Z"
    }
  ],
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

| File               | Responsibility                                                  |
| ------------------ | --------------------------------------------------------------- |
| `src/types.ts`     | `Macros`, `Meal`, `Goals`, `DayRecord`, `Favorite`, `MealsData` |
| `src/storage.ts`   | Reading and writing the JSON file                               |
| `src/date.ts`      | Local-day formatting (`toLocalDate`, `todayLocalDate`)          |
| `src/util.ts`      | `definedOnly`, the undefined-stripping both merges need         |
| `src/validate.ts`  | Macro-value rules, shared by the flags and the menu             |
| `src/meals.ts`     | Logging, reading, editing and deleting meals; `sumMacros`       |
| `src/favorites.ts` | Named saved meals and `repeat`                                  |
| `src/goals.ts`     | Daily targets                                                   |
| `src/days.ts`      | Goal direction, hit verdict, lazy close, history                |
| `src/weight.ts`    | Weigh-ins and the trailing average                              |
| `src/format.ts`    | Every line the tool prints                                      |
| `src/commands.ts`  | Re-export barrel over the four above                            |
| `src/menu.ts`      | The interactive menu shown when run with no arguments           |
| `src/index.ts`     | Command definitions, flag parsing, entry-point dispatch         |

Dependencies run one way: `format` and `days` sit on top of `meals`, `favorites` and `goals`, which sit on `storage`. Nothing imports the barrel except `index` and `menu` — new code is better off importing the specific module, since the import line then says which area it depends on.

`Macros` holds the four numeric fields; `Meal` intersects it with `id`, `title`, and `createdAt`, so meals, goals, and daily totals all share one definition.

## Scripts

```bash
npm start -- <command>   # run
npm run dev              # run with watch
npm run typecheck        # src + tests
npm run typecheck:src    # src only, what a build would check
npm test                 # vitest run
npm run format           # prettier --write .
npm run format:check     # prettier --check .
```

`typecheck` covers `tests/` as well as `src/`, via `tsconfig.test.json`. That matters more than it sounds: the base `tsconfig.json` only includes `src/**`, so before the split config existed, adding a field to a stored type left every stale test fixture silently uncompiled.

Formatting is Prettier defaults, no config. `.git-blame-ignore-revs` holds the bulk-reformat commit so `git blame` skips past it — locally that needs `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

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
- [x] `delete <id>` — remove a single meal, so a typo doesn't need `clear`
- [x] `edit <id>` — fix a meal's macros without deleting and re-adding
- [x] Favorites — named, saved meals logged with `repeat <name>`
- [x] Weight tracking — `weigh` and `weight`, with a trailing average
