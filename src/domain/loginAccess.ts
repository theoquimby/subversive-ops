/**
 * Whether a login may be used, given the employee record it belongs to.
 * Staff who were switched off as employees (on Team, or by the Square team
 * sync when they leave) lose their PIN login too. Managers are left alone:
 * a Square sync must never lock the owner or a manager out, and managers are
 * switched off on purpose in Settings → People.
 */
export function loginAllowed(role: "MANAGER" | "STAFF", employeeActive: boolean | null): boolean {
  if (role === "MANAGER") return true;
  return employeeActive !== false;
}
