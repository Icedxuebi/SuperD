import { getCurrentUsername } from "@/lib/current-user";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "Account — Super D" };

export default async function AccountPage() {
  // Middleware guarantees the user is signed in; this is just for display.
  const username = (await getCurrentUsername()) ?? "—";

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-1">Account &amp; Profile</h1>
        <p className="text-slate-600">Manage your sign-in details.</p>
      </div>

      <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h2 className="text-lg font-semibold text-slate-800">Profile</h2>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[140px,1fr] gap-y-2 gap-x-4 text-sm">
          <dt className="text-slate-500">Username</dt>
          <dd className="font-mono text-slate-900">{username}</dd>
        </dl>
      </section>

      <section className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block w-1 h-5 rounded-full bg-brand-600" />
          <h2 className="text-lg font-semibold text-slate-800">Change password</h2>
        </div>
        <PasswordForm />
      </section>
    </div>
  );
}
