import {
  createApp,
  type Directive,
  defineComponent,
  h,
  reactive,
  type VNode,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelText,
  withDirectives,
} from "vue"

type Form = {
  first: string
  email: string
  country: string
  auth: string
  skills: string[]
  agree: boolean
  summary: string
}

const App = defineComponent({
  setup() {
    const form = reactive<Form>({ first: "", email: "", country: "", auth: "", skills: [], agree: false, summary: "" })
    Object.assign(window, { __state: () => JSON.parse(JSON.stringify(form)), __submitted: false })

    const model = (
      tag: string,
      props: Record<string, unknown>,
      directive: Directive,
      key: keyof Form,
      children?: VNode[],
    ) =>
      withDirectives(h(tag, { ...props, "onUpdate:modelValue": (value: never) => (form[key] = value) }, children), [
        [directive, form[key]],
      ])
    const row = (id: string, text: string, control: VNode) => [h("label", { for: id }, text), control]

    return () =>
      h(
        "form",
        {
          onSubmit: (e: Event) => {
            e.preventDefault()
            Object.assign(window, { __submitted: true })
          },
        },
        [
          ...row("first", "First name", model("input", { id: "first" }, vModelText, "first")),
          ...row("email", "Email", model("input", { id: "email", type: "email" }, vModelText, "email")),
          ...row(
            "country",
            "Country",
            model("select", { id: "country" }, vModelSelect, "country", [
              h("option", { value: "" }, "Select a country"),
              h("option", { value: "DE" }, "Germany"),
              h("option", { value: "US" }, "United States of America"),
            ]),
          ),
          h("fieldset", [
            h("legend", "Willing to relocate?"),
            ...["Yes", "No"].map((label) =>
              h("label", [model("input", { type: "radio", name: "auth", value: label }, vModelRadio, "auth"), label]),
            ),
          ]),
          h("fieldset", [
            h("legend", "Skills"),
            ...["TypeScript", "Go", "Rust"].map((skill) =>
              h("label", [
                model("input", { type: "checkbox", name: "skills", value: skill }, vModelCheckbox, "skills"),
                skill,
              ]),
            ),
          ]),
          h("label", [model("input", { type: "checkbox" }, vModelCheckbox, "agree"), "I agree to the terms"]),
          ...row("summary", "Summary", model("textarea", { id: "summary" }, vModelText, "summary")),
          h("button", { type: "submit" }, "Submit"),
        ],
      )
  },
})

createApp(App).mount("#root")
