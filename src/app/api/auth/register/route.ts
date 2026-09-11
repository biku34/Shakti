import { z } from "zod";
import { connectDB } from "@/lib/db";
import { ok, fail, parseBody, errorResponse } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { UserModel } from "@/models/User";
import { audit } from "@/services/audit";

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  feederId: z.string().optional(),
});

// FR-1.1 / FR-1.4: register with a role; prosumers & consumers bind to a feeder.
export async function POST(req: Request) {
  try {
    await connectDB();
    const body = await parseBody(req, schema);

    if (["prosumer", "consumer"].includes(body.role) && !body.feederId) {
      return fail(400, "prosumer/consumer must specify a feederId");
    }

    const exists = await UserModel.findOne({ email: body.email.toLowerCase() });
    if (exists) return fail(409, "Email already registered");

    const user = await UserModel.create({
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      role: body.role,
      feederId: body.feederId ?? null,
    });

    await setSessionCookie({
      userId: String(user._id),
      role: user.role,
      feederId: user.feederId ? String(user.feederId) : null,
    });
    await audit(String(user._id), "auth.register", { type: "user", id: String(user._id) }, {
      role: user.role,
    });

    return ok({ id: String(user._id), role: user.role, name: user.name });
  } catch (err) {
    return errorResponse(err);
  }
}
