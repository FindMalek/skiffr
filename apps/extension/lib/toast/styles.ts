export const TOAST_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.toast {
  --bg: #ffffff; --fg: #18181b; --muted: #52525b; --border: #e4e4e7; --accent: #18181b; --accent-fg: #fafafa; --hover: #f4f4f5;
  width: 320px; max-width: calc(100vw - 32px); max-height: 100%; overflow: hidden; pointer-events: auto; padding: 14px 16px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  display: flex; flex-direction: column;
  opacity: 0; transform: translateY(8px);
}
.toast.ask { height: 100px; --lines: 1; }
.toast.result { height: 140px; --lines: 3; }
.toast.offer { height: 220px; --lines: 5; }
.toast.in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: no-preference) { .toast { transition: opacity 0.16s ease, transform 0.16s ease; } }
@media (prefers-color-scheme: dark) {
  .toast { --bg: #18181b; --fg: #fafafa; --muted: #a1a1aa; --border: #3f3f46; --accent: #fafafa; --accent-fg: #18181b; --hover: #27272a; }
}
.toast:focus { outline: none; }
.title { margin: 0 0 12px; font-weight: 600; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--lines); overflow: hidden; overflow-wrap: anywhere; }
.row { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 14px; border: 1px solid var(--border); background: transparent; color: var(--fg); }
button:hover { background: var(--hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
button.primary:hover { opacity: 0.9; background: var(--accent); }
button.link { margin-left: auto; padding: 6px 2px; border: 0; color: var(--muted); font-size: 12px; text-decoration: underline; }
button.link:hover { background: transparent; color: var(--fg); }
`
