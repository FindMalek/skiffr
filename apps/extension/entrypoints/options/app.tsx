import { type ExtensionSettings, extensionSettingsSchema } from "@skiffr/common"
import { type FormEvent, useEffect, useState } from "react"
import { DEFAULT_SETTINGS, getSettings, setSettings } from "@/lib/storage"

type Status = "idle" | "saved" | "invalid" | "error"

export function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<Status>("idle")

  useEffect(() => {
    getSettings()
      .then(setForm)
      .catch(() => setStatus("error"))
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
    try {
      setForm(await setSettings(form))
      setStatus("saved")
    } catch {
      setStatus("error")
    }
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
        {status === "invalid" && <p role="alert">Enter an http or https API url</p>}
        {status === "error" && <p role="alert">Could not reach extension storage</p>}
      </form>
      <p>
        Fill runs on <kbd>Ctrl+Shift+F</kbd> (<kbd>Cmd+Shift+F</kbd> on mac). Remap it at{" "}
        <code>chrome://extensions/shortcuts</code>.
      </p>
    </main>
  )
}
