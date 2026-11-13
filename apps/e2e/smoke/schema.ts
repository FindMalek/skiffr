import { z } from "zod"
import { localRefusal, urlRefusal } from "../tools/snapshot/guard.ts"

export const ATS_NAMES = ["greenhouse", "lever", "ashby", "workable", "other"] as const

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const CLICK_REFUSED = /submit|send|pay|confirm|finish|xpath=|^\/\//i

const phrases = z.array(z.string().trim().min(1).max(100)).max(30).default([])

function publicUrl(allowLocal: boolean) {
  return z.string().superRefine((raw, ctx) => {
    const refusal = urlRefusal(raw) ?? (allowLocal ? null : localRefusal(new URL(raw).hostname))
    if (refusal) ctx.addIssue({ code: "custom", message: refusal })
  })
}

function targetSchema(allowLocal: boolean) {
  return z.strictObject({
    id: z.string().regex(ID, "use lowercase letters, digits and dashes"),
    ats: z.enum(ATS_NAMES),
    url: publicUrl(allowLocal),
    enabled: z.boolean().default(true),
    /** Opens the form behind an apply button. The only click the runner makes on the page. */
    click: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((selector) => !CLICK_REFUSED.test(selector), { message: "that selector could submit a form" })
      .optional(),
    checked: z.iso.date(),
    expect: z.strictObject({
      minFilled: z.number().int().min(0).max(200),
      /** Words each of which some detected field label must contain. */
      detect: phrases,
      /** Words that mark fields which must come out of the fill exactly as they went in. */
      untouched: phrases,
      toast: z.boolean().default(true),
    }),
  })
}

export type Target = z.output<ReturnType<typeof targetSchema>>

export function parseTargets(data: unknown, options: { allowLocal?: boolean } = {}): Target[] {
  const list = z
    .array(targetSchema(options.allowLocal ?? false))
    .max(50)
    .refine((targets) => new Set(targets.map((target) => target.id)).size === targets.length, {
      message: "target ids must be unique",
    })
  const parsed = list.safeParse(data)
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "targets"}: ${issue.message}`).join("; "),
    )
  }
  return parsed.data
}
