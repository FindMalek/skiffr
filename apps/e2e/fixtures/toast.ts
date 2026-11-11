import type { BrowserContext, Page } from "@playwright/test"

interface CdpNode {
  nodeId: number
  localName?: string
  nodeValue?: string
  attributes?: string[]
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
  contentDocument?: CdpNode
}

export interface ToastSnapshot {
  title: string | null
  buttons: { action: string; nodeId: number }[]
}

/** The toast lives in a closed shadow root, so it is read through the devtools DOM, which pierces it. */
export class ToastDriver {
  private constructor(
    private readonly page: Page,
    private readonly cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>,
  ) {}

  static async attach(context: BrowserContext, page: Page): Promise<ToastDriver> {
    const cdp = await context.newCDPSession(page)
    await cdp.send("DOM.enable")
    return new ToastDriver(page, cdp)
  }

  async snapshot(): Promise<ToastSnapshot> {
    const { root } = (await this.cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: CdpNode }
    const found: ToastSnapshot = { title: null, buttons: [] }
    const walk = (node: CdpNode): void => {
      const attrs = new Map<string, string>()
      for (let i = 0; i + 1 < (node.attributes?.length ?? 0); i += 2) {
        attrs.set(node.attributes?.[i] as string, node.attributes?.[i + 1] as string)
      }
      const action = attrs.get("data-action")
      if (action) found.buttons.push({ action, nodeId: node.nodeId })
      if (node.localName === "p" && attrs.get("class") === "title") found.title = node.children?.[0]?.nodeValue ?? ""
      for (const child of [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
        ...(node.contentDocument ? [node.contentDocument] : []),
      ]) {
        walk(child)
      }
    }
    walk(root)
    return found
  }

  async waitFor(predicate: (snapshot: ToastSnapshot) => boolean, timeoutMs = 15_000): Promise<ToastSnapshot> {
    const deadline = Date.now() + timeoutMs
    let last = await this.snapshot()
    while (!predicate(last) && Date.now() < deadline) {
      await this.page.waitForTimeout(150)
      last = await this.snapshot()
    }
    if (!predicate(last)) throw new Error(`The toast never reached the expected state: ${JSON.stringify(last)}`)
    return last
  }

  /** Puts the keyboard focus on one of the toast's buttons, as tabbing to it would. */
  async focus(action: string): Promise<void> {
    const button = (await this.snapshot()).buttons.find((candidate) => candidate.action === action)
    if (!button) throw new Error(`The toast has no ${action} button`)
    await this.cdp.send("DOM.focus", { nodeId: button.nodeId })
  }

  /** The tag of the page's focused element: the toast's own host while it holds the focus, `body` when nothing does. */
  activeTag(): Promise<string> {
    return this.page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "none")
  }

  /** The reading direction the toast resolves to: its host is the only element the page's own direction can reach. */
  hostDirection(): Promise<string> {
    return this.page.evaluate(() => {
      const host = [...document.documentElement.children].find((el) => el.tagName.startsWith("X-"))
      return host ? getComputedStyle(host).direction : "none"
    })
  }

  /** A real mouse click on the button, so it is a trusted event like a person's. */
  async click(action: string): Promise<void> {
    const button = (await this.snapshot()).buttons.find((candidate) => candidate.action === action)
    if (!button) throw new Error(`The toast has no ${action} button`)
    const { model } = (await this.cdp.send("DOM.getBoxModel", { nodeId: button.nodeId })) as {
      model: { content: number[] }
    }
    const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content
    await this.page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2)
  }
}
