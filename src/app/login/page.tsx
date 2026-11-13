import { hasAnyUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const firstRun = !(await hasAnyUser());
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-ink">S</span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Subversive Ops</h1>
          <p className="mt-1 text-sm text-muted">{firstRun ? "Welcome! Create the first manager account." : "Sign in with your name and PIN."}</p>
        </div>
        <LoginForm firstRun={firstRun} />
      </div>
    </main>
  );
}
