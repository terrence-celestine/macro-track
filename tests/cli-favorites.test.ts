import { describe, it, expect } from "vitest";

import { useCliSandbox, ADD_ARGS } from "./helpers/cli.js";

const { run, readData, backdateMeals } = useCliSandbox();

describe("repeat and favorites", () => {
  it("reports no favorites before any are saved", async () => {
    const { code, stdout } = await run("favorite", "list");

    expect(code).toBe(0);
    expect(stdout).toContain("No favorites yet");
  });

  it("saves a meal under its title by default", async () => {
    await run(...ADD_ARGS);

    const { code } = await run("favorite", "add", "1");

    expect(code).toBe(0);
    expect((await readData()).favorites[0].name).toBe("ground beef");
  });

  it("accepts a shorter name via --as", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");

    expect((await readData()).favorites[0]).toMatchObject({
      name: "beef",
      protein: 14,
      carbs: 20,
      fats: 6,
      cals: 200,
    });
  });

  it("logs a favorite by name", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");

    const { code, stdout } = await run("repeat", "beef");

    expect(code).toBe(0);
    expect(stdout).toContain("beef");
    expect((await readData()).meals).toHaveLength(2);
  });

  it("matches the name case-insensitively", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");

    expect((await run("repeat", "BEEF")).code).toBe(0);
  });

  it("exits non-zero for an unknown favorite", async () => {
    const { code, stderr } = await run("repeat", "nope");

    expect(code).not.toBe(0);
    expect(stderr).toContain("nope");
  });

  it("refuses a duplicate name", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");

    const { code, stderr } = await run("favorite", "add", "1", "--as", "beef");

    expect(code).not.toBe(0);
    expect(stderr).toContain("--as");
    expect((await readData()).favorites).toHaveLength(1);
  });

  it("exits non-zero saving an unknown meal id", async () => {
    expect((await run("favorite", "add", "99")).code).not.toBe(0);
  });

  it("removes a favorite", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");

    const { code } = await run("favorite", "remove", "beef");

    expect(code).toBe(0);
    expect((await readData()).favorites).toEqual([]);
  });

  it("exits non-zero removing an unknown favorite", async () => {
    expect((await run("favorite", "remove", "nope")).code).not.toBe(0);
  });

  it("keeps working after the source meal is deleted", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");
    await run("delete", "1");

    const { code } = await run("repeat", "beef");

    // The favourite is a snapshot, not a pointer at the meal.
    expect(code).toBe(0);
    expect((await readData()).meals[0]).toMatchObject({
      protein: 14,
      cals: 200,
    });
  });

  it("saves from a meal on a recorded day", async () => {
    await run(...ADD_ARGS);
    await backdateMeals("2020-01-01");
    await run("history"); // closes 2020-01-01

    const { code } = await run("favorite", "add", "1", "--as", "beef");

    expect(code).toBe(0);
    expect((await readData()).days[0].mealCount).toBe(1);
  });

  it("counts logged favorites in today's totals", async () => {
    await run(...ADD_ARGS);
    await run("favorite", "add", "1", "--as", "beef");
    await run("repeat", "beef");

    const { stdout } = await run("today");
    expect(stdout).toContain("2 meals");
    expect(stdout).toContain("400");
  });
});
