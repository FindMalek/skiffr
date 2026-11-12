import { describe, expect, test } from "bun:test"
import { collectFields, fillCollected, readField } from "../fill"
import { toFillField } from "../fill-client"
import { adapterChoices, adapterFill, adapterFor, adapterKind, adapterLabel, adapterScope, adapterSkips } from "."
import { type Board, mountBoard } from "./test-pages"
import type { Adapter } from "./types"

const labels = (document: Document) => collectFields(document).map((field) => toFillField(field).label)
const find = (document: Document, label: RegExp) =>
  collectFields(document).find((field) => label.test(field.descriptor.label ?? ""))
const SOMEWHERE_ELSE = "https://careers.example.com/apply"

const PRIVATE = /gender|ethnic|veteran|disab|age range|current age|pronoun|diversity|survey/i
const BOARDS: Board[] = ["greenhouse", "lever", "ashby", "workable"]

describe("registry", () => {
  test("a page that is not a known board gets no adapter, and the private questions are still kept out", () => {
    for (const board of BOARDS) {
      const { document } = mountBoard(board, SOMEWHERE_ELSE)
      expect(adapterFor(document)).toBeNull()
      expect(labels(document).some((label) => PRIVATE.test(label ?? ""))).toBe(false)
    }
  })

  test("a board's own page gets the adapter of that board", () => {
    for (const board of BOARDS) expect(adapterFor(mountBoard(board).document)?.id).toBe(board)
  })

  test("every board's scope is its application form", () => {
    for (const board of BOARDS) {
      const { document } = mountBoard(board)
      const scope = adapterScope(adapterFor(document), document)
      expect(scope?.localName).toBe("form")
      expect(scope?.querySelector("input")).not.toBeNull()
    }
  })

  test("a hook that throws or answers nonsense is the same as no hook", async () => {
    const { document } = mountBoard("lever")
    const el = document.querySelector("input[name=name]") as HTMLElement
    const broken: Adapter = {
      id: "lever",
      skip: () => {
        throw new Error("boom")
      },
      fieldLabel: () => {
        throw new Error("boom")
      },
      fieldKind: () => "file" as never,
      fieldChoices: () => Array.from({ length: 80 }, () => document.body),
      fill: async () => {
        throw new Error("boom")
      },
    }
    expect(adapterSkips(broken, el)).toBe(false)
    expect(adapterLabel(broken, el)).toBeUndefined()
    expect(adapterKind(broken, el)).toBeUndefined()
    expect(adapterChoices(broken, el)).toEqual([])
    const field = find(document, /full name/i)
    expect(field && (await adapterFill(broken, field, "Ana"))).toBeUndefined()
  })

  test("a field private by its label is not read, wherever it sits on the page and on whatever host", () => {
    for (const url of [undefined, SOMEWHERE_ELSE]) {
      const { document } = mountBoard("ashby", url)
      document.querySelector("form")?.insertAdjacentHTML("beforeend", '<input aria-label="Veteran status">')
      expect(labels(document)).not.toContain("Veteran status")
    }
  })
})

describe("greenhouse", () => {
  test("the demographic section and the acknowledgement box are not read, the rest is", () => {
    const { document } = mountBoard("greenhouse")
    const seen = labels(document)
    expect(seen.filter((label) => PRIVATE.test(label ?? ""))).toEqual([])
    expect(seen.some((label) => /Acknowledge/.test(label ?? ""))).toBe(false)
    expect(seen).toContain("Location (City)")
    expect(seen).toContain("How did you initially hear about this job?")
    expect(labels(mountBoard("greenhouse", SOMEWHERE_ELSE).document)).toEqual(seen)
  })

  test("the city search that answers after the generic wait is waited for", async () => {
    const { document } = mountBoard("greenhouse")
    const field = find(document, /Location \(City\)/)
    expect(field).toBeDefined()
    const result = await fillCollected(field as NonNullable<typeof field>, "Lisbon")
    expect(result).toMatchObject({ status: "filled", value: "Lisbon, Portugal" })
  }, 15_000)
})

describe("lever", () => {
  test("location is its own question again, and the survey, pronouns and signature boxes are not read", () => {
    const { document } = mountBoard("lever")
    const seen = labels(document)
    expect(seen).toContain("Current location")
    expect(seen.filter((label) => PRIVATE.test(label ?? "") || /^(Name|Date)$/.test(label ?? ""))).toEqual([])
    const plain = labels(mountBoard("lever", SOMEWHERE_ELSE).document)
    expect(plain).toContain("Current location No location found. Try entering a different location Loading")
    expect(plain).not.toContain("Name")
  })

  test("the location is typed and a suggestion picked, because the page wipes what was only typed", async () => {
    const { document } = mountBoard("lever")
    const field = find(document, /current location/i)
    const result = await fillCollected(field as NonNullable<typeof field>, "Lisbon")
    expect(result).toMatchObject({ status: "filled", value: "Lisbon, Portugal" })
    expect((document.getElementById("selected-location") as HTMLInputElement).value).toContain("Lisbon, Portugal")
  }, 15_000)

  test("a place the list does not know leaves the field as the page leaves it: empty", async () => {
    const { document } = mountBoard("lever")
    const field = find(document, /current location/i)
    const result = await fillCollected(field as NonNullable<typeof field>, "Atlantis")
    expect(result.status).toBe("failed")
    expect((document.getElementById("location-input") as HTMLInputElement).value).toBe("")
  }, 15_000)
})

describe("ashby", () => {
  test("the location question is read by its title and Yes and No is a field with two options", () => {
    const { document } = mountBoard("ashby")
    const seen = collectFields(document)
    const place = seen.find((field) => /country do you intend/.test(field.descriptor.label ?? ""))
    expect(place?.kind).toBe("combobox")
    const sponsorship = seen.find((field) => /sponsorship/.test(field.descriptor.label ?? ""))
    expect(sponsorship).toMatchObject({ kind: "combobox", descriptor: { options: ["Yes", "No"] } })
    expect(seen.map((field) => field.descriptor.label).filter((label) => PRIVATE.test(label ?? ""))).toEqual([])
    expect(labels(mountBoard("ashby", SOMEWHERE_ELSE).document)).toContain("Please list your city and country.")
  })

  test("Yes and No is pressed, read back, and nothing else on the page changes", async () => {
    const { document } = mountBoard("ashby")
    const field = find(document, /sponsorship/) as NonNullable<ReturnType<typeof find>>
    expect(readField(field)).toBe("")
    const result = await fillCollected(field, "no")
    expect(result).toMatchObject({ status: "filled", value: "No" })
    expect(document.querySelectorAll("[aria-pressed=true]")).toHaveLength(1)
    expect(await fillCollected(field, "No")).toMatchObject({ status: "unchanged" })
    expect(labels(document)).toEqual(labels(mountBoard("ashby").document))
  })

  test("the location autocomplete is given time to answer and a suggestion is chosen", async () => {
    const { document } = mountBoard("ashby")
    const field = find(document, /country do you intend/) as NonNullable<ReturnType<typeof find>>
    const result = await fillCollected(field, "Lisbon, Portugal")
    expect(result).toMatchObject({ status: "filled", value: "Lisbon, Portugal" })
  }, 15_000)
})

describe("workable", () => {
  test("labels lose the optional note, the radio groups are fields, the survey and consent box are not read", () => {
    const { document } = mountBoard("workable")
    const seen = collectFields(document)
    const names = seen.map((field) => field.descriptor.label)
    expect(names).toContain("Summary")
    expect(names).not.toContain("Summary (Optional)")
    const eligible = seen.find((field) => /eligible to work/.test(field.descriptor.label ?? ""))
    expect(eligible).toMatchObject({ kind: "combobox", descriptor: { options: ["YES", "NO"] } })
    expect(names.filter((label) => PRIVATE.test(label ?? ""))).toEqual([])
    expect(names.some((label) => /agree to the processing/.test(label ?? ""))).toBe(false)
    expect(labels(mountBoard("workable", SOMEWHERE_ELSE).document)).toContain("Summary (Optional)")
  })

  test("the personal information section is read: name, email and the phone with its country picker", async () => {
    const { document } = mountBoard("workable")
    const seen = collectFields(document)
    const names = seen.map((field) => field.descriptor.label ?? "")
    for (const label of [/^First name$/, /^Last name$/, /^Email$/, /Phone$/])
      expect(names.some((n) => label.test(n))).toBe(true)
    const phone = seen.find((field) => field.el.id === "input_phone")
    expect(phone).toMatchObject({ kind: "text", descriptor: { type: "tel" }, info: { required: false } })
    expect(names.some((label) => /^Equal Employment|^Diversity|Please select one|^Gender|Veteran/.test(label))).toBe(
      false,
    )
  })

  test("a radio group is answered through its label, read back and left alone when it already matches", async () => {
    const { document } = mountBoard("workable")
    const field = find(document, /eligible to work/) as NonNullable<ReturnType<typeof find>>
    expect(readField(field)).toBe("")
    expect(await fillCollected(field, "Yes")).toMatchObject({ status: "filled", value: "YES" })
    expect(document.querySelectorAll("[role=radio][aria-checked=true]")).toHaveLength(1)
    expect(await fillCollected(field, "yes")).toMatchObject({ status: "unchanged" })
  })
})

describe("the form signature", () => {
  test("lookup and record see the same questions: a fill does not change a label", async () => {
    for (const board of BOARDS) {
      const { document } = mountBoard(board)
      const before = labels(document)
      for (const field of collectFields(document)) {
        if (field.kind === "combobox" && field.descriptor.options.length > 0) {
          await fillCollected(field, field.descriptor.options[0] as string)
        }
      }
      expect(labels(document)).toEqual(before)
    }
  }, 20_000)
})
