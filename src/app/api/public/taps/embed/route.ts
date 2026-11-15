import { publicTapList } from "@/server/services/taps";
import { publicOrigin } from "@/server/services/public-url";

export const dynamic = "force-dynamic";

/**
 * Embeddable tap list for the website, in an iframe:
 *
 *   <iframe src="https://<app>/api/public/taps/embed" title="On tap at Subversive"
 *           style="width:100%;height:640px;border:0" loading="lazy"></iframe>
 *
 * Options: ?theme=light|dark (default follows the visitor), ?prices=0 hides
 * prices, ?soon=0 hides coming soon. Refreshes itself every 60 seconds without
 * reloading. Same public fields as /api/public/taps.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const theme = q.get("theme") === "light" || q.get("theme") === "dark" ? q.get("theme")! : "auto";
  const opts = { prices: q.get("prices") !== "0", soon: q.get("soon") !== "0" };
  const origin = await publicOrigin();
  const data = await publicTapList(origin);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en"${theme === "auto" ? "" : ` data-theme="${theme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>On tap · ${esc(data.name)}</title>
<style>
:root{--bg:#ffffff;--ink:#1a1a18;--muted:#6b6a64;--line:#e7e5df;--chip:#f3f2ee;--warn:#9a5b00;--good:#2f6b3a}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121211;--ink:#f3f1ea;--muted:#a6a39a;--line:#2b2a27;--chip:#1f1e1c;--warn:#f0b35a;--good:#8fd19e}}
:root[data-theme=dark]{--bg:#121211;--ink:#f3f1ea;--muted:#a6a39a;--line:#2b2a27;--chip:#1f1e1c;--warn:#f0b35a;--good:#8fd19e}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{padding:12px 16px;max-width:860px;margin:0 auto}
ol{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line)}
.n{flex:none;width:2em;height:2em;border-radius:8px;display:grid;place-items:center;font-weight:700;font-variant-numeric:tabular-nums}
.img{flex:none;width:2.6em;height:2.6em;border-radius:8px;object-fit:cover}
.b{flex:1;min-width:0}
.t{font-weight:650;font-size:1.05em;overflow-wrap:anywhere}
.s{color:var(--muted);font-size:.9em}
.d{margin-top:2px;font-size:.9em}
.p{flex:none;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-size:.92em}
.p div span{color:var(--muted)}
.tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:.75em;font-weight:600;vertical-align:2px;background:var(--chip)}
.tag.almost{color:var(--warn)}.tag.new{color:var(--good)}
h2{font-size:.8em;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 0 6px}
.soon{display:flex;flex-wrap:wrap;gap:6px 14px}.soon span{white-space:nowrap}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:6px}
.empty{color:var(--muted);padding:16px 0}
</style>
</head>
<body>
<main><ol id="taps"></ol><div id="soon"></div></main>
<script id="data" type="application/json">${json}</script>
<script>
(function(){
var opts=${JSON.stringify(opts)};
function e(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]})}
function money(n){return "$"+(n%1===0?n:n.toFixed(2))}
function render(d){
  var t=d.taps.map(function(x){
    var meta=[x.style,x.abv!=null?x.abv+"% ABV":null,x.ibu!=null?x.ibu+" IBU":null,x.diet].filter(Boolean).join(" · ");
    var badge=x.badge==="almost"?'<span class="tag almost">Almost gone</span>':x.badge==="new"?'<span class="tag new">New</span>':"";
    var pours=opts.prices?x.pours.map(function(p){return "<div><span>"+e(p.label)+"</span> "+money(p.price)+"</div>"}).join(""):"";
    var lead=x.label?'<img class="img" alt="" src="'+e(x.label)+'">':'<span class="n" style="background:'+e(x.color)+';color:'+e(x.colorText)+'">'+e(x.tap)+"</span>";
    return "<li>"+lead+'<div class="b"><div class="t">'+e(x.beer)+badge+"</div>"+(meta?'<div class="s">'+e(meta)+"</div>":"")+(x.description?'<div class="d">'+e(x.description)+"</div>":"")+'</div><div class="p">'+pours+"</div></li>";
  }).join("");
  document.getElementById("taps").innerHTML=t||'<li class="empty">Nothing on tap right now.</li>';
  var s=opts.soon&&d.comingSoon.length?'<h2>Coming soon</h2><div class="soon">'+d.comingSoon.map(function(c){return '<span><i class="dot" style="background:'+e(c.color)+'"></i>'+e(c.beer)+(c.style?' <span class="s">'+e(c.style)+"</span>":"")+"</span>"}).join("")+"</div>":"";
  document.getElementById("soon").innerHTML=s;
}
var d0=JSON.parse(document.getElementById("data").textContent);
var last=JSON.stringify({t:d0.taps,s:d0.comingSoon});
render(d0);
setInterval(function(){
  fetch(${JSON.stringify(`${origin}/api/public/taps`)},{cache:"no-store"}).then(function(r){return r.ok?r.text():null}).then(function(txt){
    if(!txt)return;var d=JSON.parse(txt);var key=JSON.stringify({t:d.taps,s:d.comingSoon});
    if(key!==last){last=key;render(d)}
  }).catch(function(){});
},60000);
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      // Meant to be framed by the website.
      "Content-Security-Policy": "frame-ancestors *",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
