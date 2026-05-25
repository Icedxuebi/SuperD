import { DuplicateFinder } from "@/components/DuplicateFinder";

export const metadata = { title: "Check Duplicate Tax ID — Secret D" };

export default function DuplicateTaxIdPage() {
  return (
    <DuplicateFinder
      mode="tax_id"
      apiPath="/api/duplicate-tax-id"
      title="Check Duplicate Tax ID"
      subtitle="Merchants whose Tax ID / Citizen ID is shared by another merchant. Merchants with a blank Tax ID are excluded."
      exportFilename="DuplicateTaxID"
    />
  );
}
