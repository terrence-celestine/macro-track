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

Log a meal. All four macro flags are currently required.

| Flag | Alias | Description |
| --- | --- | --- |
| `--protein <grams>` | `-p` | Protein in grams |
| `--carbs <grams>` | `-c` | Carbs in grams |
| `--fats <grams>` | `-f` | Fats in grams |
| `--cals <cals>` | — | Calories |

```bash
npm start -- add "ground beef" -p 14 -c 20 -f 6 --cals 200
```

`--cals` has no short alias. `-cals` is parsed as the short flag `-c` with the value `als`, which silently overwrites carbs — use two dashes.

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
      "createdAt": "2026-07-19T14:32:05.123Z"
    }
  ],
  "nextId": 2
}
```

`createdAt` is a UTC ISO timestamp.

## Stack

TypeScript, Node, [commander](https://github.com/tj/commander.js) for parsing, [chalk](https://github.com/chalk/chalk) for output, [tsx](https://github.com/privatenumber/tsx) for running TS directly.

## Roadmap

- [ ] `Macros` shared type across meals, goals, and daily totals
- [ ] `goal set` — daily macro targets, stored in the data file
- [ ] Day records — totals, goals snapshot, and a `hit` verdict frozen per day
- [ ] Lazy day close on the first command of a new day
- [ ] `today` — running totals against the day's goals
- [ ] Local-date field on meals so evening meals aren't filed under the next UTC day
