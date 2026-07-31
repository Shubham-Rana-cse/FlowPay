/**
 * Dynamic Routing Engine (Phase 7, FR9/FR21's "rules instead of a fixed
 * provider" deliverable).
 *
 * This is the async, DB-aware layer that sits in front of the existing
 * (still-synchronous, still-unchanged) `RoutingStrategy` classes: it loads
 * a merchant's `ProviderConfig` rows (which providers are enabled, at what
 * priority, at what cost — "provider switching"), `RoutingRule` rows
 * (currency/amount-conditioned overrides), and `MerchantSettings`
 * (routingStrategy/preferredProvider/failoverEnabled), then hands plain
 * precomputed data to whichever pure `RoutingStrategy` class applies —
 * exactly the same pattern `analytics-service.ts` uses to keep DB access
 * out of pure aggregation/decision logic.
 *
 * **Backward compatibility is the whole point of this module living
 * separately from `routing-service.ts`'s original `selectProvider`:** a
 * merchant with zero `ProviderConfig` rows (i.e. every merchant created
 * before Phase 7, and any Phase 7 merchant who hasn't opted in yet) makes
 * `loadRoutingContext` return `null`, and every caller falls back to the
 * original `selectProvider()` / `FixedProviderStrategy` — so Phase 3-6
 * behavior, and their test suites, are completely unaffected.
 *
 * The output is an ordered **chain** of candidate providers rather than a
 * single pick, because Phase 7 also wants Automatic Provider Failover: the
 * first entry is the strategy/rule's primary choice; the rest are the
 * remaining enabled providers in priority order, there so
 * `payment-service.ts` can fail over to them if the primary provider's
 * outcome looks like an outage (see `failover-policy.ts`).
 */
import { prisma } from "@/lib/db";
import type { ProviderRegistry } from "./provider-registry";
import type { ProviderAdapter, ProviderPaymentInput } from "@/providers/provider-adapter.interface";
import { matchRoutingRule, type RuleCondition } from "./rule-matching";
import { RoundRobinStrategy } from "./strategies/round-robin.strategy";
import { CheapestProviderStrategy, type ProviderCost } from "./strategies/cheapest-provider.strategy";
import {
  HighestSuccessRateStrategy,
  type ProviderSuccessStat,
} from "./strategies/highest-success-rate.strategy";
import { MerchantPreferredStrategy } from "./strategies/merchant-preferred.strategy";

// AttemptResult.status values that represent a *successful* provider
// outcome (mirrors `success: true` in provider-adapter.interface.ts) —
// used to compute per-provider success rates from PaymentAttempt history.
const SUCCESS_STATUSES = new Set(["authorized", "captured", "refunded"]);

export type ProviderChainLink = { providerName: string; adapter: ProviderAdapter };

type RoutingContext = {
  strategy: string; // RoutingStrategyType, kept as string to avoid a Prisma enum import here
  preferredProvider: string | null;
  failoverEnabled: boolean;
  enabled: { provider: string; priority: number; costBps: number }[];
  rules: RuleCondition[];
};

async function loadRoutingContext(merchantId: string): Promise<RoutingContext | null> {
  const [settings, configs, rules] = await Promise.all([
    prisma.merchantSettings.findUnique({ where: { merchantId } }),
    prisma.providerConfig.findMany({ where: { merchantId } }),
    prisma.routingRule.findMany({ where: { merchantId } }),
  ]);

  // Zero ProviderConfig rows = merchant hasn't opted into Phase 7 routing
  // at all — signal the caller to use the untouched legacy path.
  if (configs.length === 0) return null;

  const enabled = configs
    .filter((c) => c.enabled)
    .map((c) => ({ provider: c.provider, priority: c.priority, costBps: c.costBps }))
    .sort((a, b) => a.priority - b.priority);

  return {
    strategy: settings?.routingStrategy ?? "FIXED",
    preferredProvider: settings?.preferredProvider ?? null,
    failoverEnabled: settings?.failoverEnabled ?? true,
    enabled,
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      enabled: r.enabled,
      currency: r.currency,
      minAmount: r.minAmount,
      maxAmount: r.maxAmount,
      provider: r.provider,
    })),
  };
}

async function computeSuccessStats(
  merchantId: string,
  enabled: { provider: string; priority: number }[]
): Promise<ProviderSuccessStat[]> {
  const grouped = await prisma.paymentAttempt.groupBy({
    by: ["provider", "status"],
    where: { payment: { merchantId } },
    _count: { _all: true },
  });

  return enabled.map(({ provider, priority }) => {
    const rows = grouped.filter((g) => g.provider === provider);
    const attempts = rows.reduce((sum, r) => sum + r._count._all, 0);
    const successes = rows
      .filter((r) => SUCCESS_STATUSES.has(r.status))
      .reduce((sum, r) => sum + r._count._all, 0);
    return { provider, priority, attempts, successes };
  });
}

function pickPrimaryProvider(
  ctx: RoutingContext,
  payment: { amount: number; currency: string },
  successStats: ProviderSuccessStat[]
): string {
  const enabledNames = ctx.enabled.map((e) => e.provider);

  // Rule overrides apply first, regardless of strategy, as long as the
  // rule's target provider is actually enabled — an override pointing at
  // a disabled/unregistered provider is ignored rather than honored blindly.
  const matched = matchRoutingRule(payment, ctx.rules);
  if (matched && enabledNames.includes(matched.provider)) {
    return matched.provider;
  }

  switch (ctx.strategy) {
    case "MERCHANT_PREFERRED":
      return new MerchantPreferredStrategy(ctx.preferredProvider, enabledNames).selectProvider(
        payment as ProviderPaymentInput,
        undefined as unknown as ProviderRegistry
      );
    case "CHEAPEST": {
      const costs: ProviderCost[] = ctx.enabled.map((e) => ({
        provider: e.provider,
        costBps: e.costBps,
        priority: e.priority,
      }));
      return new CheapestProviderStrategy(costs).selectProvider(
        payment as ProviderPaymentInput,
        undefined as unknown as ProviderRegistry
      );
    }
    case "HIGHEST_SUCCESS_RATE":
      return new HighestSuccessRateStrategy(successStats).selectProvider(
        payment as ProviderPaymentInput,
        undefined as unknown as ProviderRegistry
      );
    case "ROUND_ROBIN": {
      // Cheap, dependency-free rotation signal: total attempts so far
      // across the merchant's enabled providers. Doesn't need its own
      // persisted counter column — it's fine if it isn't perfectly even
      // under heavy concurrency, same tolerance Phase 6's poller has for
      // overlapping runs.
      const counter = successStats.reduce((sum, s) => sum + s.attempts, 0);
      return new RoundRobinStrategy(enabledNames, counter).selectProvider(
        payment as ProviderPaymentInput,
        undefined as unknown as ProviderRegistry
      );
    }
    case "RULE_BASED":
    case "FIXED":
    default:
      // No rule matched and nothing more specific configured — first
      // enabled provider by priority, the same "stable, predictable
      // default" spirit as FixedProviderStrategy.
      return enabledNames[0] ?? "mock-bank";
  }
}

/**
 * Builds the ordered failover chain for one payment. Returns `null` when
 * the merchant hasn't configured any `ProviderConfig` rows, signaling the
 * caller (routing-service.ts) to fall back to the original, untouched
 * `selectProvider()`.
 */
export async function buildProviderChain(
  payment: { id: string; amount: number; currency: string },
  merchantId: string,
  registry: ProviderRegistry
): Promise<ProviderChainLink[] | null> {
  const ctx = await loadRoutingContext(merchantId);
  if (!ctx) return null;

  // Only ever route to providers this codebase actually has an adapter
  // for — a stale/misconfigured ProviderConfig row naming an unknown
  // provider is silently excluded rather than throwing mid-payment.
  const registered = ctx.enabled.filter((e) => registry.has(e.provider));
  if (registered.length === 0) return null;

  const successStats = await computeSuccessStats(merchantId, registered);
  const primary = pickPrimaryProvider(
    { ...ctx, enabled: registered },
    payment,
    successStats
  );

  const rest = registered.map((e) => e.provider).filter((p) => p !== primary);
  const order = [primary, ...rest];

  const chain = ctx.failoverEnabled ? order : order.slice(0, 1);

  return chain
    .filter((name) => registry.has(name))
    .map((providerName) => ({ providerName, adapter: registry.get(providerName) }));
}
