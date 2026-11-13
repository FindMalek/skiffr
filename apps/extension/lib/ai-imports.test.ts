import { expect, test } from "bun:test"
import { Glob } from "bun"

test("the extension imports @skiffr/ai only through ./learnable, never its root", async () => {
  const root = new URL("..", import.meta.url).pathname
  const offenders: string[] = []
  for (const pattern of ["lib/**/*.{ts,tsx}", "entrypoints/**/*.{ts,tsx}"]) {
    for await (const file of new Glob(pattern).scan({ cwd: root })) {
      const source = await Bun.file(`${root}${file}`).text()
      if (/from\s+["']@skiffr\/ai["']|import\(\s*["']@skiffr\/ai["']\s*\)/.test(source)) offenders.push(file)
    }
  }
  expect(offenders).toEqual([])
})

test("the extension never imports the server word lists, so they stay out of the bundle", async () => {
  const root = new URL("..", import.meta.url).pathname
  const offenders: string[] = []
  for (const pattern of ["lib/**/*.{ts,tsx}", "entrypoints/**/*.{ts,tsx}"]) {
    for await (const file of new Glob(pattern).scan({ cwd: root })) {
      if (file.endsWith(".test.ts")) continue
      const source = await Bun.file(`${root}${file}`).text()
      if (/learnable-extended|ai\/src\/index|sensitive-verdicts/.test(source)) offenders.push(file)
    }
  }
  expect(offenders).toEqual([])
})
