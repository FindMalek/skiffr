const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids of records in a path (uuids, long hex or digits) become `:id`, so a page view never names one. */
const ID_SEGMENT = String.raw`/[0-9a-f]{8}-[0-9a-f-]{20,}|/[0-9a-f]{16,}|/\d{4,}`

/**
 * The script the pages load, built at request time from the runtime env so no value is baked into the build. It does
 * nothing for a visitor with Do Not Track or Global Privacy Control on, sends no query string, hash or referrer, and
 * rewrites record ids in the path. Umami itself sets no cookie and stores no address.
 */
export function umamiScript(url: string | undefined, websiteId: string | undefined): string {
  let origin: string
  try {
    const parsed = new URL(url ?? "")
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "/* analytics off */\n"
    origin = parsed.origin
  } catch {
    return "/* analytics off */\n"
  }
  if (!websiteId || !WEBSITE_ID.test(websiteId)) return "/* analytics off */\n"
  return `(function(){
var n=navigator;
if(n.doNotTrack==="1"||window.doNotTrack==="1"||n.globalPrivacyControl===true)return;
window.skiffrUmamiBeforeSend=function(type,payload){
if(payload&&typeof payload.url==="string")payload.url=payload.url.replace(new RegExp(${JSON.stringify(ID_SEGMENT)},"gi"),"/:id");
if(payload)payload.referrer="";
return payload;
};
var s=document.createElement("script");
s.defer=true;
s.src=${JSON.stringify(`${origin}/script.js`)};
s.setAttribute("data-website-id",${JSON.stringify(websiteId)});
s.setAttribute("data-do-not-track","true");
s.setAttribute("data-exclude-search","true");
s.setAttribute("data-exclude-hash","true");
s.setAttribute("data-before-send","skiffrUmamiBeforeSend");
document.head.appendChild(s);
})();
`
}

export function umamiResponse(url: string | undefined, websiteId: string | undefined): Response {
  return new Response(umamiScript(url, websiteId), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" },
  })
}
