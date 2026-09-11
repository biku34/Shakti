import { ok, errorResponse } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    await clearSessionCookie();
    return ok({ loggedOut: true });
  } catch (err) {
    return errorResponse(err);
  }
}
