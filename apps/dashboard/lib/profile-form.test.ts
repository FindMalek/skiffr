import { expect, test } from "bun:test"
import { profileDataSchema } from "@skiffr/common/schemas"
import {
  completeness,
  emptyForm,
  formToProfile,
  isDirty,
  type ProfileForm,
  profileToForm,
  validateProfileForm,
} from "./profile-form"

const form = (patch: Partial<ProfileForm> = {}): ProfileForm => ({ ...emptyForm(), ...patch })
const ids = (patch: Partial<ProfileForm>) => validateProfileForm(form(patch)).map((error) => error.id)

test("empty strings become unset keys, never an empty string", () => {
  const { data, fields } = formToProfile(
    form({ firstName: "  ", city: "", extras: [{ key: 1, label: "Notice", value: "" }] }),
  )
  expect(data.identity.firstName).toBeUndefined()
  expect(data.location.city).toBeUndefined()
  expect(data.salary.min).toBeUndefined()
  expect(fields).toEqual({})
  const stored = JSON.parse(JSON.stringify(profileDataSchema.parse(data)))
  expect(Object.values(stored.identity)).not.toContain("")
})

test("the api accepts what the form produces and the page loads it back unchanged", () => {
  const filled = form({
    firstName: " Ada ",
    email: "ada@example.com",
    linkedin: "https://www.linkedin.com/in/ada",
    otherLinks: [{ key: 1, value: "https://ada.dev" }],
    countries: "United Kingdom, , Canada, canada",
    sponsorship: "no",
    currency: "gbp",
    salaryMin: "90,000",
    salaryMax: "120000",
    period: "year",
    relocate: "yes",
    remote: "hybrid",
    extras: [{ key: 2, label: "Notice Period!", value: "4 weeks" }],
  })
  const saved = formToProfile(filled)
  expect(profileDataSchema.safeParse(saved.data).success).toBe(true)
  expect(saved.data.identity.firstName).toBe("Ada")
  expect(saved.data.workAuth).toEqual({
    authorizedCountries: ["United Kingdom", "Canada"],
    requiresSponsorship: false,
    visaStatus: undefined,
  })
  expect(saved.data.salary).toEqual({ currency: "GBP", min: 90000, max: 120000, period: "year" })
  expect(saved.fields).toEqual({ "notice period": "4 weeks" })
  expect(isDirty(filled, saved)).toBe(false)
  expect(isDirty({ ...filled, city: "Leeds" }, saved)).toBe(true)
  expect(profileToForm(saved).extras[0]?.label).toBe("notice period")
})

test("pronouns are carried over untouched because the page has no field for them and upsert replaces everything", () => {
  const base = profileDataSchema.parse({ identity: { pronouns: "she/her" } })
  expect(formToProfile(form({ firstName: "Ana" }), base).data.identity.pronouns).toBe("she/her")
})

test("urls, email, phone and money are checked and the errors come in page order", () => {
  expect(
    ids({
      email: "not-an-email",
      phone: "abc",
      linkedin: "linkedin.com/in/ada",
      github: "javascript:alert(1)",
      otherLinks: [{ key: 7, value: "ftp://x.dev" }],
      currency: "dollars",
      salaryMin: "-5",
      salaryMax: "1.5",
    }),
  ).toEqual(["email", "phone", "linkedin", "github", "other-7", "currency", "salaryMin", "salaryMax"])
  expect(ids({ salaryMin: "200", salaryMax: "100" })).toEqual(["salaryMax"])
  expect(ids({ phone: "+44 20 7946 0958", email: "a@b.co", website: "http://ada.dev", salaryMin: "0" })).toEqual([])
})

test("extra field labels need letters and must stay unique once normalized", () => {
  const extras = [
    { key: 1, label: "Notice period", value: "4 weeks" },
    { key: 2, label: "notice-PERIOD", value: "1 month" },
    { key: 3, label: "!!!", value: "x" },
    { key: 4, label: "", value: "orphan" },
    { key: 5, label: "Skills", value: "" },
    { key: 6, label: "", value: "" },
  ]
  expect(ids({ extras })).toEqual(["extra-label-2", "extra-label-3", "extra-label-4", "extra-value-5"])
})

test("the meter counts what the extension can fill and names what is missing", () => {
  const { filled, total, missing } = completeness(form({ firstName: "Ada", sponsorship: "no", countries: " , " }))
  expect(filled).toBe(2)
  expect(missing).toHaveLength(total - 2)
  expect(missing).toContain("Authorized countries")
  expect(missing).not.toContain("First name")
})

test("loaded rows get the same keys on every call, so server and browser markup match", () => {
  const saved = formToProfile(
    form({ otherLinks: [{ key: 9, value: "https://a.dev" }], extras: [{ key: 8, label: "Skills", value: "TS" }] }),
  )
  const [a, b] = [profileToForm(saved), profileToForm(saved)]
  expect([a.otherLinks[0]?.key, a.extras[0]?.key]).toEqual([b.otherLinks[0]?.key, b.extras[0]?.key])
})
