import type { HelpEntry } from "../types";

/** QuickBooks Online: connecting, choosing accounts and sending approved invoices as bills. */
export const quickbooks: HelpEntry[] = [
  {
    id: "settings.connections.quickbooks",
    area: "settings",
    route: "/settings/connections",
    title: "Connecting QuickBooks",
    body: "Part 1 registers the app on Intuit's developer site — once, and Intuit reviews a short questionnaire before it gives out the keys. Part 2 is Max signing in and pressing Connect. Part 3 picks which accounts bills go to.",
    article: `Approved supplier invoices go to QuickBooks Online as **bills**, with the invoice photo attached. Nothing is ever paid from the app.

**Part 1 — Register the app (one time, whoever set up the app).** On Intuit's developer site ([developer.intuit.com](https://developer.intuit.com/app/developer/dashboard)), sign in with any Intuit login and open **My Hub → App dashboard**.
1. Press **+** to create an app called **Subversive Ops** and tick **Accounting**.
2. **Settings → Redirect URIs → Production → Add URI**: paste the return address the guide gives you, then **Save**.
3. **Keys and credentials → Production → App details**: fill in each section. The guide has copy buttons for every address Intuit asks for, including a privacy policy and terms page the app publishes for you.
4. **Compliance → Start questionnaire**: answer plainly (a private app used only by Subversive; reads accounts and vendors, adds vendors and bills; nothing goes to an AI service). Intuit emails you when it's approved. It doesn't say how long that takes, so allow a few days.
5. **Keys and credentials → Production → Show credentials**: paste the **Client ID** and **Client secret** into the guide.

Want to try it before approval? Use the **Development** keys and pick **Test company** in the guide — they only work with Intuit's test companies.

**Part 2 — Connect (Max, 1 minute).** Press **Connect to QuickBooks**, sign in with a login that's an admin of the company, pick the company and press **Connect**.

**Part 3 — Choose accounts.** Pick where bills go (usually Cost of Goods Sold) and, if you split costs, an account per ingredient category. Then turn on **Send automatically**, or send the waiting invoices.

It's free: every Intuit app starts on its no-cost plan. QuickBooks keeps the app signed in as long as it's used at least once every 100 days.`,
    related: ["settings.quickbooks", "settings.quickbooks.accounts", "invoices.quickbooks", "invoices.exports"],
    keywords: ["quickbooks", "qbo", "intuit", "accounting", "bills", "client id", "client secret", "oauth", "connect", "xero", "bookkeeper"],
  },
  {
    id: "settings.quickbooks",
    area: "settings",
    route: "/settings/quickbooks",
    title: "QuickBooks",
    body: "Managing QuickBooks: which company is connected, where bills go, sending automatically, which vendor each supplier is, and anything that went wrong. Test and Disconnect are here too.",
    related: ["settings.connections.quickbooks", "settings.quickbooks.sending", "settings.quickbooks.vendors"],
    keywords: ["quickbooks", "qbo", "disconnect", "bills"],
  },
  {
    id: "settings.quickbooks.connection",
    area: "settings",
    route: "/settings/quickbooks",
    title: "QuickBooks connection",
    body: "The QuickBooks company bills go to, and whether it's the real one or a test company. Test connection checks QuickBooks still answers. Disconnect stops sending; bills already sent stay in QuickBooks.",
    related: ["settings.connections.quickbooks"],
  },
  {
    id: "settings.quickbooks.accounts",
    area: "settings",
    route: "/settings/quickbooks",
    title: "Choose accounts",
    body: "Pick the account bills go to (usually Cost of Goods Sold). Optionally pick one per ingredient category, like beer to a beverage account. Each bill gets one line per account, plus fees and tax when the total says so.",
    related: ["settings.quickbooks.vendors", "invoices.exports"],
    keywords: ["chart of accounts", "cogs", "expense account", "category"],
  },
  {
    id: "settings.quickbooks.sending",
    area: "settings",
    route: "/settings/quickbooks",
    title: "Sending bills",
    body: "With Send automatically on, each invoice goes to QuickBooks the moment it's approved. Only invoices dated from the date you pick are sent, so bills already typed into QuickBooks aren't doubled. Send all catches up the rest.",
    related: ["invoices.quickbooks", "settings.quickbooks.accounts"],
    keywords: ["auto send", "automatic", "bulk", "send all"],
  },
  {
    id: "settings.quickbooks.vendors",
    area: "settings",
    route: "/settings/quickbooks",
    title: "Suppliers and vendors",
    body: "Each supplier is a vendor in QuickBooks. Leave it unset and it's matched by name, or created, the first time an invoice is sent. You can also give a supplier its own account, like a brewery to beer purchases.",
    related: ["settings.quickbooks.accounts"],
    keywords: ["vendor", "supplier", "match"],
  },
  {
    id: "settings.quickbooks.problems",
    area: "settings",
    route: "/settings/quickbooks",
    title: "Recent problems",
    body: "The last 20 things QuickBooks refused, newest first, in plain English. Fix the cause, then press Send again on the invoice. Clear empties the list.",
  },
  {
    id: "invoices.quickbooks",
    area: "invoices",
    route: "/invoices",
    title: "Send to QuickBooks",
    body: "Once approved, an invoice can go to QuickBooks as a bill with its photo attached. Sending again updates the same bill. A bill with a payment against it, or one typed in by hand, is never changed.",
    related: ["settings.quickbooks.sending", "settings.connections.quickbooks"],
    keywords: ["quickbooks", "bill", "send", "accounting"],
  },
  {
    id: "invoices.quickbooks.waiting",
    area: "invoices",
    route: "/invoices",
    title: "Waiting for QuickBooks",
    body: "Approved invoices that haven't gone to QuickBooks yet (dated from the send-from date on the QuickBooks page). Send all sends them one by one; anything QuickBooks refuses is listed with the reason.",
    related: ["settings.quickbooks.sending"],
  },
];
