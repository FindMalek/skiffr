import { expect, test } from "bun:test"
import { atsScore, jobKeywords } from "./ats"
import { buildSource, evaluatePatch, patched } from "./patch"
import { buildView, resumeTexts, visibleTexts } from "./resume"
import { sampleData } from "./test-support"

const POSTING = `We are hiring a backend engineer. You will build payment APIs in TypeScript, deploy with Docker on AWS and
run Kafka pipelines. Experience with Kubernetes and Terraform is a plus. TypeScript, Docker and Kafka are core to the team.`

test("the score is the share of the posting's keywords found in the resume, with both lists", () => {
  const ats = atsScore(["Built payment APIs in TypeScript. Deployed services with Docker."], POSTING)
  expect(ats.matched).toEqual(expect.arrayContaining(["typescript", "docker", "payment"]))
  expect(ats.missing).toEqual(expect.arrayContaining(["kubernetes", "terraform"]))
  expect(ats.matched.length + ats.missing.length).toBe(ats.total)
  expect(ats.score).toBe(Math.round((ats.matched.length / ats.total) * 100))
})

test("repeated words rank first, and the same posting always gives the same keywords", () => {
  const first = jobKeywords(POSTING)
  expect(first.slice(0, 3)).toEqual(["typescript", "docker", "kafka"])
  expect(jobKeywords(POSTING)).toEqual(first)
  expect(first).not.toContain("the")
  expect(first).not.toContain("experience")
})

test("a posting with no usable words scores 0 instead of dividing by zero", () => {
  expect(atsScore(["anything"], "the a an of")).toEqual({ score: 0, total: 0, matched: [], missing: [] })
})

test("a form of a word counts, a different word does not", () => {
  const ats = atsScore(["Deployed and monitored services"], "deploy monitoring kubernetes")
  expect(ats.matched.sort()).toEqual(["deploy", "monitoring"])
  expect(ats.missing).toEqual(["kubernetes"])
})

test("hidden sections and items do not count, so hiding something that matches lowers the score", () => {
  const data = sampleData()
  const view = buildView(data)
  const source = buildSource(resumeTexts(data))
  const before = atsScore(visibleTexts(data), POSTING)
  const evaluation = evaluatePatch({
    data,
    view,
    source,
    operations: [{ op: "replace", path: "/skills/1/hidden", value: true }],
  })
  const after = atsScore(visibleTexts(patched(data, evaluation.resumeOps)), POSTING)
  expect(after.score).toBeLessThan(before.score)
  expect(after.missing).toEqual(expect.arrayContaining(["aws"]))
})
