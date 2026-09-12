import { errorResponse, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { buildAuditReport, reportToCsv } from "@/services/audit/report";

/** Parse ?from / ?to (YYYY-MM-DD or ISO) into a date range. `to` is end-of-day inclusive. */
function rangeFromQuery(url: URL): { from: Date | null; to: Date | null } {
  const parse = (v: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = parse(url.searchParams.get("from"));
  const to = parse(url.searchParams.get("to"));
  // A bare date (no time) means "through the end of that day".
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") ?? "")) {
    to.setHours(23, 59, 59, 999);
  }
  return { from, to };
}

// FR-10.3: consolidated auditor report, optionally scoped to an issuance-date range.
export async function GET(req: Request) {
  try {
    await requireRole("auditor", "regulator");
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "json";
    const report = await buildAuditReport(rangeFromQuery(url));

    if (format === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(reportToCsv(report), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="rec-audit-report-${stamp}.csv"`,
        },
      });
    }
    return ok(report);
  } catch (err) {
    return errorResponse(err);
  }
}
