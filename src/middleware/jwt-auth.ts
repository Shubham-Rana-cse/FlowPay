// Verifies the JWT on protected merchant/dashboard routes and returns the
// decoded payload (merchantId, email) for the route handler to use.
import { verifyJwt, type JwtPayload } from "@/lib/auth";
import { logger } from "@/lib/logger";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function requireJwt(headers: Headers, correlationId?: string): JwtPayload {
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    return verifyJwt(token);
  } catch (err) {
    logger.warn("JWT verification failed", { correlationId, error: (err as Error).message });
    throw new UnauthorizedError("Invalid or expired token");
  }
}
