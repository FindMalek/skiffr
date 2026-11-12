export interface PatchOp {
  op: "replace" | "move"
  path: string
  from?: string
  value?: unknown
}

type Json = Record<string, unknown> | unknown[]

const UNSAFE = new Set(["__proto__", "prototype", "constructor"])

function parts(pointer: string): string[] {
  if (!pointer.startsWith("/")) throw new Error("pointer")
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
}

function parentOf(doc: Json, pointer: string): { parent: Json; key: string } {
  const keys = parts(pointer)
  const key = keys.pop() as string
  let parent: unknown = doc
  for (const step of keys) {
    if (UNSAFE.has(step) || typeof parent !== "object" || parent === null || !Object.hasOwn(parent, step))
      throw new Error("pointer")
    parent = (parent as Record<string, unknown>)[step]
  }
  if (UNSAFE.has(key) || typeof parent !== "object" || parent === null) throw new Error("pointer")
  return { parent: parent as Json, key }
}

function index(key: string, max: number): number {
  const at = Number(key)
  if (!/^(?:0|[1-9]\d*)$/.test(key) || at > max) throw new Error("index")
  return at
}

/**
 * RFC 6902 `replace` and `move`, the only two operations a tailoring patch may use, on a copy of the document. A path
 * that does not exist is an error, not a creation, so a patch can change what is there and nothing else.
 */
export function applyOps<T extends Json>(doc: T, ops: readonly PatchOp[]): T {
  const out = structuredClone(doc)
  for (const op of ops) {
    if (op.op === "replace") {
      const { parent, key } = parentOf(out, op.path)
      if (Array.isArray(parent)) parent[index(key, parent.length - 1)] = structuredClone(op.value)
      else if (Object.hasOwn(parent, key)) parent[key] = structuredClone(op.value)
      else throw new Error("missing")
    } else {
      if (op.from === undefined) throw new Error("from")
      const source = parentOf(out, op.from)
      const target = parentOf(out, op.path)
      if (!Array.isArray(source.parent) || source.parent !== target.parent) throw new Error("move")
      const from = index(source.key, source.parent.length - 1)
      const to = index(target.key, source.parent.length - 1)
      const [moved] = source.parent.splice(from, 1)
      source.parent.splice(to, 0, moved)
    }
  }
  return out
}
