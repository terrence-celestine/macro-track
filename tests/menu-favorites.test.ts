import { describe, it, expect, vi } from "vitest"

vi.mock("@clack/prompts", async () => (await import("./helpers/menu.js")).clackMock)

import {
    useMenuSandbox, mocks, meal, queueSelect, queueText,
} from "./helpers/menu.js"

const { loadMenu, seed, readData } = useMenuSandbox()

describe("menu: repeat", () => {
    const fav = (name: string) => ({
        name,
        protein: 14,
        carbs: 20,
        fats: 6,
        cals: 200,
        createdAt: "2026-07-19T14:32:05.123Z",
    })

    it("says so when there are no favorites", async () => {
        queueSelect("repeat", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("No favorites yet"))
    })

    it("logs the chosen favorite", async () => {
        await seed({ favorites: [fav("beef")] })
        queueSelect("repeat", "beef", "exit")

        await (await loadMenu())()

        expect((await readData()).meals).toHaveLength(1)
        expect((await readData()).meals[0].title).toBe("beef")
    })

    it("offers every favorite", async () => {
        await seed({ favorites: [fav("beef"), fav("rice")] })
        queueSelect("repeat", "beef", "exit")

        await (await loadMenu())()

        const [opts] = mocks.select.mock.calls[1] as [{ options: { label: string }[] }]
        expect(opts.options.map(o => o.label)).toEqual(["beef", "rice"])
    })

    it("does not confirm — logging a favorite is not destructive", async () => {
        await seed({ favorites: [fav("beef")] })
        queueSelect("repeat", "beef", "exit")

        await (await loadMenu())()

        expect(mocks.confirm).not.toHaveBeenCalled()
    })
})

describe("menu: save favorite", () => {
    it("says so when today is empty", async () => {
        queueSelect("favorite", "exit")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("Nothing logged today"))
    })

    it("saves under the entered name", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({ meals: [meal({ id: 1, localDate: todayLocalDate() })], nextId: 2 })
        queueSelect("favorite", 1, "exit")
        queueText("beef")

        await (await loadMenu())()

        expect((await readData()).favorites[0]).toMatchObject({ name: "beef", protein: 14 })
    })

    it("falls back to the meal's title when left blank", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({ meals: [meal({ id: 1, title: "ground beef", localDate: todayLocalDate() })], nextId: 2 })
        queueSelect("favorite", 1, "exit")
        queueText("")

        await (await loadMenu())()

        expect((await readData()).favorites[0].name).toBe("ground beef")
    })

    it("pre-fills the name prompt with the meal's title", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({ meals: [meal({ id: 1, title: "ground beef", localDate: todayLocalDate() })], nextId: 2 })
        queueSelect("favorite", 1, "exit")
        queueText("")

        await (await loadMenu())()

        const [opts] = mocks.text.mock.calls[0] as [{ placeholder?: string }]
        expect(opts.placeholder).toBe("ground beef")
    })

    it("warns rather than overwriting on a duplicate name", async () => {
        const { todayLocalDate } = await import("../src/date.js")
        await seed({
            meals: [meal({ id: 1, localDate: todayLocalDate() })],
            nextId: 2,
            favorites: [{ name: "beef", protein: 1, carbs: 1, fats: 1, cals: 1, createdAt: "2026-07-19T00:00:00.000Z" }],
        })
        queueSelect("favorite", 1, "exit")
        queueText("beef")

        await (await loadMenu())()

        expect(mocks.logWarn).toHaveBeenCalledWith(expect.stringContaining("--as"))
        expect((await readData()).favorites).toHaveLength(1)
        expect((await readData()).favorites[0].protein).toBe(1)
    })
})
