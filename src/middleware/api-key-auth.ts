// PHASE 2 (used by /api/v1/* payment endpoints) — validates an Authorization
// header API key against stored key hashes. Scaffolded now since it belongs
// to the auth/foundation layer, wired up once v1 endpoints exist.
import { prisma } from "@/lib/db";
import bcrypt from "bcrypt";

export class ApiKeyAuthError extends Error {
  constructor(message = "Invalid API key") {
    super(message);
    this.name = "ApiKeyAuthError";
  }
}

export async function requireApiKey(headers: Headers): Promise<{ merchantId: string }> {
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiKeyAuthError("Missing Authorization header");
  }
  const rawKey = authHeader.slice("Bearer ".length);

  const activeKeys = await prisma.apiKey.findMany({ where: { isActive: true } });
  for (const key of activeKeys) {
    if (await bcrypt.compare(rawKey, key.keyHash)) {
      return { merchantId: key.merchantId };
    }
  }
  throw new ApiKeyAuthError("Invalid or revoked API key");
}
