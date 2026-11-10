import { useState } from "react"
import { createRoot } from "react-dom/client"
import Select from "react-select"

type Option = { value: string; label: string }

const GENDER: Option[] = ["Male", "Female", "Non-binary", "Decline to self-identify"].map((v) => ({
  value: v,
  label: v,
}))
const COUNTRY: Option[] = ["Canada", "Germany", "United States", "United Kingdom"].map((v) => ({ value: v, label: v }))
const YES_NO: Option[] = ["Yes", "No"].map((v) => ({ value: v, label: v }))

function Field(props: {
  id: string
  label: string
  options: Option[]
  searchable?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label id={`${props.id}-label`} htmlFor={props.id}>
        {props.label}
      </label>
      <div>
        <Select
          inputId={props.id}
          classNamePrefix="select"
          options={props.options}
          placeholder="Select..."
          isSearchable={props.searchable !== false}
          onChange={(option) => props.onChange((option as Option | null)?.value ?? "")}
        />
      </div>
    </div>
  )
}

function App() {
  const [state, setState] = useState({ gender: "", country: "", authorized: "" })
  Object.assign(window, { __state: () => state, __submitted: false })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        Object.assign(window, { __submitted: true })
      }}
    >
      <p>Unrelated list</p>
      <div role="listbox" aria-label="Recent searches">
        <div role="option" tabIndex={-1} aria-selected="false">
          United States
        </div>
      </div>
      <Field id="gender" label="Gender" options={GENDER} onChange={(gender) => setState((s) => ({ ...s, gender }))} />
      <Field
        id="country"
        label="Country"
        options={COUNTRY}
        onChange={(country) => setState((s) => ({ ...s, country }))}
      />
      <Field
        id="authorized"
        label="Are you legally authorized to work in the United States?"
        options={YES_NO}
        searchable={false}
        onChange={(authorized) => setState((s) => ({ ...s, authorized }))}
      />
      <button type="submit">Submit</button>
    </form>
  )
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />)
