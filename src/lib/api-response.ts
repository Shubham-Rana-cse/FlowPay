// Consistent JSON error/success shape across all API routes.
import { NextResponse } from "next/server";
import type { ErrorCode } from "@/constants/errors";

export function errorResponse(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
