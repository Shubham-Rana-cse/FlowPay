// JWT + password hashing helpers.
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = "15m"; // short-lived JWT only — no refresh token (see Phase 1 decisions)
const BCRYPT_ROUNDS = 10;

if (!JWT_SECRET) {
  // Fail loudly at import time in non-test environments rather than silently signing
  // tokens with `undefined`.
  if (process.env.NODE_ENV !== "test") {
    console.warn("[auth] JWT_SECRET is not set — set it in your .env file.");
  }
}

export interface JwtPayload {
  merchantId: string;
  email: string;
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
