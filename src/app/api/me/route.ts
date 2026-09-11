import { connectDB } from "@/lib/db";
import { ok, fail, errorResponse } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { UserModel } from "@/models/User";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return fail(401, "Not authenticated");
    await connectDB();
    const user = await UserModel.findById(session.userId).select("-passwordHash");
    if (!user) return fail(404, "User not found");
    return ok(user);
  } catch (err) {
    return errorResponse(err);
  }
}
