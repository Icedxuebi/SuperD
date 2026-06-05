"use client";

import { usePathname } from "next/navigation";

// Wraps page content in the standard chrome (sticky header + max-w-7xl main),
// except on /login where the page renders its own full-bleed layout. The header
// is passed in as a prop so Next can render the async server Header upstream.
export function Shell({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <>
      {header}
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </>
  );
}
