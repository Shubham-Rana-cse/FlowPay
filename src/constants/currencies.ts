// Supported currencies (ISO 4217). Extend as needed.
export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "INR";
