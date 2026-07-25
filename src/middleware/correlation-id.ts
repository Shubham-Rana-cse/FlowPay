// Ensures every request has a correlation ID (NFR: Observability).
// If the client sent x-correlation-id, reuse it; otherwise generate one.
import { randomUUID } from "crypto";

export function getOrCreateCorrelationId(headers: Headers): string {
  return headers.get("x-correlation-id") ?? randomUUID();
}
