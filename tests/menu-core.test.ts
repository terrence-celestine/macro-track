import { describe, it, expect, vi } from "vitest";
import { existsSync } from "fs";

vi.mock(
  "@clack/prompts",
  async () => (await import("./helpers/menu.js")).clackMock,
);

import {
  useMenuSandbox,
  mocks,
  queueSelect,
  queueText,
  CANCEL,
  ProcessExit,
} from "./helpers/menu.js";

const { loadMenu, dataFile, getExitSpy } = useMenuSandbox();

describe("menu dispatch", () => {
  it("exits without touching the data file", async () => {
    queueSelect("exit");

    await (
      await loadMenu()
    )();

    expect(existsSync(dataFile())).toBe(false);
  });

  it("shows the banner once and the outro once", async () => {
    queueSelect("list", "list", "exit");

    await (
      await loadMenu()
    )();

    // Regression: recursing into runMenu reprinted the intro on the way in
    // and stacked an outro per level on the way out.
    expect(mocks.intro).toHaveBeenCalledTimes(1);
    expect(mocks.outro).toHaveBeenCalledTimes(1);
  });

  it("returns to the menu after an action", async () => {
    queueSelect("list", "list", "list", "exit");

    await (
      await loadMenu()
    )();

    expect(mocks.select).toHaveBeenCalledTimes(4);
  });
});

describe("menu: cancellation", () => {
  it("exits zero when cancelled at the main menu", async () => {
    queueSelect(CANCEL);

    await expect((await loadMenu())()).rejects.toThrow(ProcessExit);
    expect(getExitSpy()).toHaveBeenCalledWith(0);
  });

  it("says it cancelled", async () => {
    queueSelect(CANCEL);

    await expect((await loadMenu())()).rejects.toThrow(ProcessExit);
    expect(mocks.cancel).toHaveBeenCalled();
  });

  it("writes nothing when cancelled partway through an add", async () => {
    queueSelect("add");
    queueText("ground beef", "14", CANCEL);

    await expect((await loadMenu())()).rejects.toThrow(ProcessExit);

    // A half-entered meal must not reach disk.
    expect(existsSync(dataFile())).toBe(false);
  });

  it("stops prompting once cancelled", async () => {
    queueSelect("add");
    queueText("ground beef", CANCEL);

    await expect((await loadMenu())()).rejects.toThrow(ProcessExit);

    // Title + protein, then it bails — carbs/fats/calories never asked.
    expect(mocks.text).toHaveBeenCalledTimes(2);
  });
});
