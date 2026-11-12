import { ORPCError } from "@orpc/server"
import { ADMIN_LIST_LIMIT } from "@skiffr/common/constants"
import { adminUserSchema, aiUsageSchema, meSchema, okSchema, profileInputSchema } from "@skiffr/common/schemas"
import { user } from "@skiffr/db"
import { count, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { aiUsageToday } from "../lib/ai-usage"
import { adminProcedure, protectedProcedure } from "../procedures"

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export const meRouter = {
  get: protectedProcedure
    .route({ method: "GET", path: "/me", summary: "The signed-in user", tags: ["account"] })
    .output(meSchema)
    .handler(({ context }) => ({
      id: context.user.id,
      name: context.user.name,
      email: context.user.email,
      image: context.user.image ?? null,
      role: context.user.role ?? null,
    })),

  usage: protectedProcedure
    .route({
      method: "GET",
      path: "/me/usage",
      summary: "Today's AI calls and tokens against the daily limits",
      tags: ["account"],
    })
    .output(aiUsageSchema)
    .handler(({ context }) => aiUsageToday(context)),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/me", summary: "Update your profile", tags: ["account"] })
    .input(profileInputSchema)
    .output(okSchema)
    .handler(async ({ context, input }) => {
      await context.db
        .update(user)
        .set({ name: input.name, updatedAt: context.now() })
        .where(eq(user.id, context.user.id))
      return { ok: true as const }
    }),

  avatar: protectedProcedure
    .route({ method: "POST", path: "/me/avatar", summary: "Upload a profile picture to S3", tags: ["account"] })
    .input(z.object({ file: z.instanceof(File) }))
    .output(z.object({ image: z.string() }))
    .handler(async ({ context, input }) => {
      if (!context.storage) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Storage isn't configured here." })
      const ext = IMAGE_TYPES[input.file.type]
      if (!ext) throw new ORPCError("UNSUPPORTED_MEDIA_TYPE", { message: "Use a JPEG, PNG or WebP image." })
      if (input.file.size > 4 * 1024 * 1024) throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "4 MB at most." })
      const key = `${context.storage.prefix}avatars/${context.user.id}-${Date.now()}.${ext}`
      await context.storage.put(key, await input.file.arrayBuffer(), input.file.type)
      const image = `/api/files/${key}`
      await context.db.update(user).set({ image, updatedAt: context.now() }).where(eq(user.id, context.user.id))
      return { image }
    }),
}

export const adminRouter = {
  users: adminProcedure
    .route({ method: "GET", path: "/admin/users", summary: "All users (admins only)", tags: ["admin"] })
    .output(
      z.object({
        total: z.number(),
        users: z.array(adminUserSchema),
      }),
    )
    .handler(async ({ context }) => {
      const [total] = await context.db.select({ n: count() }).from(user)
      const users = await context.db
        .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
        .from(user)
        .orderBy(desc(user.createdAt))
        .limit(ADMIN_LIST_LIMIT)
      return { total: total?.n ?? 0, users }
    }),
}
