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
