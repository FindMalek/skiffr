import { useState } from "react"
import { createRoot } from "react-dom/client"

type Form = {
  first: string
  email: string
  phone: string
  country: string
  auth: string
  skills: string[]
  agree: boolean
  summary: string
  dept: string
}

const DEPARTMENTS = ["Engineering", "Design", "Sales"]
const digits = (text: string) => text.replace(/\D/g, "").slice(0, 10)
const mask = (text: string) => {
  const d = digits(text)
  return d.length > 6 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d
}

function App() {
  const [form, setForm] = useState<Form>({
    first: "",
    email: "",
    phone: "",
    country: "",
    auth: "",
    skills: [],
    agree: false,
    summary: "",
    dept: "",
  })
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<Form>) => setForm((prev) => ({ ...prev, ...patch }))
  Object.assign(window, { __state: () => form, __submitted: false })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        Object.assign(window, { __submitted: true })
      }}
    >
      <label htmlFor="first">First name</label>
      <input id="first" value={form.first} onChange={(e) => set({ first: e.target.value })} />

      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value.trim() })} />

      <label htmlFor="phone">Phone</label>
      <input id="phone" type="tel" value={form.phone} onChange={(e) => set({ phone: mask(e.target.value) })} />

      <label htmlFor="country">Country</label>
      <select id="country" value={form.country} onChange={(e) => set({ country: e.target.value })}>
        <option value="">Select a country</option>
        <option value="DE">Germany</option>
        <option value="US">United States of America</option>
      </select>

      <fieldset>
        <legend>Are you authorized to work here?</legend>
        {["Yes", "No"].map((label) => (
          <label key={label}>
            <input
              type="radio"
              name="auth"
              value={label}
              checked={form.auth === label}
              onChange={() => set({ auth: label })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Skills</legend>
        {["TypeScript", "Go", "Rust"].map((skill) => (
          <label key={skill}>
            <input
              type="checkbox"
              name="skills"
              value={skill}
              checked={form.skills.includes(skill)}
              onChange={(e) =>
                set({ skills: e.target.checked ? [...form.skills, skill] : form.skills.filter((s) => s !== skill) })
              }
            />
            {skill}
          </label>
        ))}
      </fieldset>

      <label>
        <input type="checkbox" checked={form.agree} onChange={(e) => set({ agree: e.target.checked })} />I agree to the
        terms
      </label>

      <label htmlFor="summary">Summary</label>
      <textarea id="summary" value={form.summary} onChange={(e) => set({ summary: e.target.value })} />

      <label htmlFor="dept">Department</label>
      <div>
        <input
          id="dept"
          role="combobox"
          aria-expanded={open}
          aria-controls="dept-list"
          aria-autocomplete="list"
          autoComplete="off"
          value={form.dept}
          onMouseDown={() => setOpen(true)}
          onChange={(e) => {
            set({ dept: e.target.value })
            setOpen(true)
          }}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
        {open && (
          <div id="dept-list" role="listbox">
            {DEPARTMENTS.filter((d) => d.toLowerCase().includes(form.dept.toLowerCase())).map((d) => (
              <div
                key={d}
                role="option"
                tabIndex={-1}
                aria-selected={form.dept === d}
                onClick={() => {
                  set({ dept: d })
                  setOpen(false)
                }}
                onKeyDown={(e) => e.key === "Enter" && set({ dept: d })}
              >
                {d}
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="submit">Submit</button>
    </form>
  )
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />)
