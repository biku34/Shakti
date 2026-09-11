import { connectDB } from "@/lib/db";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { RecTransactionModel } from "@/models/RecTransaction";
import { BlockchainAnchorModel } from "@/models/BlockchainAnchor";

// FR-10.3: export an audit trail (JSON default, ?format=csv) including on-chain refs.
export async function GET(req: Request) {
  try {
    await requireRole("auditor");
    await connectDB();
    const format = new URL(req.url).searchParams.get("format") ?? "json";

    const txns = await RecTransactionModel.find().sort({ timestamp: 1 }).lean();
    const anchors = await BlockchainAnchorModel.find().lean();
    const anchorByRef = new Map(anchors.map((a) => [String(a.refId), a]));

    const rows = txns.map((t) => ({
      recId: String(t.recId),
      action: t.action,
      fromId: t.fromId ? String(t.fromId) : "",
      toId: t.toId ? String(t.toId) : "",
      anchorTxHash: t.anchorTxHash ?? "",
      contentHash: anchorByRef.get(String(t.recId))?.contentHash ?? "",
      timestamp: new Date(t.timestamp as Date).toISOString(),
    }));

    if (format === "csv") {
      const header = "recId,action,fromId,toId,anchorTxHash,contentHash,timestamp";
      const body = rows
        .map((r) => [r.recId, r.action, r.fromId, r.toId, r.anchorTxHash, r.contentHash, r.timestamp].join(","))
        .join("\n");
      return new Response(header + "\n" + body, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="audit-trail.csv"',
        },
      });
    }

    return Response.json({ ok: true, data: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
