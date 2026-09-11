/**
 * Session + RBAC helpers (FR-1.2, FR-1.3, SEC-2, SEC-3).
 *
 * Sessions are signed JWTs stored in an HTTP-only, secure cookie. Passwords are
 * hashed with bcrypt (SEC-1). RBAC is enforced *server-side* on every route via
 * `requireRole` — client role claims are never trusted.
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "./env";
import type { Role } from "./roles";

export type Session = {
  userId: string;
  role: Role;
  feederId: string | null;
};

const alg = "HS256";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.authSecret());
}

// ─── Passwords (SEC-1) ──────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ─── Session tokens ─────────────────────────────────────────────────
export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ role: session.role, feederId: session.feederId })
    .setProtectedHeader({ alg })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.sessionTtlHours()}h`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || !payload.role) return null;
    return {
      userId: String(payload.sub),
      role: payload.role as Role,
      feederId: (payload.feederId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Cookie plumbing ────────────────────────────────────────────────
export async function setSessionCookie(session: Session): Promise<void> {
  const token = await createSessionToken(session);
  const jar = await cookies();
  jar.set(env.sessionCookie(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.sessionTtlHours() * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(env.sessionCookie());
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(env.sessionCookie())?.value;
  if (!token) return null;
  return readSessionToken(token);
}

// ─── RBAC guard (SEC-3) ─────────────────────────────────────────────
export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Returns the session if the caller is authenticated and (when `allowed` is
 * given) holds one of the allowed roles. Throws AuthError otherwise — route
 * handlers should catch and translate to a JSON error via `errorResponse`.
 */
export async function requireRole(...allowed: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthError(401, "Not authenticated");
  if (allowed.length > 0 && !allowed.includes(session.role)) {
    throw new AuthError(403, "Forbidden for role: " + session.role);
  }
  return session;
}
