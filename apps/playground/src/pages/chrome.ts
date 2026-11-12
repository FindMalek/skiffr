import { esc } from "../html.ts"

export const CSS = `
  body { font: 14px/1.45 system-ui, sans-serif; color: #1c1c1c; background: #fafafa; margin: 0 }
  header.top { background: #111; color: #fff; padding: 10px 20px; display: flex; gap: 18px; align-items: baseline }
  header.top a { color: #fff; text-decoration: none; opacity: .85 } header.top a:hover { opacity: 1 }
  header.top strong { font-size: 15px }
  main { max-width: 1040px; margin: 0 auto; padding: 20px }
  h1 { font-size: 22px; margin: 4px 0 12px } h2 { font-size: 16px; margin: 24px 0 8px }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #ddd }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top }
  th { background: #f1f1ef; font-weight: 600 }
  code { background: #eee; padding: 1px 5px; border-radius: 3px; font-size: 12px }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: #e8e8e5 }
  .red { background: #fde4e1; color: #8f1d12 } .amber { background: #fdf0d2; color: #7a4b00 } .green { background: #dff3e1; color: #1b5e20 }
  .banner { padding: 12px 16px; border-radius: 6px; margin: 12px 0 } .banner.red { border: 1px solid #e8a39b }
  .muted { color: #666 } .small { font-size: 12px }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin: 12px 0 }
  form.inline { display: inline } button { font: inherit; padding: 3px 10px; cursor: pointer }
`

export interface PageOptions {
  token?: string
  umami?: { scriptUrl: string; websiteId: string } | null
}

export function page(title: string, body: string, { token = "", umami = null }: PageOptions = {}): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>${umami ? `<script defer src="${esc(umami.scriptUrl)}" data-website-id="${esc(umami.websiteId)}"></script>` : ""}</head><body>
<header class="top"><strong>skiffr playground</strong><a href="/">pages</a><a href="/inspect${q}">inspect</a><a href="/admin${q}">break it</a><a href="/api/jobs">job urls</a></header>
<main>${body}</main></body></html>`
}
