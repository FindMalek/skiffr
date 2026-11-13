"use client"

import { PROFILE_FIELDS_MAX } from "@skiffr/common/constants"
import { Button } from "@skiffr/ui/components/button"
import { Input } from "@skiffr/ui/components/input"
import { SegmentedControl, SegmentedControlItem } from "@skiffr/ui/components/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@skiffr/ui/components/select"
import { Textarea } from "@skiffr/ui/components/textarea"
import { PlusIcon, XIcon } from "lucide-react"
import { HELP } from "@/lib/profile-copy"
import { nextRowKey, OTHER_LINKS_MAX, type ProfileForm } from "@/lib/profile-form"
import { fieldId, ProfileField, ProfileGroup, TextField, useProfileForm } from "./profile-field"

const UNSET = "unset"

function ChoiceField<K extends "sponsorship" | "relocate">({
  name,
  label,
  help,
}: {
  name: K
  label: string
  help: string
}) {
  const { form, set } = useProfileForm()
  return (
    <ProfileField id={name} label={label} help={help} group>
      {({ id, labelledBy, ...aria }) => (
        <SegmentedControl
          id={id}
          aria-labelledby={labelledBy}
          {...aria}
          value={form[name] === "" ? UNSET : form[name]}
          onValueChange={(value) => set(name, (value === UNSET ? "" : value) as ProfileForm[K])}
        >
          <SegmentedControlItem value="yes" className="min-w-16 flex-1 sm:flex-none">
            Yes
          </SegmentedControlItem>
          <SegmentedControlItem value="no" className="min-w-16 flex-1 sm:flex-none">
            No
          </SegmentedControlItem>
          <SegmentedControlItem value={UNSET} className="flex-1 px-4 sm:flex-none">
            Not specified
          </SegmentedControlItem>
        </SegmentedControl>
      )}
    </ProfileField>
  )
}

function ListSelect<K extends "period" | "remote">({
  name,
  label,
  help,
  options,
  className,
}: {
  name: K
  label: string
  help: string
  options: readonly { value: ProfileForm[K]; label: string }[]
  className?: string
}) {
  const { form, set } = useProfileForm()
  const items = options.map((option) => ({ value: option.value === "" ? UNSET : option.value, label: option.label }))
  return (
    <ProfileField id={name} label={label} help={help} group className={className}>
      {({ id, labelledBy, ...aria }) => (
        <Select
          items={items}
          value={form[name] === "" ? UNSET : form[name]}
          onValueChange={(value) => set(name, (value === UNSET ? "" : value) as ProfileForm[K])}
        >
          <SelectTrigger id={id} aria-labelledby={labelledBy} {...aria} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </ProfileField>
  )
}

export function IdentityGroup() {
  return (
    <ProfileGroup
      title="Identity and contact"
      description="Your name and how employers reach you. Pronouns are never filled, so there is no field for them."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="firstName" label="First name" help={HELP.firstName} autoComplete="given-name" />
        <TextField name="lastName" label="Last name" help={HELP.lastName} autoComplete="family-name" />
      </div>
      <TextField
        name="email"
        label="Email"
        help={HELP.email}
        type="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
      />
      <TextField name="phone" label="Phone" help={HELP.phone} type="tel" autoComplete="tel" inputMode="tel" />
    </ProfileGroup>
  )
}

function OtherLinks() {
  const { form, set, errorFor } = useProfileForm()
  const { otherLinks } = form
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">Other links</legend>
      {otherLinks.length === 0 ? <p className="text-muted-foreground text-sm">No other links yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {otherLinks.map((row, index) => {
          const id = `other-${row.key}`
          const error = errorFor(id)
          return (
            <li key={row.key} className="flex flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <Input
                  id={fieldId(id)}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Other link ${index + 1}`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={
                    error ? `${fieldId(id)}-error ${fieldId("otherLinks")}-help` : `${fieldId("otherLinks")}-help`
                  }
                  placeholder="https://"
                  value={row.value}
                  onChange={(event) =>
                    set(
                      "otherLinks",
                      otherLinks.map((item) => (item.key === row.key ? { ...item, value: event.target.value } : item)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Remove other link ${index + 1}`}
                  onClick={() =>
                    set(
                      "otherLinks",
                      otherLinks.filter((item) => item.key !== row.key),
                    )
                  }
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              {error ? (
                <p id={`${fieldId(id)}-error`} className="text-destructive text-xs">
                  {error}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={otherLinks.length >= OTHER_LINKS_MAX}
        onClick={() => set("otherLinks", [...otherLinks, { key: nextRowKey(), value: "" }])}
      >
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Add link
      </Button>
      <p id={`${fieldId("otherLinks")}-help`} className="text-muted-foreground text-xs leading-normal">
        {HELP.otherLinks}
      </p>
    </fieldset>
  )
}

export function LinksGroup() {
  const link = { type: "url", inputMode: "url", spellCheck: false, placeholder: "https://" } as const
  return (
    <ProfileGroup title="Links" description="Full links, starting with https://. Each fills the matching field.">
      <TextField name="linkedin" label="LinkedIn" help={HELP.linkedin} autoComplete="off" {...link} />
      <TextField name="github" label="GitHub" help={HELP.github} autoComplete="off" {...link} />
      <TextField name="portfolio" label="Portfolio" help={HELP.portfolio} autoComplete="off" {...link} />
      <TextField name="website" label="Website" help={HELP.website} autoComplete="url" {...link} />
      <OtherLinks />
    </ProfileGroup>
  )
}

export function WorkAuthGroup() {
  return (
    <ProfileGroup
      title="Work authorization"
      description="Where you can work without a new visa. Applications ask this on almost every form, and skiffr never guesses it: an empty answer stays empty."
    >
      <TextField
        name="countries"
        label="Authorized countries"
        help={HELP.countries}
        autoComplete="off"
        placeholder="United States, Canada"
      />
      <ChoiceField name="sponsorship" label="Need visa sponsorship" help={HELP.sponsorship} />
      <TextField name="visaStatus" label="Visa status" help={HELP.visaStatus} autoComplete="off" />
    </ProfileGroup>
  )
}

const PERIODS = [
  { value: "", label: "Not specified" },
  { value: "hour", label: "Per hour" },
  { value: "month", label: "Per month" },
  { value: "year", label: "Per year" },
] as const

export function SalaryGroup() {
  const amount = { inputMode: "numeric", autoComplete: "off", placeholder: "0" } as const
  return (
    <ProfileGroup
      title="Salary"
      description="Your expected range, used for pay questions. What you earned before is never filled."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="currency"
          label="Currency"
          help={HELP.currency}
          autoComplete="off"
          maxLength={3}
          autoCapitalize="characters"
          placeholder="USD"
          spellCheck={false}
        />
        <ListSelect name="period" label="Period" help={HELP.period} options={PERIODS} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="salaryMin" label="Minimum" help={HELP.salaryMin} {...amount} />
        <TextField name="salaryMax" label="Maximum" help={HELP.salaryMax} {...amount} />
      </div>
    </ProfileGroup>
  )
}

const REMOTE = [
  { value: "", label: "Not specified" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
] as const

export function LocationGroup() {
  return (
    <ProfileGroup title="Location" description="Where you live now and how you want to work.">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="city" label="City" help={HELP.city} autoComplete="address-level2" />
        <TextField name="region" label="State or region" help={HELP.region} autoComplete="address-level1" />
        <TextField name="country" label="Country" help={HELP.country} autoComplete="country-name" />
        <TextField name="postalCode" label="Postal code" help={HELP.postalCode} autoComplete="postal-code" />
      </div>
      <ChoiceField name="relocate" label="Willing to relocate" help={HELP.relocate} />
      <ListSelect name="remote" label="Work setup" help={HELP.remote} options={REMOTE} />
    </ProfileGroup>
  )
}

export function ExtrasGroup() {
  const { form, set, errorFor } = useProfileForm()
  const { extras } = form
  return (
    <ProfileGroup
      title="Extra fields"
      description="Answers that are the same on every application. skiffr matches the label to the question on a form."
    >
      {extras.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No extra fields yet. Try "Notice period" or "Years of experience".
        </p>
      ) : null}
      <ul className="flex flex-col gap-5">
        {extras.map((row, index) => {
          const labelId = `extra-label-${row.key}`
          const valueId = `extra-value-${row.key}`
          const labelError = errorFor(labelId)
          const valueError = errorFor(valueId)
          const update = (patch: Partial<typeof row>) =>
            set(
              "extras",
              extras.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
            )
          return (
            <li key={row.key} className="flex flex-col gap-2 border p-3">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Input
                    id={fieldId(labelId)}
                    aria-label={`Extra field ${index + 1} label`}
                    aria-invalid={labelError ? true : undefined}
                    aria-describedby={labelError ? `${fieldId(labelId)}-error` : undefined}
                    autoComplete="off"
                    placeholder="Label, like Notice period"
                    value={row.label}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                  {labelError ? (
                    <p id={`${fieldId(labelId)}-error`} className="text-destructive text-xs">
                      {labelError}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Remove extra field ${index + 1}${row.label.trim() ? `, ${row.label.trim()}` : ""}`}
                  onClick={() =>
                    set(
                      "extras",
                      extras.filter((item) => item.key !== row.key),
                    )
                  }
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
              <Textarea
                id={fieldId(valueId)}
                aria-label={`Extra field ${index + 1} value`}
                aria-invalid={valueError ? true : undefined}
                aria-describedby={valueError ? `${fieldId(valueId)}-error` : undefined}
                autoComplete="off"
                rows={2}
                className="min-h-0"
                placeholder="Value"
                value={row.value}
                onChange={(event) => update({ value: event.target.value })}
              />
              {valueError ? (
                <p id={`${fieldId(valueId)}-error`} className="text-destructive text-xs">
                  {valueError}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={extras.length >= PROFILE_FIELDS_MAX}
          onClick={() => set("extras", [...extras, { key: nextRowKey(), label: "", value: "" }])}
        >
          <PlusIcon aria-hidden="true" data-icon="inline-start" />
          Add field
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums">
          {extras.length} of {PROFILE_FIELDS_MAX}
        </span>
      </div>
      <p className="text-muted-foreground text-xs leading-normal">{HELP.extras}</p>
    </ProfileGroup>
  )
}
