/** Consistent JSON responses + request validation for API routes (CI-2, SEC-7). */
import { NextResponse } from "next/server";
import { z, ZodError, type ZodTypeAny } from "zod";
import { AuthError } from "./auth";
import { env } from "./env";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, message: string, extra?: unknown) {
  return NextResponse.json({ ok: false, error: message, extra }, { status });
}

/** Translate thrown errors (AuthError, ZodError, generic) into a JSON response. */
export function errorResponse(err: unknown) {
  if (err instanceof AuthError) return fail(err.status, err.message);
  if (err instanceof ZodError) return fail(400, "Validation failed", err.flatten());
  console.error("[api] unhandled error:", err);
  return fail(500, "Internal server error");
}

/** Parse + validate a JSON request body against a Zod schema (returns the parsed output type). */
export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => ({}));
  return schema.parse(json);
}

/** Simulator service-token auth for the ingestion endpoint (SEC-4, CI-3). */
export function requireServiceToken(req: Request): void {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== env.simServiceToken()) {
    throw new AuthError(401, "Invalid service token");
  }
}
