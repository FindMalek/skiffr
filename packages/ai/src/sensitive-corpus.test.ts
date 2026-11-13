import { expect, test } from "bun:test"
import { embeddingArm, fakeEmbedder, floorArm, fullRegexArm, indexPrototypes } from "../eval/arms"
import { evaluate, falsePositiveRate, loadCorpus, precision, recall } from "../eval/metrics"
import { ORDINARY_PROTOTYPES, SENSITIVE_PROTOTYPES } from "../eval/prototypes"
import { isLearnableField as floorLearnable } from "./learnable"
import { isLearnableField as serverLearnable } from "./learnable-extended"

const corpus = await loadCorpus()
const floor = evaluate(corpus, await floorArm.classify(corpus))
const server = evaluate(corpus, await fullRegexArm.classify(corpus))

/** Thresholds sit a little under what the deterministic arms score today: a drop means a word list lost wording. */
test("the corpus is big enough and covers every language and category", () => {
  expect(corpus.length).toBeGreaterThanOrEqual(1500)
  expect(new Set(corpus.map((e) => e.lang)).size).toBe(16)
  expect(Object.keys(floor.byCategory).length).toBeGreaterThanOrEqual(19)
  expect(new Set(corpus.map((e) => e.id)).size).toBe(corpus.length)
})

test("the floor catches the main wording of the five listed languages, english almost always", () => {
  expect(recall(floor.byLang.en as never)).toBeGreaterThanOrEqual(0.9)
  expect(recall(floor.mainstream)).toBeGreaterThanOrEqual(0.77)
  for (const lang of ["fr", "de", "es", "ar"])
    expect(recall(floor.byLang[lang] as never), lang).toBeGreaterThanOrEqual(0.7)
  expect(precision(floor.overall)).toBeGreaterThanOrEqual(0.97)
})

test("the first pass languages (it, pt, nl, tr, pl) are covered by the floor and better by the server lists", () => {
  for (const lang of ["it", "pt", "nl", "tr", "pl"]) {
    expect(recall(floor.byLang[lang] as never), lang).toBeGreaterThanOrEqual(0.45)
    expect(recall(server.byLang[lang] as never), lang).toBeGreaterThanOrEqual(0.5)
  }
})

test("the server lists add to the floor and catch more of the listed languages", () => {
  expect(recall(server.mainstream)).toBeGreaterThanOrEqual(0.82)
  expect(recall(server.mainstream)).toBeGreaterThan(recall(floor.mainstream))
  for (const [index, entry] of corpus.entries()) {
    const kept = floorLearnable({ label: entry.label, type: "text" })
    if (!kept) expect(serverLearnable({ label: entry.label, type: "text" }), `${index} ${entry.label}`).toBe(false)
  }
})

test("no ordinary job question is blocked, in any of the 16 languages", () => {
  expect(floor.falsePositives.hard.map((e) => e.label)).toEqual([])
  expect(server.falsePositives.hard.map((e) => e.label)).toEqual([])
  expect(falsePositiveRate(floor.overall)).toBeLessThanOrEqual(0.02)
})

test("close wording that must stay fillable does", () => {
  for (const label of [
    "Certifications",
    "Agreed salary",
    "Do you have permission to work in the UK?",
    "Driver's license class",
    "Do you have a valid driver's license?",
    "Tem autorização para trabalhar em Portugal?",
    "Are you legally authorized to work in the United States?",
  ]) {
    expect(floorLearnable({ label, type: "text" }), label).toBe(true)
    expect(serverLearnable({ label, type: "text" }), label).toBe(true)
  }
  for (const label of [
    "Do we have permission to contact your references?",
    "Driver's license number",
    "Agree to the terms",
  ]) {
    expect(floorLearnable({ label, type: "text" }), label).toBe(false)
  }
})

test("spacing, zero width characters and look-alike letters do not hide a known word", () => {
  expect(recall(floor.bySet.obfuscated as never)).toBeGreaterThanOrEqual(0.85)
})

test("a label that carries an instruction is still judged by the question next to it", () => {
  const missed = floor.misses.filter((entry) => entry.set === "injection").map((entry) => entry.label)
  // only the zh and ru ones, which no word list covers: the model verdict is for those
  expect(missed.filter((label) => !/[\u4e00-\u9fff\u0400-\u04ff]/.test(label))).toEqual([])
})

test("a long label with a protected question inside is caught, an empty one is not trusted", () => {
  expect(recall(floor.bySet.long as never)).toBe(1)
  expect(recall(floor.bySet.empty as never)).toBe(1)
})

test("the prototype phrases of the embedding arm are not copied from the corpus", () => {
  const seen = new Set(corpus.map((entry) => entry.label.toLowerCase()))
  const all = [...Object.values(SENSITIVE_PROTOTYPES).flat(), ...ORDINARY_PROTOTYPES]
  expect(all.filter((phrase) => seen.has(phrase.toLowerCase()))).toEqual([])
})

test("the nearest prototype arm with a deterministic embedder stays above its floor", async () => {
  const arm = embeddingArm("fake", "none", fakeEmbedder, () =>
    indexPrototypes(fakeEmbedder, SENSITIVE_PROTOTYPES, ORDINARY_PROTOTYPES),
  )
  const report = evaluate(corpus, await arm.classify(corpus))
  expect(recall(report.overall)).toBeGreaterThanOrEqual(0.25)
  expect(falsePositiveRate(report.overall)).toBeLessThanOrEqual(0.05)
})
