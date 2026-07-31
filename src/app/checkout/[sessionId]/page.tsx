import { getPublicCheckoutSession, CheckoutSessionNotFoundError } from "@/core/checkout/checkout-session-service";
import CheckoutClient from "./CheckoutClient";

export const dynamic = "force-dynamic";

async function loadSession(sessionId: string) {
  try {
    const session = await getPublicCheckoutSession(sessionId);
    return { session, notFound: false as const };
  } catch (err) {
    if (err instanceof CheckoutSessionNotFoundError) {
      return { session: null, notFound: true as const };
    }
    throw err;
  }
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { session, notFound } = await loadSession(sessionId);

  if (notFound || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center">
          <p className="font-mono text-xs tracking-widest text-muted uppercase">PayFlow</p>
          <h1 className="mt-3 text-lg font-semibold text-foreground">Checkout session not found</h1>
          <p className="mt-2 text-sm text-muted">
            This checkout link is invalid or has already been used. Please return to the merchant
            and try again.
          </p>
        </div>
      </div>
    );
  }

  return <CheckoutClient sessionId={sessionId} initial={session} />;
}
