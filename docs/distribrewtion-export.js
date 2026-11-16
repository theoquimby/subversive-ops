// Distribrewtion → Subversive Ops: download everything this account can see, as one JSON file.
// Read-only: it only fetches (GET) what Distribrewtion's own pages load. Run it in the browser
// console on app.distribrewtion.com while logged in, then drop the file into Ops → Kegs → Import.
(async () => {
  const auth = JSON.parse(localStorage.getItem("settings-authentication") || "{}");
  const p = auth.participantId;
  if (!p) return alert("Open Distribrewtion and log in first (no brewery selected).");
  const get = async (url) => {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  };
  // Spring-style pages ({content, totalPages}) are followed to the end; plain arrays are returned as-is.
  const all = async (url) => {
    const first = await get(url);
    if (!first || Array.isArray(first) || !Array.isArray(first.content)) return first;
    const out = [...first.content];
    for (let page = 1; page < (first.totalPages ?? 1) && page < 500; page++) {
      const sep = url.includes("?") ? "&" : "?";
      const next = await get(`${url}${sep}page=${page}&size=${first.size ?? 100}`);
      out.push(...(next.content ?? []));
    }
    return out;
  };
  const from = new Date("2015-01-01T00:00:00Z").toISOString();
  const to = new Date().toISOString();
  const lists = {
    kegs: `/app/breweries/${p}/kegs`,
    kegsOverview: `/app/breweries/${p}/kegs-overview`,
    logisticsKegs: `/app/logistics/participants/${p}/kegs`,
    logisticsKegsOverview: `/app/logistics/participants/${p}/kegs/overview`,
    kegHistory: `/app/logistics/participants/${p}/kegs/history`,
    kegMaintenances: `/app/breweries/${p}/keg-maintenances`,
    kegsDueForMaintenance: `/app/breweries/${p}/keg-due-for-maintenance-items`,
    buyerKegsSnapshot: `/app/breweries/${p}/reports/buyer-kegs-snapshot`,
    consumedVolume: `/app/breweries/${p}/reports/consumed-volume?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`,
    beverages: `/app/sales/participants/${p}/beverages`,
    beveragesActive: `/app/sales/participants/${p}/beverage-summaries?productStatus=Active`,
    beveragesArchived: `/app/sales/participants/${p}/beverage-summaries?productStatus=Archived`,
    batches: `/app/sales/participants/${p}/batch-summaries`,
    orders: `/app/sales/participants/${p}/orders`,
    orderSummaries: `/app/sales/participants/${p}/order-summaries`,
    pricing: `/app/sales/participants/${p}/pricing/beverage/preset`,
    locations: `/app/identity/participants/${p}/locations`,
    members: `/app/identity/participants/${p}/members`,
    accounts: `/app/accounts`,
  };
  const data = { exportedAt: to, participantId: p, errors: {} };
  for (const [k, url] of Object.entries(lists)) {
    try { data[k] = await all(url); console.log("✓", k, Array.isArray(data[k]) ? data[k].length : ""); }
    catch (e) { data.errors[k] = String(e.message || e); console.warn("✗", k, e.message); }
  }
  // Each keg's own history, a few at a time.
  const kegList = [data.kegs, data.logisticsKegs].find((x) => Array.isArray(x) && x.length) || [];
  const ids = [...new Set(kegList.map((k) => k.id ?? k.kegId).filter(Boolean))];
  data.kegHistories = [];
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      try {
        const h = await all(`/app/kegs/${id}/history`);
        for (const row of Array.isArray(h) ? h : [h]) data.kegHistories.push({ kegId: id, ...row });
      } catch (e) { data.errors[`kegHistory:${id}`] = String(e.message || e); }
    }));
    console.log(`keg history ${Math.min(i + 4, ids.length)}/${ids.length}`);
  }
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `distribrewtion-export-${to.slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  console.log("Done. Errors:", data.errors);
})();
