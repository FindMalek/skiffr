import { z } from "zod"
import { ANSWER_VALUE_MAX, LABEL_MAX, PROFILE_FIELDS_MAX, SHORT_TEXT_MAX } from "../constants"
import { httpUrlSchema } from "./url"

const text = z.string().trim().max(SHORT_TEXT_MAX)

export const profileDataSchema = z.object({
  identity: z
    .object({
      firstName: text.optional(),
      lastName: text.optional(),
      email: text.optional(),
      phone: text.optional(),
      pronouns: text.optional(),
    })
    .default({}),
  links: z
    .object({
      linkedin: httpUrlSchema.optional(),
      github: httpUrlSchema.optional(),
      portfolio: httpUrlSchema.optional(),
      website: httpUrlSchema.optional(),
      other: z.array(httpUrlSchema).max(10).default([]),
    })
    .default({ other: [] }),
  workAuth: z
    .object({
      authorizedCountries: z.array(text).max(50).default([]),
      requiresSponsorship: z.boolean().optional(),
      visaStatus: text.optional(),
    })
    .default({ authorizedCountries: [] }),
  salary: z
    .object({
      currency: z.string().trim().length(3).optional(),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
      period: z.enum(["hour", "month", "year"]).optional(),
    })
    .default({}),
  location: z
    .object({
      city: text.optional(),
      region: text.optional(),
      country: text.optional(),
      postalCode: text.optional(),
      willingToRelocate: z.boolean().optional(),
      remotePreference: z.enum(["remote", "hybrid", "onsite"]).optional(),
    })
    .default({}),
})

/** Normalized label → value, for form fields the typed data doesn't cover. */
export const profileFieldsSchema = z
  .record(z.string().max(LABEL_MAX), z.string().max(ANSWER_VALUE_MAX))
  .refine((fields) => Object.keys(fields).length <= PROFILE_FIELDS_MAX, {
    message: `At most ${PROFILE_FIELDS_MAX} extra fields.`,
  })

export const applicantProfileInputSchema = z.object({
  data: profileDataSchema.default(() => profileDataSchema.parse({})),
  fields: profileFieldsSchema.default({}),
})

export const applicantProfileSchema = z.object({
  id: z.string(),
  data: profileDataSchema,
  fields: profileFieldsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type ProfileData = z.infer<typeof profileDataSchema>
export type ProfileFields = z.infer<typeof profileFieldsSchema>
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>
