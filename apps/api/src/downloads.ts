import { join } from "node:path"

const ZIP = "skiffr-extension.zip"

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The extension zip that matches this build, baked into the image by the release workflow. A self hoster downloads it from
 * their own instance: `/downloads` is a short page, `/downloads/skiffr-extension.zip` the file. Returns null for any other path.
 */
export function createDownloads(opts: { dir: string; version: string; publicUrl: string }) {
  return async (pathname: string): Promise<Response | null> => {
    if (pathname === `/downloads/${ZIP}`) {
      const zip = Bun.file(join(opts.dir, ZIP))
      if (!(await zip.exists())) {
        return Response.json(
          { message: "This build has no extension zip. Release images include it, a build from source does not." },
          { status: 404 },
        )
      }
      return new Response(zip, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="skiffr-extension-v${opts.version}.zip"`,
          "cache-control": "no-cache",
        },
      })
    }
    if (pathname !== "/downloads" && pathname !== "/downloads/") return null
    const api = escapeHtml(opts.publicUrl)
    const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>skiffr extension</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}code{background:#8882;padding:.1em .3em;border-radius:4px}</style>
<h1>skiffr extension v${escapeHtml(opts.version)}</h1>
<p>This is the extension that matches the version of your server.</p>
<ol>
<li><a href="/downloads/${ZIP}">Download ${ZIP}</a> and unzip it into a folder you keep.</li>
<li>Open <code>chrome://extensions</code>, turn on Developer mode, choose Load unpacked and pick that folder.</li>
<li>In the extension options set the api url to <code>${api}</code> and paste a token from the dashboard (Extension page).</li>
</ol>
<p>After a server update, download the zip again, replace the folder content and press reload on the extension card.</p>`
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } })
  }
}
