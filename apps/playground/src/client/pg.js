// Runs on every playground page before the page's own scripts: switches, control summary for /inspect and the
// only submit path. Nothing here talks to another host than the one the page came from.
;(() => {
  const cfg = window.__PG || {}
  const SKIP = new Set(["hidden", "submit", "button", "reset", "image"])
  const carried = []

  if (cfg.latency > 0) {
    const native = window.setTimeout.bind(window)
    // short timers are debounces and blur handlers, the longer ones stand in for network answers
    window.setTimeout = (fn, ms, ...rest) => native(fn, (ms || 0) >= 200 ? ms + cfg.latency : ms, ...rest)
  }

  function* roots(from) {
    yield from
    for (const el of from.querySelectorAll("*")) if (el.shadowRoot) yield* roots(el.shadowRoot)
  }

  function allControls() {
    const out = []
    for (const root of roots(document)) {
      for (const el of root.querySelectorAll(
        "input, select, textarea, [role=radio], [role=checkbox], button[aria-pressed], button[aria-haspopup=listbox]",
      )) {
        if (el.matches("input") && SKIP.has(el.type)) continue
        if (el.closest("[data-pg-ignore]")) continue
        out.push(el)
      }
    }
    return out
  }

  const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim()

  function labelOf(el) {
    const root = el.getRootNode()
    const aria = el.getAttribute("aria-label")
    if (aria) return aria.trim()
    const by = el.getAttribute("aria-labelledby")
    if (by) {
      const joined = by
        .split(/\s+/)
        .map((id) => text(root.getElementById?.(id) || root.querySelector(`[id="${id}"]`)))
        .join(" ")
        .trim()
      if (joined) return joined
    }
    if (el.id) {
      const tag = root.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (tag) return text(tag)
    }
    const wrap = el.closest("label")
    if (wrap) return text(wrap).replace(text(el), "").trim() || text(wrap)
    const legend = el.closest("fieldset, [role=radiogroup], [role=group]")
    const head = legend?.querySelector("legend, [id]:not([role])")
    if (legend && head) return text(head)
    return el.getAttribute("placeholder") || el.getAttribute("name") || el.id || ""
  }

  function visible(el) {
    if (el.getAttribute("aria-hidden") === "true" && !el.matches("[role=radio], [role=checkbox]")) return false
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
    if (Number(style.opacity) === 0 && !el.matches("input[type=file]")) return false
    if (box.right < 0 || box.left > innerWidth + 50) return false
    if (el.matches("input[type=file]")) return true
    return box.width > 1 && box.height > 1
  }

  function controlValue(el) {
    if (el.matches("button[aria-haspopup=listbox]")) return text(el) === "Select One" ? "" : text(el)
    if (el.matches("[role=radio], [role=checkbox], button[aria-pressed]")) {
      const on = el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true"
      return on ? text(el) || "on" : ""
    }
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? el.value || "on" : ""
    if (el.type === "file") return el.files?.[0]?.name || ""
    if (el.type === "password") return el.value ? "[hidden]" : ""
    if (el.getAttribute("role") === "combobox" && !el.value) {
      const shown = el.closest(".select-shell, .select__container, .select")?.querySelector(".select__single-value")
      if (shown) return text(shown)
    }
    if (el.tagName === "SELECT") return el.selectedIndex > 0 || el.value ? text(el.selectedOptions[0]) : ""
    return el.value || ""
  }

  function summary() {
    return allControls().map((el) => ({
      id: el.id || "",
      name: el.getAttribute("name") || "",
      label: labelOf(el),
      type: el.matches("button[aria-haspopup=listbox]")
        ? "select"
        : el.getAttribute("role") === "radio"
          ? "radio"
          : el.getAttribute("role") === "checkbox"
            ? "checkbox"
            : el.type || el.tagName.toLowerCase(),
      required: el.required === true || el.getAttribute("aria-required") === "true",
      disabled: el.disabled === true,
      visible: visible(el),
      trap: el.hasAttribute("data-pg-trap"),
      value: controlValue(el).slice(0, 300),
    }))
  }

  function endpoint() {
    const params = new URLSearchParams({ site: cfg.site || "unknown" })
    for (const key of ["run", "variant", "layout", "cookie", "latency"]) if (cfg[key]) params.set(key, cfg[key])
    return `/api/submissions?${params}`
  }

  function prepare(form) {
    form.setAttribute("action", endpoint())
    form.setAttribute("method", "post")
    form.querySelector("input[name=__pg_fields]")?.remove()
    const hidden = document.createElement("input")
    hidden.type = "hidden"
    hidden.name = "__pg_fields"
    hidden.value = JSON.stringify([...carried, ...summary()])
    form.append(hidden)
  }

  document.addEventListener(
    "submit",
    (event) => (event.target instanceof HTMLFormElement ? prepare(event.target) : null),
    true,
  )

  // multi step pages call remember() before they replace their content, so the review sees every step
  const remember = () => carried.push(...summary())

  function postEntries(entries) {
    const form = document.createElement("form")
    form.hidden = true
    for (const [name, value] of entries) {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = name
      input.value = value
      form.append(input)
    }
    document.body.append(form)
    prepare(form)
    form.submit()
  }

  window.PG = { cfg, summary, remember, prepare, endpoint, postEntries }

  function submitBox(form) {
    const button = form.querySelector("[type=submit]")
    let node = button
    while (node && node.parentElement !== form) node = node.parentElement
    return node || null
  }

  function mainForm() {
    for (const root of roots(document)) {
      const form = root.querySelector("form")
      if (form) return form
    }
    return null
  }

  function rename(form) {
    const rootNode = form.getRootNode()
    const renamed = new Map()
    for (const el of form.querySelectorAll("[id]")) {
      if (
        el.dataset.pgRenamed ||
        el.matches("input[type=hidden]") ||
        !el.matches("input, select, textarea, label, button")
      )
        continue
      renamed.set(el.id, `${el.id}-v2`)
    }
    for (const el of rootNode.querySelectorAll("*")) {
      for (const attr of [
        "for",
        "aria-labelledby",
        "aria-describedby",
        "aria-controls",
        "aria-owns",
        "aria-errormessage",
      ]) {
        const value = el.getAttribute(attr)
        if (value)
          el.setAttribute(
            attr,
            value
              .split(/\s+/)
              .map((id) => renamed.get(id) || id)
              .join(" "),
          )
      }
    }
    for (const el of form.querySelectorAll("[id]")) {
      if (renamed.has(el.id)) {
        el.id = renamed.get(el.id)
        el.dataset.pgRenamed = "1"
      }
    }
    for (const el of form.querySelectorAll("input[name], select[name], textarea[name]")) {
      if (el.type === "hidden" || el.dataset.pgRenamedName) continue
      el.setAttribute("name", `${el.getAttribute("name")}_v2`)
      el.dataset.pgRenamedName = "1"
    }
  }

  function moveFields(form) {
    const last = submitBox(form)
    const kids = [...form.children].filter(
      (kid) => kid !== last && !kid.matches("input[type=hidden], script, style, template"),
    )
    if (kids.length < 2) return
    for (const kid of kids.reverse()) form.insertBefore(kid, last)
  }

  function addRequiredField(form) {
    const wrap = document.createElement("div")
    wrap.className = "pg-new-field field-wrapper"
    wrap.innerHTML =
      '<label for="clearance_v2" style="display:block;font-weight:600;margin:14px 0 4px">Security clearance level <span aria-hidden="true" style="color:#b42318">*</span></label>' +
      '<input id="clearance_v2" name="clearance_v2" type="text" required aria-required="true" style="box-sizing:border-box;width:100%;padding:8px;border:1px solid #bbb;border-radius:4px">'
    form.insertBefore(wrap, submitBox(form))
  }

  const VARIANTS = { "renamed-ids": rename, "moved-fields": moveFields, "new-required-field": addRequiredField }

  function apply() {
    const form = mainForm()
    if (!form || form.dataset.pgApplied === `${cfg.variant}|${cfg.layout}`) return false
    form.dataset.pgApplied = `${cfg.variant}|${cfg.layout}`
    if (cfg.layout === "b") {
      document.documentElement.classList.add("pg-layout-b")
      moveFields(form)
    }
    VARIANTS[cfg.variant]?.(form)
    return true
  }

  function cookieBanner() {
    if (!cfg.cookie || document.querySelector("[data-ui=cookie-consent]")) return
    const box = document.createElement("div")
    box.setAttribute("data-ui", "cookie-consent")
    box.setAttribute("role", "dialog")
    box.setAttribute("aria-label", "Cookie consent")
    box.setAttribute("data-pg-ignore", "")
    box.style.cssText =
      "position:fixed;bottom:0;left:0;max-width:560px;box-sizing:border-box;background:#222;color:#fff;padding:12px 16px;z-index:2147483000;font:14px system-ui,sans-serif"
    box.innerHTML =
      "<span>This site uses cookies to improve your experience.</span> " +
      '<button type="button" data-ui="cookie-consent-decline">Decline all</button> ' +
      '<button type="button" data-ui="cookie-consent-accept">Accept all</button>'
    box.addEventListener("click", (event) => {
      if (event.target instanceof HTMLButtonElement) box.remove()
    })
    document.body.append(box)
  }

  function start() {
    cookieBanner()
    apply()
    // frameworks draw after the document is ready: apply again as soon as the form shows up
    let tries = 0
    const observer = new MutationObserver(() => {
      if (apply() || ++tries > 200) observer.disconnect()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => observer.disconnect(), 15000)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start)
  else start()
})()
