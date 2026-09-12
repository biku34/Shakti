/**
 * Shared Google AI Studio (Gemini) JSON client — rotates over the configured key
 * pool on rate-limit/auth failures and asks the model for a JSON object. Used by
 * the feeder recommendations and the UEBA surveillance layer.
 */
import { env } from "@/lib/env";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured(): boolean {
  return env.geminiApiKeys().length > 0;
}

/** Call Gemini generateContent (JSON mode) and return the raw response text. */
export async function geminiJson(system: string, user: string): Promise<string> {
  const keys = env.geminiApiKeys();
  if (keys.length === 0) throw new Error("Gemini is not configured");
  const model = env.geminiModel();
  let lastErr: unknown;

  for (const key of keys) {
    try {
      const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      });
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        lastErr = new Error(`Gemini key rejected (${res.status})`);
        continue; // try the next key in the pool
      }
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) throw new Error("Gemini returned no text");
      return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All Gemini keys failed");
}
