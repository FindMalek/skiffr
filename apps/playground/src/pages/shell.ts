import { esc } from "../html.ts"
import { jobDescription } from "../inject.ts"

/** A small page frame for the boards that are not copied from a fixture. */
export function shell(options: {
  title: string
  css?: string
  body: string
  head?: string
  bodyAttrs?: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<style>
  body { font: 15px/1.45 system-ui, sans-serif; color: #222; margin: 0; background: #fff }
  .wrap { max-width: 680px; margin: 0 auto; padding: 16px }
  label { display: block; font-weight: 600; margin: 14px 0 4px }
  input[type=text], input[type=email], input[type=tel], input[type=url], input[type=date], input[type=number], input[type=password], select, textarea { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 4px; font: inherit }
  .radio, .check { display: block; font-weight: 400; margin: 4px 0 }
  .req { color: #b42318 }
  button[type=submit], .btn { margin: 20px 0; padding: 10px 20px; border: 1px solid #333; background: #111; color: #fff; border-radius: 4px; font: inherit; cursor: pointer }
  .btn.secondary { background: #fff; color: #111 }
  fieldset { border: 0; margin: 14px 0; padding: 0 }
  h1, h2, h3 { line-height: 1.2 }
${options.css ?? ""}
</style>
${options.head ?? ""}
</head>
<body${options.bodyAttrs ? ` ${options.bodyAttrs}` : ""}>
${options.body}
</body>
</html>`
}

export { jobDescription }
