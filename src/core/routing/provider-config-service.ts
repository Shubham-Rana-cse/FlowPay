/**
 * Provider Config Service (Phase 7 — "Provider switching").
 *
 * Owns the merchant-facing CRUD for `ProviderConfig`: which providers are
 * enabled, their priority (tie-break / failover order), and their cost
 * (basis points, for the CHEAPEST strategy). A merchant with zero rows
 * here is entirely unaffected by Phase 7 — see dynamic-routing-engine.ts's
 * `loadRoutingContext`, which returns `null` (legacy fallback) in that
 * case.
 */
import { prisma } from "@/lib/db";
import { isProviderRegistered } from "./routing-service";

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(`"${provider}" has no registered ProviderAdapter`);
    this.name = "UnknownProviderError";
  }
}

export class ProviderConfigNotFoundError extends Error {
  constructor() {
    super("Provider config not found");
    this.name = "ProviderConfigNotFoundError";
  }
}

export async function listProviderConfigs(merchantId: string) {
  return prisma.providerConfig.findMany({
    where: { merchantId },
    orderBy: { priority: "asc" },
  });
}

/**
 * Upserts a merchant's config for one provider. This is how a merchant
 * "opts in" to Phase 7 routing at all — the first successful call here is
 * what makes `dynamic-routing-engine.ts` start using the Dynamic Routing
 * Engine instead of the legacy FixedProviderStrategy fallback for them.
 */
export async function upsertProviderConfig(
  merchantId: string,
  input: { provider: string; enabled?: boolean; priority?: number; costBps?: number }
) {
  if (!isProviderRegistered(input.provider)) {
    throw new UnknownProviderError(input.provider);
  }

  return prisma.providerConfig.upsert({
    where: { merchantId_provider: { merchantId, provider: input.provider } },
    create: {
      merchantId,
      provider: input.provider,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
      costBps: input.costBps ?? 0,
    },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.costBps !== undefined ? { costBps: input.costBps } : {}),
    },
  });
}

export async function deleteProviderConfig(merchantId: string, provider: string) {
  const existing = await prisma.providerConfig.findUnique({
    where: { merchantId_provider: { merchantId, provider } },
  });
  if (!existing) throw new ProviderConfigNotFoundError();

  await prisma.providerConfig.delete({
    where: { merchantId_provider: { merchantId, provider } },
  });
}

/** The full set of provider names this codebase has an adapter for —
 * used by the dashboard/API to know what a merchant is allowed to enable. */
export const KNOWN_PROVIDERS = ["mock-bank", "stripe", "razorpay"] as const;
