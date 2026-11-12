// Behaviour the real boards get from React and their widget libraries, in plain DOM.
;(() => {
  const bound = []
  const state = Object.create(null)

  // React keeps its own copy of an input's value on the instance. A write through the instance setter updates that
  // copy, so the next input event looks like no change. Only a write through the prototype setter reads as typing.
  function track(node, onChange) {
    const proto = Object.getPrototypeOf(node)
    const native = Object.getOwnPropertyDescriptor(proto, "value")
    let seen = String(native.get.call(node))
    Object.defineProperty(node, "value", {
      configurable: true,
      get() {
        return native.get.call(this)
      },
      set(next) {
        seen = String(next)
        native.set.call(this, next)
      },
    })
    node.addEventListener("input", () => {
      const now = String(native.get.call(node))
      if (now === seen) return
      seen = now
      onChange(now)
    })
  }

  function render() {
    for (const { node, key } of bound) {
      const want = state[key] ?? ""
      if (node.value !== want) node.value = want
    }
    window.dispatchEvent(new CustomEvent("fixture-render"))
  }

  function bind(node, key) {
    key = key || node.name || node.id
    state[key] = node.value
    bound.push({ node, key })
    track(node, (value) => {
      state[key] = value
      render()
    })
    return node
  }

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue
      if (k === "text") el.textContent = v
      else el.setAttribute(k, v === true ? "" : v)
    }
    for (const kid of kids) el.append(kid)
    return el
  }

  const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

  // react-select v5 markup and behaviour: opens on mousedown, picks on click, filters as you type, clears on blur
  function reactSelect(host, cfg) {
    const id = cfg.id
    const listId = `react-select-${id}-listbox`
    let open = false
    let query = ""
    let picked = ""
    let loading = false
    let results = cfg.options.slice()
    let timer

    const input = h("input", {
      class: "select__input",
      id,
      type: "text",
      autocapitalize: "none",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
      tabindex: "0",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-haspopup": "true",
      "aria-invalid": "false",
      "aria-required": cfg.required ? "true" : "false",
      "aria-labelledby": `${id}-label`,
      "aria-activedescendant": "",
      "aria-describedby": `react-select-${id}-placeholder`,
      enterkeyhint: "done",
      value: "",
    })
    const placeholder = h("div", { class: "select__placeholder", id: `react-select-${id}-placeholder`, text: cfg.placeholder ?? "Select..." })
    const inputContainer = h("div", { class: "select__input-container", "data-value": "" }, input)
    const valueContainer = h("div", { class: "select__value-container" }, placeholder, inputContainer)
    const control = h(
      "div",
      { class: "select__control" },
      valueContainer,
      h("div", { class: "select__indicators" }, h("button", { type: "button", class: "icon-button icon-button--sm", "aria-label": "Toggle flyout", tabindex: "-1", text: "▾" })),
    )
    const required = h("input", { required: cfg.required, tabindex: "-1", "aria-hidden": "true", class: "requiredInput", value: "" })
    const shell = h(
      "div",
      { class: "select-shell" },
      h("span", { id: `react-select-${id}-live-region`, class: "a11yText" }),
      h("span", { "aria-live": "polite", "aria-atomic": "false", "aria-relevant": "additions text", role: "log", class: "a11yText" }),
      h("div", {}, control),
      required,
    )
    host.append(shell)
    const wrap = control.parentElement

    function visible() {
      const q = fold(query)
      return cfg.remote ? results : results.filter((o) => fold(o).includes(q))
    }

    function paint() {
      wrap.querySelector(".select__menu")?.remove()
      input.setAttribute("aria-expanded", String(open))
      if (open) input.setAttribute("aria-controls", listId)
      else input.removeAttribute("aria-controls")
      placeholder.hidden = Boolean(picked) || query !== ""
      for (const old of valueContainer.querySelectorAll(".select__single-value")) old.remove()
      if (picked && !query) valueContainer.insertBefore(h("div", { class: "select__single-value", text: picked }), inputContainer)
      inputContainer.dataset.value = query
      if (!open) return
      const menu = h("div", { class: "select__menu" })
      const list = h("div", { class: "select__menu-list", role: "listbox", id: listId, "aria-multiselectable": "false" })
      const shown = loading ? [] : visible()
      shown.forEach((text, i) =>
        list.append(h("div", { class: "select__option", role: "option", id: `react-select-${id}-option-${i}`, "aria-selected": String(text === picked), text })),
      )
      if (loading) list.append(h("div", { class: "select__menu-notice select__menu-notice--loading", text: "Loading..." }))
      else if (shown.length === 0) list.append(h("div", { class: "select__menu-notice select__menu-notice--no-options", text: "No options" }))
      menu.append(list)
      list.addEventListener("click", (event) => {
        const option = event.target.closest(".select__option")
        if (option) choose(option.textContent)
      })
      wrap.append(menu)
    }

    function choose(text) {
      picked = text
      query = ""
      open = false
      input.value = ""
      required.value = text
      state[`select:${id}`] = text
      cfg.onChange?.(text)
      paint()
      render()
    }

    function search() {
      if (!cfg.remote) return
      clearTimeout(timer)
      loading = query !== ""
      results = []
      timer = setTimeout(() => {
        loading = false
        const q = fold(query)
        results = cfg.remote.filter((o) => fold(o).includes(q))
        paint()
      }, cfg.delay ?? 700)
    }

    control.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return
      if (!open) {
        input.focus()
        open = true
        paint()
      } else if (event.target !== input && event.target.localName !== "input") {
        open = false
        paint()
      }
    })
    track(input, (value) => {
      query = value
      open = true
      search()
      paint()
      render()
    })
    window.addEventListener("fixture-render", () => {
      if (input.value !== query) input.value = query
    })
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && !open) {
        open = true
        paint()
      } else if (event.key === "Escape") {
        open = false
        paint()
      } else if (event.key === "Enter" && open) {
        event.preventDefault()
        const first = visible()[0]
        if (first) choose(first)
      }
    })
    input.addEventListener("blur", () => {
      open = false
      if (query) {
        query = ""
        input.value = ""
      }
      paint()
    })
    paint()
    return { get value() { return picked } }
  }

  window.Fixture = { track, bind, render, state, h, reactSelect, fold }
})()
