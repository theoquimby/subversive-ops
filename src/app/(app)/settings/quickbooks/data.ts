import "server-only";
import { billAccounts, defaultBillAccount, missingAccounts, suggestAccount, type QboAccount } from "@/domain/quickbooks";
import { ingredientCategories, loadAccounts } from "@/server/services/accounting";
import {
  effectiveSendFrom,
  pendingInvoices,
  quickbooksAccounts,
  quickbooksProblems,
  quickbooksStatus,
  quickbooksVendors,
  supplierVendors,
  type QuickBooksProblem,
  type QuickBooksStatus,
  type SupplierVendorRow,
} from "@/server/services/quickbooks";

/** Everything the QuickBooks guide and the QuickBooks page show — no secrets. */
export interface QuickBooksData {
  status: QuickBooksStatus;
  accounts: QboAccount[];
  accountsAt: string | null;
  categories: string[];
  suggestions: Record<string, string>;
  defaultSuggestion: string | null;
  missing: string[];
  suppliers: SupplierVendorRow[];
  vendors: { id: string; name: string }[];
  waiting: number;
  sendFrom: string;
  termsDays: number;
  problems: QuickBooksProblem[];
}

export async function loadQuickBooksData(): Promise<QuickBooksData> {
  const [status, problems, terms] = await Promise.all([quickbooksStatus(), quickbooksProblems(), loadAccounts()]);
  const sendFrom = effectiveSendFrom(status.mapping, status.connectedAt);
  const base: QuickBooksData = { status, accounts: [], accountsAt: null, categories: [], suggestions: {}, defaultSuggestion: null, missing: [], suppliers: [], vendors: [], waiting: 0, sendFrom, termsDays: terms.termsDays, problems };
  if (!status.connected) return base;
  const [{ accounts, at }, categories, suppliers, { vendors }, waiting] = await Promise.all([quickbooksAccounts(), ingredientCategories(), supplierVendors(), quickbooksVendors(), pendingInvoices()]);
  const usable = billAccounts(accounts);
  const def = defaultBillAccount(accounts)?.id ?? null;
  const suggestions: Record<string, string> = {};
  for (const c of categories) {
    const s = suggestAccount(c, accounts)?.id;
    if (s && s !== (status.mapping.defaultAccountId ?? def)) suggestions[c] = s;
  }
  return {
    ...base,
    accounts: usable,
    accountsAt: at,
    categories,
    suggestions,
    defaultSuggestion: def,
    missing: at ? missingAccounts(status.mapping, accounts) : [],
    suppliers,
    vendors: vendors.map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    waiting: waiting.length,
  };
}
