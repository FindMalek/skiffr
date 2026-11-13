import { createApp, h, reactive, vModelCheckbox, vModelSelect, vModelText, withDirectives } from "vue"

const state = reactive({
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  why: "",
  source: "",
  race: "",
  privacy: false,
})

type TextKey = "first_name" | "last_name" | "email" | "phone" | "why"

const row = (label: string, id: string, control: ReturnType<typeof h>) =>
  h("div", { class: "row" }, [h("label", { for: id }, label), control])

function text(key: TextKey, label: string, type = "text", auto?: string) {
  const input = h("input", {
    id: key,
    name: key,
    type,
    autocomplete: auto,
    "onUpdate:modelValue": (value: string) => {
      state[key] = value
    },
  })
  return row(label, key, withDirectives(input, [[vModelText, state[key]]]))
}

function select(key: "source" | "race", label: string, options: string[]) {
  const control = h(
    "select",
    {
      id: key,
      name: key,
      "onUpdate:modelValue": (value: string) => {
        state[key] = value
      },
    },
    [h("option", { value: "" }, "Select..."), ...options.map((option) => h("option", { value: option }, option))],
  )
  return row(label, key, withDirectives(control, [[vModelSelect, state[key]]]))
}

const App = {
  render() {
    const consent = withDirectives(
      h("input", {
        type: "checkbox",
        name: "privacy",
        "onUpdate:modelValue": (value: boolean) => {
          state.privacy = value
        },
      }),
      [[vModelCheckbox, state.privacy]],
    )
    return h("form", { class: "vue-form", method: "post", action: "/api/submissions", novalidate: true }, [
      h("h2", "Apply"),
      text("first_name", "First name", "text", "given-name"),
      text("last_name", "Last name", "text", "family-name"),
      text("email", "Email", "email", "email"),
      text("phone", "Phone", "tel", "tel"),
      text("why", "Why do you want to work at Acme?"),
      select("source", "How did you hear about this job?", ["LinkedIn", "Referral", "Other"]),
      select("race", "Race / ethnicity (voluntary)", ["Asian", "White", "Decline to self-identify"]),
      h("label", { class: "check" }, [consent, " I agree to the Acme privacy policy"]),
      h("button", { type: "submit", class: "btn" }, "Submit application"),
    ])
  },
}

createApp(App).mount("#app")
