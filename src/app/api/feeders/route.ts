import { connectDB } from "@/lib/db";
import { ok, errorResponse } from "@/lib/api";
import { FeederModel } from "@/models/Feeder";

// Public minimal feeder list — needed by the registration screen (feeder picker)
// and for general locality display. No sensitive data exposed.
export async function GET() {
  try {
    await connectDB();
    const feeders = await FeederModel.find()
      .select("code name location capacityKw currentLoadKw congestionLevel")
      .sort({ code: 1 });
    return ok(feeders);
  } catch (err) {
    return errorResponse(err);
  }
}
