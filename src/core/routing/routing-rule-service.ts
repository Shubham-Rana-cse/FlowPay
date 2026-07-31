/**
 * Routing Rule Service (Phase 7 — Dynamic Routing Engine, FR9/FR21).
 *
 * Merchant-facing CRUD for `RoutingRule` rows: currency/amount-conditioned
 * overrides evaluated by `rule-matching.ts`'s pure `matchRoutingRule`
 * before the merchant's configured strategy ever runs. See Phase 0 §11's
 * "Open Design Decisions" pattern — rules are explicit, inspectable rows,
 * not implicit logic buried in code.
 */
import { prisma } from "@/lib/db";
import { isProviderRegistered } from "./routing-service";
import { UnknownProviderError } from "./provider-config-service";

export class RoutingRuleNotFoundError extends Error {
  constructor() {
    super("Routing rule not found");
    this.name = "RoutingRuleNotFoundError";
  }
}

export async function listRoutingRules(merchantId: string) {
  return prisma.routingRule.findMany({
    where: { merchantId },
    orderBy: { priority: "asc" },
  });
}

export async function createRoutingRule(
  merchantId: string,
  input: {
    name: string;
    provider: string;
    priority?: number;
    enabled?: boolean;
    currency?: string;
    minAmount?: number;
    maxAmount?: number;
  }
) {
  if (!isProviderRegistered(input.provider)) {
    throw new UnknownProviderError(input.provider);
  }

  return prisma.routingRule.create({
    data: {
      merchantId,
      name: input.name,
      provider: input.provider,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      currency: input.currency ?? null,
      minAmount: input.minAmount ?? null,
      maxAmount: input.maxAmount ?? null,
    },
  });
}

export async function updateRoutingRule(
  merchantId: string,
  ruleId: string,
  input: {
    name?: string;
    provider?: string;
    priority?: number;
    enabled?: boolean;
    currency?: string | null;
    minAmount?: number | null;
    maxAmount?: number | null;
  }
) {
  const existing = await prisma.routingRule.findFirst({ where: { id: ruleId, merchantId } });
  if (!existing) throw new RoutingRuleNotFoundError();

  if (input.provider !== undefined && !isProviderRegistered(input.provider)) {
    throw new UnknownProviderError(input.provider);
  }

  return prisma.routingRule.update({
    where: { id: ruleId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.minAmount !== undefined ? { minAmount: input.minAmount } : {}),
      ...(input.maxAmount !== undefined ? { maxAmount: input.maxAmount } : {}),
    },
  });
}

export async function deleteRoutingRule(merchantId: string, ruleId: string) {
  const existing = await prisma.routingRule.findFirst({ where: { id: ruleId, merchantId } });
  if (!existing) throw new RoutingRuleNotFoundError();
  await prisma.routingRule.delete({ where: { id: ruleId } });
}
