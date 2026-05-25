import { DuplicateFinder } from "@/components/DuplicateFinder";

export const metadata = { title: "Check Duplicate Phone Number — Secret D" };

export default function DuplicatePhonePage() {
  return (
    <DuplicateFinder
      mode="phone_number"
      apiPath="/api/duplicate-phone"
      title="Check Duplicate Phone Number"
      subtitle="Merchants whose phone number is shared by another merchant. Merchants with a blank phone number are excluded."
      exportFilename="DuplicatePhone"
    />
  );
}
