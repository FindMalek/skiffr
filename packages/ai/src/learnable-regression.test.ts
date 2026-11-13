import { expect, test } from "bun:test"
import { isDemographicOptions, isLearnableField, isSensitiveQuestion, isSensitiveSection } from "./learnable-extended"
import entries from "./learnable-main-entries.json"

/**
 * `learnable-main-entries.json` is every entry of the word lists as they stood on main after the wording coverage work
 * (folded, one entry per item). Splitting the lists into a floor and server lists must not make any of them readable on
 * the server guard. The stem `agree` is replayed too: the whole word rule keeps it blocked, except where it is followed
 * by what was agreed ("Agreed salary").
 */
const kept = (list: string[]) => list

const CONSENT_LABELS = [
  "Agree (required)",
  "Agree & proceed",
  "Agree and submit",
  "Agree and apply",
  "Agree and accept",
  "Yes agree",
  "We agree",
  "Please agree",
  "Tick to agree",
  "Check to agree",
  "Agree/Disagree",
  "Agree here",
  "Agree below",
  "Agrees",
]

const ZERO_WIDTH = "​"
const spellings = (text: string): string[] => [
  text,
  text.toUpperCase(),
  `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}?`,
  text.replaceAll(" ", " "),
  text.replaceAll(" ", "_"),
  [...text].join(ZERO_WIDTH),
]
const TYPES = ["text", "checkbox", "select", "textarea"]

function readable(label: string): string | null {
  for (const type of TYPES) {
    if (isLearnableField({ label, type }) && !isSensitiveQuestion({ label })) return `${type}: ${label}`
  }
  return null
}

test("every phrase of main's lists is still blocked on the server guard, in six spellings and four control types", () => {
  const lost = kept(entries.phrases).flatMap((entry) =>
    spellings(entry)
      .concat(`Please tell us your ${entry} here`, `${entry} (optional)`, `Section: ${entry}`)
      .map(readable)
      .filter(Boolean),
  )
  expect(lost).toEqual([])
})

test("every stem, inside stem and arabic word of main's lists is still blocked", () => {
  const lost = [
    ...kept(entries.stems).flatMap((entry) => spellings(`${entry}ing`).map(readable)),
    ...entries.inside.flatMap((entry) => spellings(`x${entry}x`).map(readable)),
    ...entries.arabic.flatMap((entry) => [entry, `ال${entry}`, `${entry} الشخصي`].map(readable)),
  ].filter(Boolean)
  expect(lost).toEqual([])
})

test("every bare label and squashed compound of main's lists is still blocked", () => {
  const lost = [
    ...entries.bareLabels.flatMap((entry) => [entry, `${entry} *`, `Details: ${entry}`].map(readable)),
    ...entries.barePrivate.flatMap((entry) => [entry, `${entry} *`, `Details: ${entry}`].map(readable)),
    ...entries.bareEdge.flatMap((entry) => [entry, `Your ${entry}`, `${entry} (years)`].map(readable)),
    ...entries.squashed.flatMap((entry) => [entry, [...entry].join(" "), entry.toUpperCase()].map(readable)),
    ...entries.squashStems.flatMap((entry) => [entry, [...entry].join(" ")].map(readable)),
  ].filter(Boolean)
  expect(lost).toEqual([])
})

test("every section heading and answer of main's lists still gives the question away", () => {
  expect(entries.sectionStems.filter((entry) => !isSensitiveSection(entry))).toEqual([])
  expect(entries.sectionStems.filter((entry) => !isSensitiveSection(`${entry.toUpperCase()} questions`))).toEqual([])
  expect(entries.options.filter((entry) => !isDemographicOptions([entry, "Yes", "No"]))).toEqual([])
  expect(entries.options.filter((entry) => !isDemographicOptions([entry.toUpperCase()]))).toEqual([])
})

test("a bare consent is blocked in every spelling, an ordinary question that starts with the word is not", () => {
  const consents = [
    "Agree",
    "Agreed",
    "Agree *",
    "Agree and continue",
    "I do agree",
    "AGREE",
    "I agree",
    "Do you agree?",
    ...CONSENT_LABELS,
  ]
  expect(
    consents
      .flatMap((label) => spellings(label))
      .map(readable)
      .filter(Boolean),
  ).toEqual([])
  for (const label of ["Agreed salary", "Agreed rate", "Agreed start date", "Agreed upon compensation"]) {
    expect(readable(label), label).not.toBeNull()
  }
})
