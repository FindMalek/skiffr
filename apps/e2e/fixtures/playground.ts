import { type Playground, startPlayground } from "../server/playground.ts"
import { test as base } from "./extension.ts"

export const test = base.extend<object, { playground: Playground }>({
  playground: [
    // biome-ignore lint/correctness/noEmptyPattern: playwright needs the destructured first argument
    async ({}, use) => {
      const playground = await startPlayground()
      await use(playground)
      await playground.stop()
    },
    { scope: "worker" },
  ],
})

export { expect } from "./extension.ts"
