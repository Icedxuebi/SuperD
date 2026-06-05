import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — Super D" };

// `from` is restricted to same-origin paths to prevent open-redirect.
function safeRedirect(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/";
  return from;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const sp = await searchParams;
  const target = safeRedirect(sp.from);

  const secret = process.env.AUTH_SECRET;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (secret && token) {
    const session = await verifySession(token, secret);
    if (session) redirect(target);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md">
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-card p-8">
          <div className="flex flex-col items-center mb-7">
            <Image
              src="/getsitelogo.png"
              alt="Anypay"
              width={180}
              height={54}
              priority
              className="h-12 w-auto mb-5"
            />
            <h1 className="text-2xl font-bold text-slate-900">Super D</h1>
            <p className="text-sm text-slate-500 mt-1">Internal tools — sign in to continue</p>
          </div>

          <LoginForm redirectTo={target} />

          <p className="mt-6 text-xs text-center text-slate-400">
            Anypay staff only.
          </p>
        </div>
      </div>
    </div>
  );
}
