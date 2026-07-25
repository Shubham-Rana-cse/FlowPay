import { prisma } from "@/lib/db";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

const BCRYPT_ROUNDS = 10;

export async function generateApiKey(merchantId: string, label?: string) {
  const rawKey = `sk_live_${randomUUID().replace(/-/g, "")}`;
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

  const apiKey = await prisma.apiKey.create({
    data: { merchantId, keyHash, label, isActive: true },
  });

  // rawKey is only ever returned once, at creation time — never stored or shown again.
  return { id: apiKey.id, label: apiKey.label, createdAt: apiKey.createdAt, rawKey };
}

export async function listApiKeys(merchantId: string) {
  const keys = await prisma.apiKey.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });

  return keys.map((k) => ({
    id: k.id,
    label: k.label,
    isActive: k.isActive,
    createdAt: k.createdAt,
    // never expose keyHash
  }));
}

export class ApiKeyNotFoundError extends Error {
  constructor() {
    super("API key not found");
    this.name = "ApiKeyNotFoundError";
  }
}

export async function revokeApiKey(merchantId: string, apiKeyId: string) {
  const key = await prisma.apiKey.findFirst({ where: { id: apiKeyId, merchantId } });
  if (!key) {
    throw new ApiKeyNotFoundError();
  }

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: false },
  });
}
