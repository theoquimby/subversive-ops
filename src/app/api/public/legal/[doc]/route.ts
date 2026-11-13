import { getBusinessProfile } from "@/server/services/onboarding";

export const dynamic = "force-dynamic";

/**
 * Two short public pages — privacy policy and terms of use — because Intuit
 * asks for both web addresses before it gives an app production keys, even a
 * private app used by one business. Plain HTML, no sign-in needed.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, business: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(business)} Ops</title>
<style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:40rem;margin:0 auto;padding:2rem 1rem;color:#1c1b19;background:#faf9f7}h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.75rem 0 .25rem}p,li{color:#3d3b37}.muted{color:#85837c;font-size:.9rem}@media (prefers-color-scheme:dark){body{background:#151412;color:#eeece8}p,li{color:#c9c6bf}}</style></head>
<body><h1>${esc(title)}</h1><p class="muted">${esc(business)} Ops — the private back-office app of ${esc(business)}.</p>${body}</body></html>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const { name } = await getBusinessProfile();
  const b = esc(name);
  if (doc === "privacy") {
    return html(
      page(
        "Privacy policy",
        name,
        `<p>This app is used only by ${b} and its staff to run the business. It isn't offered to anyone else.</p>
<h2>What it reads and writes in QuickBooks</h2>
<p>When a manager connects QuickBooks Online, the app reads the company name, the chart of accounts and the vendor list, and writes vendors and bills for supplier invoices that a manager has approved, with the invoice photo or PDF attached. It doesn't read customers, payroll, bank feeds or payments.</p>
<h2>How it's kept</h2>
<p>The QuickBooks sign-in is stored encrypted on the app's own database and is never shown to anyone. Only ${b} managers can connect, use or disconnect it.</p>
<h2>Sharing</h2>
<p>Nothing from QuickBooks is sold, shared or used for advertising. Invoice photos may be read by an AI service to fill in invoice lines, only when that feature is turned on by a manager.</p>
<h2>Disconnecting</h2>
<p>A manager can disconnect at any time in the app (Settings → QuickBooks → Disconnect) or in QuickBooks. The app then stops using the connection and removes its stored sign-in.</p>
<h2>Questions</h2>
<p>Ask the ${b} management team.</p>`,
      ),
    );
  }
  if (doc === "terms") {
    return html(
      page(
        "Terms of use",
        name,
        `<p>This app is for the internal use of ${b} and its staff only. It's provided as is, without any warranty.</p>
<p>Connecting QuickBooks Online lets the app create vendors and bills in the connected company when a manager approves a supplier invoice or presses Send. Managers are responsible for checking what is sent. The app never pays bills or moves money.</p>
<p>Access ends when the connection is removed in the app or in QuickBooks.</p>`,
      ),
    );
  }
  return new Response("Not found", { status: 404 });
}

const html = (s: string) => new Response(s, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
