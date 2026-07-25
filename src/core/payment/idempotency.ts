/**
 * Idempotency handling for payment creation (Phase 0 §, FR11).
 *
 * The uniqueness rule is enforced in two layers, deliberately:
 *  1. Here, as a "check first" read — keeps the common path (no key reuse)
 *     to a single extra query and gives a clean domain error for conflicts.
 *  2. As a DB-level `@@unique([merchantId, idempotencyKey])` constraint on
 *     `Payment` — the source of truth if two requests race concurrently.
 * `payment-service.ts` handles the race by catching the DB's unique-
 * violation and re-reading, rather than trusting this check alone.
 */
import { prisma } from "@/lib/db";
import type { Payment } from "@/generated/prisma";

export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("This Idempotency-Key was already used for a different order");
    this.name = "IdempotencyKeyConflictError";
  }
}

export function findExistingPayment(
  merchantId: string,
  idempotencyKey: string
): Promise<Payment | null> {
  return prisma.payment.findUnique({
    where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } },
  });
}

/**
 * Prisma's unique-constraint violation code. Kept here (rather than in
 * payment-service) since it's specifically about enforcing idempotency.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
