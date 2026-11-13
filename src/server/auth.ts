import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { env } from "./env";
import { Session, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./session";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
// Compared against when the name is unknown, so both paths take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-pin", 10);

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, env.SESSION_SECRET);
}

/** For pages/actions: require a signed-in user, optionally a manager. */
export async function requireUser(role?: "MANAGER"): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (role === "MANAGER" && s.role !== "MANAGER") redirect("/count");
  return s;
}

export type LoginResult = { ok: true; role: Session["role"] } | { ok: false; error: string };

export async function loginWithPin(name: string, pin: string): Promise<LoginResult> {
  const user = await db.user.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" }, active: true } });
  // Same message for unknown user and wrong PIN.
  const fail: LoginResult = { ok: false, error: "That name and PIN don't match." };
  if (!user) {
    await bcrypt.compare(pin, DUMMY_HASH);
    return fail;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: `Too many tries. Try again in a few minutes.` };
  }
  const ok = await bcrypt.compare(pin, user.pinHash);
  if (!ok) {
    const attempts = user.failedPinAttempts + 1;
    await db.user.update({
      where: { id: user.id },
      data: attempts >= MAX_ATTEMPTS
        ? { failedPinAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedPinAttempts: attempts },
    });
    return fail;
  }
  await db.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
  await startSession(user);
  return { ok: true, role: user.role };
}

async function startSession(user: { id: string; name: string; role: Session["role"] }) {
  const token = await signSession({ userId: user.id, name: user.name, role: user.role }, env.SESSION_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** First run only: when there are no users at all, the first person becomes the manager. */
export async function createFirstManager(name: string, pin: string): Promise<LoginResult> {
  const user = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return null;
    return tx.user.create({ data: { name: name.trim(), role: "MANAGER", pinHash: await hashPin(pin) } });
  });
  if (!user) return { ok: false, error: "Setup is already done — sign in instead." };
  await startSession(user);
  return { ok: true, role: user.role };
}

export const hasAnyUser = async () => (await db.user.count()) > 0;

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const hashPin = (pin: string) => bcrypt.hash(pin, 10);
