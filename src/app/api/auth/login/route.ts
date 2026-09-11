import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { UserModel } from "@/models/User";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// FR-1.2: authenticate and issue a session cookie.
export async function POST(req: Request) {
  try {
    await connectDB();
    const { email, password } = await parseBody(req, schema);

    const user = await UserModel.findOne({ email: email.toLowerCase() });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail(401, "Invalid credentials");
    }
    if (user.status === "suspended") return fail(403, "Account suspended");

    await setSessionCookie({
      userId: String(user._id),
      role: user.role,
      feederId: user.feederId ? String(user.feederId) : null,
    });

    return ok({ id: String(user._id), role: user.role, name: user.name });
  } catch (err) {
    return errorResponse(err);
  }
}
