/**
 * Mongoose connection helper with hot-reload-safe global caching.
 * In dev, Next.js re-evaluates modules on every change; without caching we
 * would open a new connection pool each time. (DC-3: MongoDB Atlas only.)
 */
import mongoose from "mongoose";
import { env } from "./env";

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

// Reuse across HMR reloads / serverless invocations.
const globalForMongoose = globalThis as unknown as { _mongoose?: Cached };
const cached: Cached = globalForMongoose._mongoose ?? { conn: null, promise: null };
globalForMongoose._mongoose = cached;

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(env.mongoUri(), {
      dbName: env.mongoDb(),
      // Keep the pool small for serverless; tune for production.
      maxPoolSize: 10,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
