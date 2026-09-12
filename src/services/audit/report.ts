/**
 * Consolidated auditor report (FR-10.3).
 *
 * One row per REC certificate — enriched with the human-readable parties
 * (generator, current holder, meter, feeder), the generation window, credits,
 * on-chain anchor references and a compact lifecycle summary — optionally
 * scoped to an issuance-date range. Shared by the download route and the
 * emailed report so both stay byte-for-byte identical.
 */
import { connectDB } from "@/lib/db";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { UserModel } from "@/models/User";
import { MeterModel } from "@/models/Meter";
import { FeederModel } from "@/models/Feeder";

export type ReportRange = { from?: Date | null; to?: Date | null };

export type ReportRow = {
  serial: string;
  status: string;
  generator: string;
  currentHolder: string;
  meterCode: string;
  feederCode: string;
  energyMwh: number;
  generationFrom: string;
  generationTo: string;
  creditsAwarded: number;
  lifecycle: string;
  issueTxHash: string;
  contentHash: string;
  issuedAt: string;
};

export type Report = {
  generatedAt: string;
  range: { from: string | null; to: string | null };
  totals: { recs: number; issued: number; revoked: number; energyMwh: number; creditsAwarded: number };
  rows: ReportRow[];
};

const REPORT_COLUMNS: { key: keyof ReportRow; label: string }[] = [
  { key: "serial", label: "Serial" },
  { key: "status", label: "Status" },
  { key: "generator", label: "Generator" },
  { key: "currentHolder", label: "Current holder" },
  { key: "meterCode", label: "Meter" },
  { key: "feederCode", label: "Feeder" },
  { key: "energyMwh", label: "Energy (MWh)" },
  { key: "generationFrom", label: "Generation from" },
  { key: "generationTo", label: "Generation to" },
  { key: "creditsAwarded", label: "Credits awarded" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "issueTxHash", label: "Issue tx" },
  { key: "contentHash", label: "Content hash" },
  { key: "issuedAt", label: "Issued at" },
];

/** Build the consolidated report, filtered to RECs issued within [from, to]. */
export async function buildAuditReport(range: ReportRange): Promise<Report> {
  await connectDB();

  const createdAt: Record<string, Date> = {};
  if (range.from) createdAt.$gte = range.from;
  if (range.to) createdAt.$lte = range.to;
  const filter = Object.keys(createdAt).length ? { createdAt } : {};

  const recs = await RecCertificateModel.find(filter).sort({ createdAt: -1 }).limit(2000).lean();
  const recIds = recs.map((r) => r._id);

  // Resolve the referenced parties in bulk (avoids N populate round-trips).
  const [users, meters, feeders, txns] = await Promise.all([
    UserModel.find({
      _id: { $in: recs.flatMap((r) => [r.generatorId, r.currentHolderId]) },
    })
      .select("name")
      .lean(),
    MeterModel.find({ _id: { $in: recs.map((r) => r.meterId) } }).select("code").lean(),
    FeederModel.find({ _id: { $in: recs.map((r) => r.feederId) } }).select("code").lean(),
    RecTransactionModel.find({ recId: { $in: recIds } }).sort({ timestamp: 1 }).lean(),
  ]);

  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const meterCode = new Map(meters.map((m) => [String(m._id), m.code]));
  const feederCode = new Map(feeders.map((f) => [String(f._id), f.code]));
  const lifecycle = new Map<string, string[]>();
  for (const t of txns) {
    const k = String(t.recId);
    (lifecycle.get(k) ?? lifecycle.set(k, []).get(k)!).push(t.action);
  }

  const rows: ReportRow[] = recs.map((r) => ({
    serial: r.serial,
    status: r.status,
    generator: userName.get(String(r.generatorId)) ?? String(r.generatorId),
    currentHolder: userName.get(String(r.currentHolderId)) ?? String(r.currentHolderId),
    meterCode: meterCode.get(String(r.meterId)) ?? String(r.meterId),
    feederCode: feederCode.get(String(r.feederId)) ?? String(r.feederId),
    energyMwh: r.energyMwh,
    generationFrom: r.generationWindow?.from ? new Date(r.generationWindow?.from as Date).toISOString() : "",
    generationTo: r.generationWindow?.to ? new Date(r.generationWindow?.to as Date).toISOString() : "",
    creditsAwarded: r.creditsAwarded ?? 0,
    lifecycle: (lifecycle.get(String(r._id)) ?? []).join(" → ") || "—",
    issueTxHash: r.issueTxHash ?? "",
    contentHash: r.contentHash ?? "",
    issuedAt: new Date(r.createdAt as Date).toISOString(),
  }));

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    totals: {
      recs: rows.length,
      issued: rows.filter((r) => r.status === "issued").length,
      revoked: rows.filter((r) => r.status === "revoked").length,
      energyMwh: round(rows.reduce((s, r) => s + r.energyMwh, 0)),
      creditsAwarded: round(rows.reduce((s, r) => s + r.creditsAwarded, 0)),
    },
    rows,
  };
}

/** Render the report as CSV (RFC-4180 quoting). */
export function reportToCsv(report: Report): string {
  const header = REPORT_COLUMNS.map((c) => c.label).join(",");
  const body = report.rows
    .map((row) => REPORT_COLUMNS.map((c) => csvCell(row[c.key])).join(","))
    .join("\n");
  return header + "\n" + body + "\n";
}

/** Render a compact HTML summary + table for the emailed report. */
export function reportToHtml(report: Report): string {
  const rangeLabel =
    report.range.from || report.range.to
      ? `${fmtDate(report.range.from) || "start"} → ${fmtDate(report.range.to) || "now"}`
      : "All records";
  const head = REPORT_COLUMNS.map((c) => `<th style="${TH}">${c.label}</th>`).join("");
  const rows = report.rows
    .map(
      (row) =>
        `<tr>${REPORT_COLUMNS.map((c) => `<td style="${TD}">${esc(String(row[c.key]))}</td>`).join("")}</tr>`,
    )
    .join("");

  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a">
  <h2 style="margin:0 0 4px">Shakti — REC audit report</h2>
  <p style="margin:0 0 16px;color:#666;font-size:13px">Period: ${esc(rangeLabel)} · Generated ${esc(fmtDate(report.generatedAt) || "")}</p>
  <table style="border-collapse:collapse;margin-bottom:16px;font-size:13px">
    <tr>
      <td style="${TD}"><b>${report.totals.recs}</b> RECs</td>
      <td style="${TD}"><b>${report.totals.issued}</b> issued</td>
      <td style="${TD}"><b>${report.totals.revoked}</b> revoked</td>
      <td style="${TD}"><b>${report.totals.energyMwh}</b> MWh</td>
      <td style="${TD}"><b>${report.totals.creditsAwarded}</b> credits</td>
    </tr>
  </table>
  <table style="border-collapse:collapse;font-size:12px;width:100%"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
  <p style="margin-top:16px;color:#999;font-size:11px">Full data attached as CSV. Automated report from the Shakti Renewable Energy Intelligence platform.</p>
</div>`;
}

const TH = "text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;background:#f6f6f6;white-space:nowrap";
const TD = "padding:5px 10px;border-bottom:1px solid #eee;white-space:nowrap";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
