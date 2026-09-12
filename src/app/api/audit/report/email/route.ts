import { z } from "zod";
import { errorResponse, fail, ok, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { env } from "@/lib/env";
import { buildAuditReport, reportToCsv, reportToHtml } from "@/services/audit/report";

const bodySchema = z.object({
  recipient: z.string().email(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function parseRange(from?: string, to?: string) {
  const parse = (v?: string) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const toDate = parse(to);
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) toDate.setHours(23, 59, 59, 999);
  return { from: parse(from), to: toDate };
}

// FR-10.3: email the consolidated auditor report (HTML summary + CSV attachment) via Resend.
export async function POST(req: Request) {
  try {
    await requireRole("auditor", "regulator");
    const { recipient, from, to } = await parseBody(req, bodySchema);

    const apiKey = env.resendApiKey();
    if (!apiKey) {
      // Resend not configured yet — surface a clear, actionable message.
      return fail(503, "Email is not configured. Set RESEND_API_KEY (and optionally RESEND_FROM) to enable it.");
    }

    const report = await buildAuditReport(parseRange(from, to));
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = reportToCsv(report);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.resendFrom(),
        to: recipient,
        subject: `Shakti REC audit report — ${report.totals.recs} RECs (${stamp})`,
        html: reportToHtml(report),
        attachments: [
          {
            filename: `rec-audit-report-${stamp}.csv`,
            content: Buffer.from(csv, "utf8").toString("base64"),
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return fail(502, `Resend rejected the request (${res.status}). ${detail.slice(0, 300)}`);
    }

    const sent = (await res.json().catch(() => ({}))) as { id?: string };
    return ok({ sent: true, id: sent.id ?? null, recipient, recs: report.totals.recs });
  } catch (err) {
    return errorResponse(err);
  }
}
