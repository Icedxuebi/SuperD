import Image from "next/image";
import Link from "next/link";
import { NavDropdown, type NavItem } from "./NavDropdown";

const applicationSupport: NavItem[] = [
  { label: "Merchant Lookup", href: "/application-support/merchant-lookup" },
  { label: "Merchant Status by AE", href: "/application-support/merchant-status-by-ae" },
  { label: "Payment Status", href: "/application-support/payment-status" },
  { label: "Generate Top 5 Report", href: "/application-support/generate-top5-report" },
  { label: "User Management" },
];

const operation: NavItem[] = [
  { label: "Check Duplicate Tax ID", href: "/operation/duplicate-tax-id" },
  { label: "Check Duplicate Phone Number", href: "/operation/duplicate-phone" },
  { label: "Onboarding Queue" },
  { label: "Reconciliation" },
];

const riskManagement: NavItem[] = [
  { label: "Police Case Query", href: "/risk-management/police-case" },
  { label: "Top Merchant Transaction", href: "/risk-management/top-100-merchants" },
  { label: "No Transaction 90 / 120", href: "/risk-management/no-transaction" },
  { label: "Blacklist" },
  { label: "Fraud Monitoring" },
];

const finance: NavItem[] = [
  { label: "Settlement Reports" },
  { label: "Commission" },
];

export function Header() {
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
          <NavDropdown label="Finance" items={finance} />
        </nav>
      </div>
    </header>
  );
}
