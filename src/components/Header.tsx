import Image from "next/image";
import Link from "next/link";
import { NavDropdown, type NavItem } from "./NavDropdown";
import { LogoutButton } from "./LogoutButton";
import { getCurrentUsername } from "@/lib/current-user";

const applicationSupport: NavItem[] = [
  { label: "Merchant Lookup", href: "/application-support/merchant-lookup" },
  { label: "Merchant Status by AE", href: "/application-support/merchant-status-by-ae" },
  { label: "Locked Accounts", href: "/application-support/locked-accounts" },
  { label: "Payment Status", href: "/application-support/payment-status" },
  { label: "Transfer Status", href: "/application-support/transfer-status" },
  { label: "Generate Top 5 Report", href: "/application-support/generate-top5-report" },
  { label: "Ticket Dashboard", href: "/application-support/ticket-dashboard" },
];

const operation: NavItem[] = [
  { label: "Check Duplicate Tax ID", href: "/operation/duplicate-tax-id" },
  { label: "Check Duplicate Phone Number", href: "/operation/duplicate-phone" },
  { label: "Onboarding Funnel", href: "/operation/onboarding-funnel" },
];

const riskManagement: NavItem[] = [
  { label: "Police Case Query", href: "/risk-management/police-case" },
  { label: "Top Merchant Transaction", href: "/risk-management/top-100-merchants" },
  { label: "No Transaction 90 / 120", href: "/risk-management/no-transaction" },
  { label: "Spender History", href: "/risk-management/spender-history" },
  { label: "Top Spender", href: "/risk-management/top-spender" },
  { label: "Fraud Monitoring Feed", href: "/risk-management/fraud-monitoring" },
  { label: "Blacklist Hit Report", href: "/risk-management/blacklist-hits" },
  { label: "KYC / CDD Period Review", href: "/risk-management/kyc-cdd-review" },
  { label: "Partner & Merchant Risk", href: "/risk-management/partner-merchant-risk" },
];

const cfr: NavItem[] = [
  { label: "Money Trace", href: "/cfr/money-trace" },
];

export async function Header() {
  const username = await getCurrentUsername();
  return (
    <header className="bg-white border-b border-slate-200/80 shadow-card sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-2">
        <Link href="/" className="flex items-center mr-4" aria-label="Anypay home">
          <Image
            src="/getsitelogo.png"
            alt="Anypay"
            width={140}
            height={52}
            priority
            className="h-9 w-auto"
          />
        </Link>

        <nav className="flex items-center gap-1">
          <NavDropdown label="Application Support" items={applicationSupport} />
          <NavDropdown label="Operation" items={operation} />
          <NavDropdown label="Risk Management" items={riskManagement} />
          <NavDropdown label="CFR" items={cfr} />
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/account"
            className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5"
            title="Account & profile"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0116 0" />
            </svg>
            <span className="max-w-[140px] truncate">{username ?? "Account"}</span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
