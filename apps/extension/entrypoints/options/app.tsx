import { type ExtensionSettings, extensionSettingsSchema } from "@skiffr/common"
import { type FormEvent, useEffect, useState } from "react"
import { DEFAULT_SETTINGS, getSettings, setSettings } from "@/lib/storage"

type Status = "idle" | "saved" | "invalid"

export function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<Status>("idle")

  useEffect(() => {
    getSettings().then(setForm)
  }, [])

  function update(field: keyof ExtensionSettings, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setStatus("idle")
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!extensionSettingsSchema.safeParse(form).success) {
      setStatus("invalid")
      return
    }
    setForm(await setSettings(form))
    setStatus("saved")
  }

  return (
    <main>
      <h1>Skiffr</h1>
      <form onSubmit={save}>
        <label>
          API url
          <input type="url" required value={form.apiUrl} onChange={(event) => update("apiUrl", event.target.value)} />
        </label>
        <label>
          Token
          <input
            type="password"
            autoComplete="off"
            value={form.token}
            onChange={(event) => update("token", event.target.value)}
          />
        </label>
        <button type="submit">Save</button>
        {status === "saved" && <p role="status">Saved</p>}
        {status === "invalid" && <p role="alert">Enter a valid API url</p>}
      </form>
    </main>
  )
}
