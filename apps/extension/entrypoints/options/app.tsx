import { type ExtensionSettings, extensionSettingsSchema } from "@skiffr/common"
import { TOKEN_PREFIX } from "@skiffr/common/constants"
import { type FormEvent, useEffect, useState } from "react"
import { browser } from "wxt/browser"
import { CONNECTION_TEXT, type ConnectionResult, type TestConnectionMessage } from "@/lib/connection"
import { DEFAULT_SETTINGS, getSettings, setSettings } from "@/lib/storage"

type Status = "idle" | "saved" | "invalid" | "bad-token" | "error"

export function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<Status>("idle")
  const [connection, setConnection] = useState<ConnectionResult | "testing" | null>(null)

  useEffect(() => {
    getSettings()
      .then(setForm)
      .catch(() => setStatus("error"))
  }, [])

  function update(field: keyof ExtensionSettings, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setStatus("idle")
    setConnection(null)
  }

  async function persist(): Promise<boolean> {
    const parsed = extensionSettingsSchema.safeParse(form)
    if (!parsed.success) {
      setStatus("invalid")
      return false
    }
    if (parsed.data.token && !parsed.data.token.startsWith(TOKEN_PREFIX)) {
      setStatus("bad-token")
      return false
    }
    try {
      setForm(await setSettings(form))
      setStatus("saved")
      return true
    } catch {
      setStatus("error")
      return false
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    await persist()
  }

  async function test() {
    if (!(await persist())) return
    setConnection("testing")
    const message: TestConnectionMessage = { type: "test-connection" }
    try {
      setConnection((await browser.runtime.sendMessage(message)) as ConnectionResult)
    } catch {
      setConnection({ ok: false, reason: "unreachable" })
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
        <p>
          Create a token in the Skiffr dashboard under <strong>Extension</strong>, then paste it here.
        </p>
        <fieldset>
          <button type="submit">Save</button>
          <button type="button" disabled={connection === "testing"} onClick={test}>
            Test connection
          </button>
        </fieldset>
        {status === "saved" && <p role="status">Saved</p>}
        {status === "invalid" && <p role="alert">Enter an https API url. Plain http only works for localhost.</p>}
        {status === "bad-token" && (
          <p role="alert">
            That is not a Skiffr token, it starts with {TOKEN_PREFIX}. Create one in the dashboard under Extension.
          </p>
        )}
        {connection === "testing" && <p role="status">Testing</p>}
        {typeof connection === "object" && connection?.ok && <p role="status">Connected as {connection.name}</p>}
        {typeof connection === "object" && connection && !connection.ok && (
          <p role="alert">{CONNECTION_TEXT[connection.reason]}</p>
        )}
        {status === "error" && <p role="alert">Could not reach extension storage</p>}
      </form>
      <p>
        Fill runs on <kbd>Ctrl+Shift+F</kbd> (<kbd>Cmd+Shift+F</kbd> on mac). Remap it at{" "}
        <code>chrome://extensions/shortcuts</code>.
      </p>
    </main>
  )
}
