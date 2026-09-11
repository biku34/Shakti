import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TradeModel } from "@/models/Trade";
import { RecCertificateModel } from "@/models/RecCertificate";
import { FraudAlertModel } from "@/models/FraudAlert";

// FR-10.1 / §6.11: market-wide overview for the regulator.
export async function GET() {
  try {
    await requireRole("regulator");
    await connectDB();

    const [tradeAgg, recCounts, alertCounts] = await Promise.all([
      TradeModel.aggregate([
        { $match: { status: "settled" } },
        {
          $group: {
            _id: null,
            trades: { $sum: 1 },
            energyKwh: { $sum: "$quantityKwh" },
            credits: { $sum: "$totalCredits" },
          },
        },
      ]),
      RecCertificateModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      FraudAlertModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const trades = tradeAgg[0] ?? { trades: 0, energyKwh: 0, credits: 0 };
    const recsByStatus = Object.fromEntries(recCounts.map((r) => [r._id, r.count]));
    const alertsByStatus = Object.fromEntries(alertCounts.map((r) => [r._id, r.count]));

    return ok({
      settledTrades: trades.trades,
      tradedEnergyKwh: Number((trades.energyKwh ?? 0).toFixed(3)),
      tradedCredits: Number((trades.credits ?? 0).toFixed(2)),
      recsByStatus,
      alertsByStatus,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
