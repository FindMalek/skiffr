import { describe, expect, test } from "bun:test"
import { findViolations, MAX_DEPTH, MAX_INPUT_CHARS, SanitizeError, sanitizeHtml } from "./sanitize.ts"

const page = (body: string, head = ""): string => `<html lang="en"><head>${head}</head><body>${body}</body></html>`

function bodyOf(html: string): string {
  return sanitizeHtml(page(html)).split("<body>\n")[1]?.split("\n</body>")[0] ?? ""
}

const HOSTILE: [string, string, RegExp][] = [
  ["script element", `<script>alert(1)</script><input name="a">`, /script|alert/i],
  ["script in svg", `<svg width="10" height="10"><script>alert(1)</script></svg>`, /script|alert|<svg/i],
  [
    "svg foreignObject",
    `<svg><foreignObject><form action="https://evil.test"></form></foreignObject></svg>`,
    /foreign|evil|<svg/i,
  ],
  ["javascript url", `<a href="javascript:alert(1)">x</a>`, /javascript/i],
  ["tab split javascript url", `<a href="java\tscript:alert(1)">x</a>`, /script:|alert/i],
  ["data uri href", `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`, /data:/i],
  ["base href", `<base href="https://evil.test/"><a href="/a">x</a>`, /base|evil/i],
  ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.test">`, /refresh|evil|<meta http/i],
  [
    "srcdoc iframe",
    `<iframe srcdoc="<script>alert(1)</script>" title="t" width="50" height="20"></iframe>`,
    /srcdoc|<iframe|alert/i,
  ],
  ["remote iframe", `<iframe src="https://evil.test/embed"></iframe>`, /evil|<iframe/i],
  ["css import", `<style>@import url(https://evil.test/a.css);</style><input name="a">`, /import|evil|<style/i],
  [
    "style url",
    `<div style="background:url(https://evil.test/a.png);display:none"><input name="a"></div>`,
    /url|evil|background/i,
  ],
  ["style expression", `<div style="width:expression(alert(1))"><input name="a"></div>`, /expression|alert/i],
  ["form action", `<form action="https://evil.test/steal" method="post"><input name="a"></form>`, /evil|steal/i],
  ["button formaction", `<form><button formaction="https://evil.test/x">go</button></form>`, /evil/i],
  ["noscript pixel", `<noscript><img src="https://tracker.test/p.gif"></noscript>`, /tracker|noscript|<img/i],
  ["inline handler", `<input name="a" onfocus="steal()" onclick="x()">`, /onfocus|onclick|steal/i],
  ["image src", `<img src="https://cdn.test/logo.png" alt="logo" width="40" height="40">`, /cdn|<img|src=/i],
  ["tracking pixel", `<img src="https://t.test/p.gif" width="1" height="1">`, /t\.test|<img|<span/i],
  [
    "video and source",
    `<video src="https://cdn.test/v.mp4"><source src="https://cdn.test/v.webm"></video>`,
    /cdn|<video|<source/i,
  ],
  [
    "object and embed",
    `<object data="https://evil.test/x.swf"></object><embed src="https://evil.test/y">`,
    /evil|<object|<embed/i,
  ],
  ["link preload", `<link rel="preload" href="https://cdn.test/a.js" as="script">`, /cdn|<link/i],
  ["template", `<template><script>alert(1)</script></template>`, /template|alert/i],
  ["comment", `<!-- secret@corp.test --><input name="a">`, /secret|<!--/],
  ["srcset and ping", `<a href="/x" ping="https://t.test/p" srcset="https://t.test/a 1x">x</a>`, /ping|srcset|t\.test/],
  ["xlink href", `<div xlink:href="javascript:alert(1)"></div>`, /xlink|javascript/],
  ["nonce and integrity", `<div nonce="abc123" integrity="sha256-abc"></div>`, /nonce|integrity/],
]

describe("sanitizeHtml hostile input", () => {
  test.each(HOSTILE)("%s", (_name, html, forbidden) => {
    const out = sanitizeHtml(page(html))
    expect(out).not.toMatch(forbidden)
    expect(findViolations(out)).toEqual([])
  })

  test("a document level hostile page with scripts, base and meta is clean", () => {
    const out = sanitizeHtml(
      `<!doctype html><html lang="fr"><head><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test"><script src="https://evil.test/a.js"></script><title>Apply for  Engineer</title></head><body onload="x()"><script>x()</script><form action="https://evil.test"><input name="first_name"></form></body></html>`,
    )
    expect(out).toContain('<html lang="fr">')
    expect(out).toContain("<title>Apply for Engineer</title>")
    expect(out).toContain('<form action="#">')
    expect(out).not.toMatch(/evil|<script|onload|<base/)
  })
})

describe("sanitizeHtml rewrites", () => {
  const cases: [string, string, string][] = [
    [
      "absolute link keeps the path shape",
      `<a href="https://boards.example.com/acme/jobs/4012345678?gh_src=abc#frag">x</a>`,
      `<a href="https://example.invalid/acme/jobs/x">x</a>`,
    ],
    [
      "protocol relative link",
      `<a href="//cdn.example.com/legal/privacy">x</a>`,
      `<a href="https://example.invalid/legal/privacy">x</a>`,
    ],
    ["relative link drops query", `<a href="/privacy?session=abc123def456">x</a>`, `<a href="/privacy">x</a>`],
    [
      "mailto and tel",
      `<a href="mailto:jane@corp.test">x</a><a href="tel:+15551234567">y</a>`,
      `<a href="#">x</a>\n<a href="#">y</a>`,
    ],
    [
      "hidden input value",
      `<input type="hidden" name="authenticity_token" value="Zm9vYmFyYmF6cXV4MTIzNDU2">`,
      `<input name="authenticity_token" type="hidden" value="x">`,
    ],
    [
      "hidden input without a value",
      `<input type="hidden" name="job_id">`,
      `<input name="job_id" type="hidden" value="x">`,
    ],
    [
      "typed value is dropped",
      `<input type="text" name="email" value="jane.doe@acme.test">`,
      `<input name="email" type="text">`,
    ],
    [
      "checkbox value stays, checked goes",
      `<input type="checkbox" name="c" value="yes" checked>`,
      `<input name="c" type="checkbox" value="yes">`,
    ],
    [
      "textarea content is dropped",
      `<textarea name="why">my number is 555 123 4567</textarea>`,
      `<textarea name="why"></textarea>`,
    ],
    [
      "selected option is reset",
      `<select name="s"><option value="1" selected>One</option></select>`,
      `<select name="s">\n  <option value="1">One</option>\n</select>`,
    ],
    [
      "email and phone placeholders",
      `<input name="p" placeholder="jane@corp.test or +1 (555) 123-4567">`,
      `<input name="p" placeholder="user@example.invalid or 000-000-0000">`,
    ],
    ["name placeholder", `<input name="n" placeholder="Jane Smith">`, `<input name="n" placeholder="Jane Doe">`],
    [
      "field label placeholder stays",
      `<input name="n" placeholder="Full Name">`,
      `<input name="n" placeholder="Full Name">`,
    ],
    [
      "structural data stays",
      `<input name="a" data-qa="first-name" data-testid="x1" data-automation-id="email">`,
      `<input data-automation-id="email" data-qa="first-name" data-testid="x1" name="a">`,
    ],
    [
      "token and id data goes",
      `<div data-job-id="4012345678" data-ref="a1b2c3d4e5f6a7b8c9d0" data-csrf-token="abc" data-layout="wide"></div>`,
      `<div data-layout="wide"></div>`,
    ],
    [
      "analytics attributes go",
      `<button data-ga-label="x" data-gtm-click="y" data-track-id="z" data-qa="submit">Go</button>`,
      `<button data-qa="submit">Go</button>`,
    ],
    [
      "style keeps only visibility properties",
      `<div style="color:red;display:none;opacity:0;font-size:9px"><input name="a"></div>`,
      `<div style="display:none;opacity:0">\n  <input name="a">\n</div>`,
    ],
    [
      "image becomes a sized placeholder",
      `<img src="https://cdn.example.com/l.png" alt="Acme" width="40" height="30">`,
      `<span alt="Acme" data-skiffr-placeholder="img" style="display:inline-block;height:30px;width:40px"></span>`,
    ],
    [
      "iframe keeps what detect reads",
      `<iframe src="https://x.example.com/f" title="Application" name="app" width="300" height="200"></iframe>`,
      `<div data-skiffr-placeholder="iframe" name="app" style="display:block;height:200px;width:300px" title="Application"></div>`,
    ],
    [
      "email in text",
      `<p>Questions? Write to careers@acme.test today</p>`,
      `<p>Questions? Write to user@example.invalid today</p>`,
    ],
    ["url in text", `<p>See https://acme.test/legal/terms?id=9</p>`, `<p>See https://example.invalid/legal/terms</p>`],
    ["token in text", `<p>ref eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc ok</p>`, `<p>ref x ok</p>`],
    [
      "whitespace is normalized",
      `<div>\n\n   <label>  First \n name </label>\n\n  <input name="a">  </div>`,
      `<div>\n  <label>First name</label>\n  <input name="a">\n</div>`,
    ],
    [
      "attribute order is stable",
      `<input name="a" id="b" class="c" type="text">`,
      `<input class="c" id="b" name="a" type="text">`,
    ],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(bodyOf(input)).toBe(expected)
  })
})

describe("sanitizeHtml bounds", () => {
  test("refuses an oversized input", () => {
    expect(() => sanitizeHtml("a".repeat(MAX_INPUT_CHARS + 1))).toThrow(SanitizeError)
  })

  test("refuses a page with too many elements", () => {
    expect(() => sanitizeHtml(page("<i></i>".repeat(20_001)))).toThrow(SanitizeError)
  })

  test("cuts what nests deeper than the limit", () => {
    const deep = `${"<div>".repeat(MAX_DEPTH + 30)}<input name="deep">${"</div>".repeat(MAX_DEPTH + 30)}`
    const out = sanitizeHtml(page(deep))
    expect(out).not.toContain('name="deep"')
    expect(out.split("\n").length).toBeLessThan(MAX_DEPTH * 2 + 20)
  })

  test("drops a huge attribute", () => {
    expect(bodyOf(`<input name="a" title="${"x".repeat(5_000)}">`)).toBe('<input name="a">')
  })
})

describe("sanitizeHtml idempotence", () => {
  const corpus = [
    ...HOSTILE.map(([, html]) => html),
    ...(() => {
      return [
        `<form class="app" action="/apply"><div class="f"><label for="a">First name *</label><input id="a" name="first" required></div><div><label>Email <input type="email" name="email" placeholder="you@corp.test"></label></div><select name="c"><option value="">Select</option><option value="1">One</option></select><button type="submit">Submit application</button></form>`,
        `<p>Hi <b>there</b> <i>friend</i> mail a@b.test</p><table><tr><td>1</td></tr></table>`,
        `<div hidden aria-hidden="true" style="position:absolute;left:-9999px"><input name="website" tabindex="-1"></div>`,
      ]
    })(),
  ]
  test.each(corpus.map((html, i) => [i, html] as const))("corpus %d", (_i, html) => {
    const once = sanitizeHtml(page(html))
    expect(sanitizeHtml(once)).toBe(once)
  })
})

describe("findViolations", () => {
  const dirty: [string, string][] = [
    ["script", "<script>x()</script>"],
    ["iframe", '<iframe title="a"></iframe>'],
    ["remote url", '<a href="https://acme.test/x">x</a>'],
    ["protocol relative url", '<a href="//acme.test/x">x</a>'],
    ["javascript url", '<a href="javascript:x()">x</a>'],
    ["email", "<p>jane@acme.test</p>"],
    ["phone", "<p>+1 555 123 4567</p>"],
    ["event handler", '<input onclick="x()">'],
    ["css url", '<div style="background:url(a.png)"></div>'],
    ["hidden value", '<input name="t" type="hidden" value="abc123">'],
    ["form action", '<form action="/steal"></form>'],
    ["comment", "<!-- x -->"],
  ]
  test.each(dirty)("flags %s", (_name, html) => {
    expect(findViolations(`<body>${html}</body>`).length).toBeGreaterThan(0)
  })

  test("a bare number in an id is not a phone, one in the text is", () => {
    expect(findViolations('<label for="x1">q</label>')).toEqual([])
    expect(findViolations("<p>4015790004</p>")).not.toEqual([])
  })

  test("accepts the sanitizer's own placeholders", () => {
    const html =
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body>\n<form action="#"><a href="https://example.invalid/x">u</a><p>user@example.invalid 000-000-0000</p><input name="t" type="hidden" value="x"></form>\n</body>\n</html>\n'
    expect(findViolations(html)).toEqual([])
  })
})

describe("sanitizeHtml identifiers and personal values", () => {
  const cases: [string, string, string][] = [
    [
      "a token in an id is replaced the same way in the label that points at it",
      `<label for="candidate-12345678">Name</label><input id="candidate-12345678" name="n">`,
      `<label for="candidate-x1">Name</label>\n<input id="candidate-x1" name="n">`,
    ],
    [
      "uuid and jwt in id, name and class",
      `<input id="9f2c0a1b-7d3e-4c5a-8b6d-123456789abc" name="cards[9f2c0a1b-7d3e-4c5a-8b6d-123456789abc][a]" class="u eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig">`,
      `<input class="u x2" id="x1" name="cards[x1][a]">`,
    ],
    [
      "a person in an identifier",
      `<input name="jane.smith.5551234567" aria-labelledby="lbl-99887766">`,
      `<input aria-labelledby="lbl-x2" name="jane.smith.x1">`,
    ],
    [
      "ids the matchers use stay",
      `<input id="job_application_answers_attributes_4_text_value" name="first_name" class="input">`,
      `<input class="input" id="job_application_answers_attributes_4_text_value" name="first_name">`,
    ],
    [
      "option uuid value",
      `<option value="9f2c0a1b-7d3e-4c5a-8b6d-123456789abc">One</option>`,
      `<option value="x1">One</option>`,
    ],
    ["angular model dump", `<input name="a" ng-reflect-model="Jane Smith" ng-reflect-name="x">`, `<input name="a">`],
    [
      "personal data attributes",
      `<div data-candidate-name="Jane Smith" data-user-email="a" data-layout="wide" data-qa="candidate"></div>`,
      `<div data-layout="wide" data-qa="candidate"></div>`,
    ],
    [
      "profile handle in a link",
      `<a href="/in/jane-smith/">x</a><a href="/u/janedoe">y</a><a href="/@jane">z</a>`,
      `<a href="/in/x/">x</a>\n<a href="/u/x">y</a>\n<a href="/@jane">z</a>`.replace("/@jane", "/x"),
    ],
    [
      "uuid and base64 in text",
      `<p>id 9f2c0a1b-7d3e-4c5a-8b6d-123456789abc key Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA== done</p>`,
      `<p>id x key x done</p>`,
    ],
  ]
  test.each(cases)("%s", (_name, input, expected) => {
    expect(bodyOf(input)).toBe(expected)
  })

  test("a handful of identifiers sanitize to themselves on a second pass", () => {
    const once = sanitizeHtml(page(cases.map(([, html]) => html).join("")))
    expect(sanitizeHtml(once)).toBe(once)
  })
})

describe("sanitizeHtml stays linear on hostile text", () => {
  const shapes: [string, string][] = [
    ["a long word", "a".repeat(200_000)],
    ["alternating digits", "a1".repeat(100_000)],
    ["jwt prefixes", "eyJ.".repeat(50_000)],
    ["dots", "a.".repeat(50_000)],
    ["at signs", "a@".repeat(50_000)],
    ["digits and spaces", "1 ".repeat(100_000)],
    ["long hex", "ab".repeat(100_000)],
  ]
  test.each(shapes)("%s", (_name, text) => {
    const started = performance.now()
    const out = sanitizeHtml(page(`<form><p>${text}</p></form>`))
    findViolations(out)
    expect(performance.now() - started).toBeLessThan(3_000)
  })
})

describe("findViolations on hand edited files", () => {
  test("a greater than sign in an earlier attribute does not hide a hidden value", () => {
    expect(findViolations('<body><input title="a>b" type="hidden" name="t" value="SECRETVALUE"></body>')).not.toEqual(
      [],
    )
  })

  test("a form action hidden behind a quoted greater than sign", () => {
    expect(findViolations('<body><form title="a>b" action="/steal"></form></body>')).not.toEqual([])
  })

  test.each([
    ["image element", "<image src=x>"],
    ["ng-reflect attribute", '<input ng-reflect-model="Jane">'],
    ["uuid", '<div data-x="9f2c0a1b-7d3e-4c5a-8b6d-123456789abc"></div>'],
    ["jwt", '<div class="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0"></div>'],
    ["long number in an id", '<input id="candidate-12345678">'],
    ["long hex", "<p>0123456789abcdef0123456789abcdef</p>"],
  ])("flags %s", (_name, html) => {
    expect(findViolations(`<body>${html}</body>`)).not.toEqual([])
  })
})
