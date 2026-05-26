// Shared parser for the bulk Ref1/Ref2 textareas on the Payment Status and
// Transfer Status pages. Splits on newlines and strips wrapping double quotes
// — Excel often pastes a single text column as `"00CIMB260513047185"`, and a
// trailing empty cell shows up as `""`, which we want to drop.
export function parseRefs(input: unknown): string[] {
  const lines =
    typeof input === "string"
      ? input.split(/\r?\n/)
      : Array.isArray(input)
        ? input.map((s) => String(s))
        : [];

  return lines
    .map((s) => s.trim().replace(/^"+|"+$/g, "").trim())
    .filter((s) => s.length > 0);
}
