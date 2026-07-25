import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { randomBytes } from "crypto";
import { DEFAULT_CURRENCY } from "@/constants/currencies";

export class DuplicateEmailError extends Error {
  constructor() {
    super("A merchant with this email already exists");
    this.name = "DuplicateEmailError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export async function registerMerchant(input: {
  businessName: string;
  email: string;
  password: string;
}) {
  const existing = await prisma.merchant.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new DuplicateEmailError();
  }

  const passwordHash = await hashPassword(input.password);

  const merchant = await prisma.merchant.create({
    data: {
      businessName: input.businessName,
      email: input.email,
      passwordHash,
      settings: {
        create: {
          autoCapture: true,
          defaultCurrency: DEFAULT_CURRENCY,
          webhookSecret: randomBytes(32).toString("hex"),
          timezone: "Asia/Kolkata",
        },
      },
    },
  });

  return { id: merchant.id, businessName: merchant.businessName, email: merchant.email };
}

export async function authenticateMerchant(email: string, password: string) {
  const merchant = await prisma.merchant.findUnique({ where: { email } });
  if (!merchant) {
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(password, merchant.passwordHash);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  return { id: merchant.id, businessName: merchant.businessName, email: merchant.email };
}

export async function getMerchantProfile(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return null;
  return {
    id: merchant.id,
    businessName: merchant.businessName,
    email: merchant.email,
    createdAt: merchant.createdAt,
  };
}

export async function getMerchantSettings(merchantId: string) {
  return prisma.merchantSettings.findUnique({ where: { merchantId } });
}

export class SettingsNotFoundError extends Error {
  constructor() {
    super("Settings not found");
    this.name = "SettingsNotFoundError";
  }
}

/**
 * Phase 5 — FR4/FR4a: MerchantSettings finally becomes editable (Phase 1-4
 * only ever exposed it read-only). Partial update: only the fields present
 * in `input` are changed. `webhookUrl: ""` is treated as "clear it" (stored
 * as `null`) rather than a literal empty string in the DB, so
 * webhook-delivery-service.ts's "is a URL configured?" check stays a simple
 * truthiness check.
 */
export async function updateMerchantSettings(
  merchantId: string,
  input: {
    autoCapture?: boolean;
    defaultCurrency?: string;
    timezone?: string;
    webhookUrl?: string;
  }
) {
  const existing = await prisma.merchantSettings.findUnique({ where: { merchantId } });
  if (!existing) throw new SettingsNotFoundError();

  return prisma.merchantSettings.update({
    where: { merchantId },
    data: {
      ...(input.autoCapture !== undefined ? { autoCapture: input.autoCapture } : {}),
      ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.webhookUrl !== undefined
        ? { webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl }
        : {}),
    },
  });
}
