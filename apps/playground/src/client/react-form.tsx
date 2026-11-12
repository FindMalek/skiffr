import { type ChangeEvent, useState } from "react"
import { createRoot } from "react-dom/client"

interface Values {
  first_name: string
  last_name: string
  email: string
  phone: string
  linkedin: string
  why: string
  source: string
  gender: string
  privacy: boolean
}

const EMPTY: Values = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  linkedin: "",
  why: "",
  source: "",
  gender: "",
  privacy: false,
}

function Form() {
  const [values, setValues] = useState<Values>(EMPTY)
  const set =
    (key: keyof Values) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const target = event.target
      setValues((current) => ({
        ...current,
        [key]: target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value,
      }))
    }
  const text = (key: keyof Values, label: string, extra: { required?: boolean; type?: string; auto?: string } = {}) => (
    <div className="row">
      <label htmlFor={key}>
        {label}
        {extra.required ? <span className="req"> *</span> : null}
      </label>
      <input
        id={key}
        name={key}
        type={extra.type ?? "text"}
        autoComplete={extra.auto}
        required={extra.required}
        value={values[key] as string}
        onChange={set(key)}
      />
    </div>
  )
  return (
    <form method="post" action="/api/submissions" className="react-form" noValidate>
      <h2>Apply</h2>
      {text("first_name", "First name", { required: true, auto: "given-name" })}
      {text("last_name", "Last name", { required: true, auto: "family-name" })}
      {text("email", "Email", { required: true, type: "email", auto: "email" })}
      {text("phone", "Phone", { type: "tel", auto: "tel" })}
      {text("linkedin", "LinkedIn profile")}
      <div className="row">
        <label htmlFor="why">Why do you want to work at Acme?</label>
        <textarea id="why" name="why" rows={4} value={values.why} onChange={set("why")} />
        <small>{values.why.length} characters</small>
      </div>
      <div className="row">
        <label htmlFor="source">How did you hear about this job?</label>
        <select id="source" name="source" value={values.source} onChange={set("source")}>
          <option value="">Select...</option>
          <option value="LinkedIn">LinkedIn</option>
          <option value="Referral">Referral</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div className="row">
        <label htmlFor="gender">Gender (voluntary)</label>
        <select id="gender" name="gender" value={values.gender} onChange={set("gender")}>
          <option value="">Select...</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Decline to self-identify">Decline to self-identify</option>
        </select>
      </div>
      <label className="check">
        <input type="checkbox" name="privacy" checked={values.privacy} onChange={set("privacy")} /> I agree to the Acme
        privacy policy
      </label>
      <button type="submit" className="btn">
        Submit application
      </button>
    </form>
  )
}

// a real app hydrates late: nothing is on the page until this timer fires
setTimeout(() => {
  const host = document.getElementById("root")
  if (host) createRoot(host).render(<Form />)
}, 300)
