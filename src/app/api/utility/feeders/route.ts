import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { FeederModel } from "@/models/Feeder";

// FR-9.1: per-feeder load, congestion and capacity.
export async function GET() {
  try {
    await requireRole("utility", "regulator");
    await connectDB();
    const feeders = await FeederModel.find().sort({ code: 1 });
    return ok(feeders);
  } catch (err) {
    return errorResponse(err);
  }
}
