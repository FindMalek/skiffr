// A multi step form that replaces its content between steps, like Easy Apply and Workday do.
;(() => {
  const config = window.__WIZARD
  const root = document.querySelector(config.mount)
  const answers = {}
  let index = config.wall ? -1 : 0

  const stepAt = (i) => (i === -1 ? config.wall : config.steps[i])
  const has = (value) => value !== "" && value != null

  function collect() {
    for (const el of root.querySelectorAll("input, select, textarea")) {
      if (!el.name) continue
      if (el.type === "radio") {
        if (el.checked) answers[el.name] = el.value
        else if (!(el.name in answers)) answers[el.name] = ""
      } else if (el.type === "checkbox") answers[el.name] = el.checked ? el.value || "on" : ""
      else if (el.type === "file") answers[el.name] = el.files?.[0]?.name || answers[el.name] || ""
      else if (el.type !== "password") answers[el.name] = el.value
    }
  }

  function prefill() {
    for (const el of root.querySelectorAll("input, select, textarea")) {
      const value = answers[el.name]
      if (!has(value) || el.type === "file" || el.type === "password") continue
      if (el.type === "radio") el.checked = el.value === value
      else if (el.type === "checkbox") el.checked = true
      else el.value = value
    }
    for (const button of root.querySelectorAll("button[aria-haspopup=listbox]")) {
      const hidden = root.querySelector(`input[type=hidden][name="${button.dataset.for}"]`)
      if (hidden && has(answers[hidden.name])) {
        hidden.value = answers[hidden.name]
        button.textContent = answers[hidden.name]
      }
    }
  }

  function missing() {
    const out = []
    for (const el of root.querySelectorAll("[required], [aria-required=true]")) {
      const kind = el.type
      let ok
      if (kind === "radio") ok = !!root.querySelector(`input[type=radio][name="${el.name}"]:checked`)
      else if (kind === "checkbox") ok = el.checked
      else if (kind === "file") ok = !!el.files?.length || has(answers[el.name])
      else if (el.matches("button[aria-haspopup=listbox]"))
        ok = has(root.querySelector(`input[type=hidden][name="${el.dataset.for}"]`)?.value)
      else ok = has(el.value)
      if (!ok) out.push(el)
    }
    return out
  }

  function flag(elements) {
    for (const old of root.querySelectorAll(".wizard-error")) old.remove()
    for (const el of elements) {
      el.setAttribute("aria-invalid", "true")
      const note = document.createElement("div")
      note.className = "wizard-error"
      note.setAttribute("role", "alert")
      note.textContent = "Please enter a valid answer"
      note.style.cssText = "color:#b42318;font-size:13px"
      el.closest("[data-field], .field, fieldset, div")?.append(note)
    }
  }

  function review() {
    const rows = Object.entries(answers)
      .filter(([name, value]) => has(value) && !/password/i.test(name))
      .map(
        ([name, value]) =>
          `<li><span>${name.replace(/[<>&]/g, "")}</span>: <strong>${String(value).replace(/[<>&]/g, "")}</strong></li>`,
      )
    return `<ul class="review-list">${rows.join("")}</ul>`
  }

  function paint() {
    const step = stepAt(index)
    root.innerHTML = step.review ? step.html.replace("{{review}}", review()) : step.html
    prefill()
    config.onPaint?.(index, step)
    document.querySelector(config.title)?.replaceChildren(document.createTextNode(step.title))
    const back = document.querySelector(config.back)
    const next = document.querySelector(config.next)
    const submit = document.querySelector(config.submit)
    if (back) back.hidden = index <= 0
    if (next) {
      next.hidden = !!step.review
      next.textContent = step.cta || "Next"
    }
    if (submit) submit.hidden = !step.review
    document.querySelector(config.progress)?.setAttribute("data-step", String(index + 1))
  }

  document.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const dropdown = target.closest("button[aria-haspopup=listbox]")
    if (dropdown && root.contains(dropdown)) {
      const open = dropdown.getAttribute("aria-expanded") === "true"
      for (const list of root.querySelectorAll("ul[role=listbox]")) list.remove()
      dropdown.setAttribute("aria-expanded", String(!open))
      if (open) return
      const list = document.createElement("ul")
      list.setAttribute("role", "listbox")
      list.style.cssText =
        "position:absolute;z-index:9;background:#fff;border:1px solid #bbb;margin:2px 0 0;padding:4px 0;list-style:none;min-width:240px"
      for (const choice of JSON.parse(dropdown.dataset.options || "[]")) {
        const item = document.createElement("li")
        item.setAttribute("role", "option")
        item.setAttribute("aria-selected", "false")
        item.textContent = choice
        item.style.cssText = "padding:6px 12px;cursor:pointer"
        list.append(item)
      }
      dropdown.after(list)
      return
    }
    const option = target.closest("ul[role=listbox] [role=option]")
    if (option) {
      const list = option.closest("ul")
      const button = list.previousElementSibling
      const hidden = root.querySelector(`input[type=hidden][name="${button.dataset.for}"]`)
      hidden.value = option.textContent
      button.textContent = option.textContent
      button.setAttribute("aria-expanded", "false")
      hidden.dispatchEvent(new Event("change", { bubbles: true }))
      list.remove()
      return
    }
    if (target.closest(config.next)) {
      const bad = missing()
      if (bad.length) return flag(bad)
      collect()
      window.PG?.remember()
      index += 1
      paint()
    } else if (target.closest(config.back)) {
      collect()
      index -= 1
      paint()
    } else if (target.closest(config.submit)) {
      collect()
      window.PG?.postEntries(Object.entries(answers).filter(([name]) => !/password/i.test(name)))
    }
  })

  paint()
})()
