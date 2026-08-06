# Transaction Summary Tool

Builds a Thai-format **Summary** workbook from a raw transaction export (.xlsx).

Produces three tables, matching the standard appendix layout:

1. **จากไฟล์ Transaction ตั้งแต่เปิดร้านจนถึงปิดร้าน** — headline figures
2. **สรุปธุรกรรม** — In / Out / รวม / ส่วนต่าง
3. **สรุปรายเดือน** — month-by-month breakdown, Thai month names + Buddhist-era years

The source workbook is **never modified**. Output is always a new file.

---

## Requirements

Python 3 with `openpyxl` and `pandas`. Both are already installed on this machine:

```
python -c "import openpyxl, pandas; print(openpyxl.__version__, pandas.__version__)"
```

If missing: `pip install openpyxl pandas`

---

## Quick start

```powershell
cd "C:\Users\EkpitiKawtummachai\Downloads\transaction-summary-tool"

# 1. Look at the file first — sheets, columns, type values, date range
python build_summary.py "..\your-transactions.xlsx" --inspect

# 2. Build the summary
python build_summary.py "..\your-transactions.xlsx"

# 3. Verify it
python verify_summary.py "..\your-transactions.xlsx" "..\your-transactions_Summary.xlsx"
```

Default output path is the source path with `_Summary.xlsx` appended.

> **Run these from PowerShell, not Git Bash.** Git Bash mangles Thai characters
> in command-line arguments and the script will report "source not found".

### The exact command used for the Anti Fatty2 appendix

```powershell
python build_summary.py "C:\Users\EkpitiKawtummachai\Downloads\ภาคผนวก 12-รายการธุรกรรมทั้งหมด_Anti Fatty2_alltypesummary.xlsx"
```

That run produced: 268,566 In / ฿83,327,501.08 and 54,917 Out / ฿82,472,706.03,
net ฿854,795.05 across 13 months (ก.ค. 2568 – ก.ค. 2569).

---

## Merging the Summary into the main workbook

The script writes a small standalone `_Summary.xlsx` — it does not touch the
source. To get the Summary sheet *inside* the big workbook (as was done for the
Anti Fatty2 appendix), do it in Excel:

1. Open both the big workbook and the generated `_Summary.xlsx`.
2. In the `_Summary.xlsx` window, right-click the **Summary** tab →
   **Move or Copy…** → pick the big workbook as *To book* → tick **Create a copy** → OK.
3. Save the big workbook (**Save As** a new name if you want to keep the original).

This is deliberately a manual step. Rewriting a 17.5 MB / 323k-row workbook
programmatically risks disturbing the raw data sheet, and for a legal appendix
that trade-off isn't worth it.

To confirm the merge kept everything, point both arguments of the verifier at
the merged file — it will re-derive the totals from the `All` sheet and check
them against the `Summary` sheet sitting beside it:

```powershell
python verify_summary.py "merged.xlsx" "merged.xlsx"
```

---

## Always run `--inspect` first on a new file

Different exports use different sheet names, column headers, and type values.
`--inspect` writes nothing and tells you what you're dealing with:

```
python build_summary.py "newfile.xlsx" --inspect
```

It prints the sheet list, column headers, row count, date range, number of
unparseable dates, and every distinct `Type` value with its count and sum.
Use that to pick the right `--in-type` / `--out-type`.

---

## Options

| Option | Default | Purpose |
|---|---|---|
| `source` | *(required)* | Path to the source .xlsx |
| `-o, --output` | `<source>_Summary.xlsx` | Output path |
| `--sheet` | `All` | Worksheet holding the raw rows |
| `--date-col` | `Transaction Date` | Date column header |
| `--type-col` | `Type` | Transaction type column header |
| `--amount-col` | `Amount` | Amount column header |
| `--in-type` | `Payment` | Type value counted as money **IN** |
| `--out-type` | `Withdraw` | Type value counted as money **OUT** |
| `--summary-sheet` | `Summary` | Name of the sheet to create |
| `--inspect` | off | Report only, write nothing |

Example with different column names and type values:

```powershell
python build_summary.py "bank_export.xlsx" `
  --sheet "Transactions" --date-col "วันที่" --type-col "ประเภท" --amount-col "จำนวนเงิน" `
  --in-type "รับเงิน" --out-type "โอนออก"
```

---

## Design notes — why it works this way

**Values are static, not Excel formulas.** In the Anti Fatty2 file, 295,962 of
323,483 date cells were stored as *text* and only 27,521 as real datetimes.
`SUMIFS`/`COUNTIFS` with date criteria silently skip text dates, so a
formula-driven monthly table would have under-reported by ~91%. The script
parses both forms in Python instead. Downside: the summary does not auto-update
if the raw data changes — re-run the script.

**Amounts accumulate as `Decimal`**, converted to `float` only when written to a
cell, so totals don't drift from floating-point error.

**The script aborts rather than guess.** If any row has an unparseable date, or
a `Type` value that is neither `--in-type` nor `--out-type`, it exits with a
message and writes nothing. A silently-wrong financial appendix is worse than
no output.

**Block 1 keeps numeric cells.** The "จำนวน" column displays `268,566 รายการ` and
`83,327,501.08 บาท`, but those are real numbers using number formats
`#,##0" รายการ"` and `#,##0.00" บาท"` — so they stay sortable and computable.

**Large files are read in `read_only=True` streaming mode**, which keeps a 17.5 MB
/ 323k-row workbook off the heap. Expect roughly 1–2 minutes for a file that size.

---

## Adding a new date format

If `--inspect` reports unparseable dates, add the pattern to `DATE_FORMATS` near
the top of `build_summary.py` and re-run. Formats already handled:

```
%Y-%m-%d %H:%M:%S      %Y-%m-%d %H:%M:%S.%f    %Y-%m-%dT%H:%M:%S
%Y-%m-%d               %d/%m/%Y %H:%M:%S       %d/%m/%Y
```

Note: dates are assumed to be **Gregorian** in the source. The script adds 543
only when rendering the Thai month labels. If a source file stores Buddhist-era
years, subtract 543 before processing or the labels will be 543 years off.

---

## What `verify_summary.py` checks

1. **Independent cross-check** — re-derives the totals with `pandas.read_excel`,
   a different reader from the one that built the file. Two readers agreeing
   rules out a parsing bug.
2. **Cell dump** — prints every populated cell with its value, number format,
   and bold flag, so you can eyeball that nothing rendered as a stray string.
3. **Internal consistency** — the monthly rows must sum to the monthly total row,
   which must equal the Block 2 In/Out figures, which must equal Block 1.

Exits non-zero if anything fails.

---

## Troubleshooting

**Thai text prints as `?` or garbage in the console.** The scripts reconfigure
stdout to UTF-8 automatically. If your shell still mangles it:
`$env:PYTHONIOENCODING='utf-8'` (PowerShell) before running.

**`ABORT: column 'X' not found`** — headers differ. Run `--inspect` and pass the
right `--date-col` / `--type-col` / `--amount-col`.

**`ABORT: rows with unexpected type values`** — run `--inspect` to list the real
type values, then set `--in-type` / `--out-type`.

**`ABORT: N rows had an unparseable date`** — see "Adding a new date format".

**Permission denied on save** — the output file is open in Excel. Close it.

---

## Files

```
build_summary.py    Build the Summary workbook (main script)
verify_summary.py   Cross-check a generated Summary against the source
README.md           This file
```
