import { NextResponse } from "next/server";
import { Packer } from "docx";
import { getPool } from "@/lib/db";
import {
  buildTop5DailyReport,
  type Top5DailyReportData,
} from "@/lib/docx/Top5DailyReport";
import { reportFilename } from "@/lib/docx/thai-date";
import { findSigner, signaturePath, SUPPORT_TITLE } from "@/lib/docx/signers";
import { emptyFormBInput, type FormBInput } from "@/lib/form-b";
import { emptyLastPageInput, type LastPageInput } from "@/lib/last-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TOP5_SQL = `
SELECT
    mi.merchant_no       AS mid,
    mi.merchant_name_en  AS merchant_name,
    pi.partner_no        AS partner,
    SUM(pt.amount)       AS amount
FROM payment_transaction pt
JOIN merchant_info mi ON mi.id = pt.merchant_id
LEFT JOIN partner_info pi ON pi.id = mi.partner_id
WHERE pt.payment_date >= $1::date
  AND pt.payment_date <  ($1::date + INTERVAL '1 day')
GROUP BY mi.merchant_no, mi.merchant_name_en, pi.partner_no
ORDER BY amount DESC
LIMIT 5;
`;

interface SignerSelection {
  signerId: string;
  titleOverride?: string;
}

interface Body {
  reportDateIso: string;
  signingDateIso: string;
  orderTest: {
    rank: number;
    orderDateIso: string;
    productName: string;
    productAmount: string;
  };
  orderStatus: {
    status: string;
    trackingNumber: string;
    carrierName: string;
    deliveredDate: string;
  };
  preparer: SignerSelection;
  reviewer: SignerSelection;
  acknowledger: {
    name: string;
    title: string;
  };
  forms?: Partial<FormBInput>[];
  lastPage?: Partial<LastPageInput>;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function loadTop5(dateIso: string) {
  const pool = getPool();
  const result = await pool.query<{
    mid: string;
    merchant_name: string;
    partner: string | null;
    amount: string;
  }>(TOP5_SQL, [dateIso]);
  return result.rows.map((r) => ({
    mid: r.mid,
    merchantName: r.merchant_name,
    partner: r.partner,
    totalAmount: Number(r.amount),
  }));
}

function resolveSigner(sel: SignerSelection) {
  const s = findSigner(sel.signerId);
  if (!s) return null;
  return {
    name: s.name,
    title: sel.titleOverride || SUPPORT_TITLE,
    signaturePath: signaturePath(s.signatureFilename),
  };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.reportDateIso || !DATE_RE.test(body.reportDateIso)) {
    return NextResponse.json(
      { error: "reportDateIso is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const preparer = resolveSigner(body.preparer);
  const reviewer = resolveSigner(body.reviewer);
  if (!preparer || !reviewer) {
    return NextResponse.json(
      { error: "Unknown preparer or reviewer signerId" },
      { status: 400 },
    );
  }

  let merchants;
  try {
    merchants = await loadTop5(body.reportDateIso);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    console.error("[/api/top100/generate-report]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!merchants || merchants.length === 0) {
    return NextResponse.json(
      { error: `No merchant data found for ${body.reportDateIso}.` },
      { status: 404 },
    );
  }

  const top5 = merchants.map((m, idx) => ({
    rank: idx + 1,
    ae: m.partner ?? "",
    mid: m.mid,
    merchantName: m.merchantName,
    amount: formatAmount(m.totalAmount),
  }));

  const testRank = Math.min(Math.max(body.orderTest.rank ?? 5, 1), top5.length);
  const testRow = top5[testRank - 1];

  const forms: FormBInput[] = top5.map((m) => {
    const base = emptyFormBInput(
      { rank: m.rank, merchantName: m.merchantName, ae: m.ae, mid: m.mid },
      body.reportDateIso,
    );
    const supplied = body.forms?.find((f) => f?.rank === m.rank);
    if (!supplied) return base;
    return {
      ...base,
      ...supplied,
      rank: m.rank,
      merchantName: m.merchantName,
      ae: m.ae,
      mid: m.mid,
      items:
        supplied.items && supplied.items.length === 10 ? supplied.items : base.items,
    };
  });

  const data: Top5DailyReportData = {
    reportDateIso: body.reportDateIso,
    signingDateIso: body.signingDateIso || body.reportDateIso,
    top5,
    selectedRank: testRank,
    orderTest: {
      rank: testRank,
      orderDateIso: body.orderTest.orderDateIso || body.reportDateIso,
      mid: testRow.mid,
      merchantName: testRow.merchantName,
      productName: body.orderTest.productName || "-",
      productAmount: body.orderTest.productAmount || "-",
    },
    orderStatus: {
      rank: testRank,
      status: body.orderStatus.status || "-",
      trackingNumber: body.orderStatus.trackingNumber || "-",
      carrierName: body.orderStatus.carrierName || "-",
      deliveredDate: body.orderStatus.deliveredDate || "-",
    },
    preparer,
    reviewer,
    acknowledger: {
      name: body.acknowledger.name,
      title: body.acknowledger.title,
    },
    forms,
    lastPage: { ...emptyLastPageInput(), ...(body.lastPage ?? {}) },
  };

  const doc = buildTop5DailyReport(data);
  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${reportFilename(body.reportDateIso)}"`,
      "Cache-Control": "no-store",
    },
  });
}
