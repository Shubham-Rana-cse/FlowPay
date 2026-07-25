/**
 * Money value object.
 *
 * Rules (Phase 0 §5):
 * - Never do raw arithmetic on `amount` fields outside this class.
 * - Any currency mismatch in add/subtract throws immediately.
 * - The DB stores a plain integer minor-units column; this is the in-app wrapper.
 */
export class Money {
  private readonly minorUnits: number; // integer, e.g. paise/cents
  private readonly currency: string; // ISO 4217, e.g. "INR"

  private constructor(minorUnits: number, currency: string) {
    if (!Number.isInteger(minorUnits)) {
      throw new Error("Money minorUnits must be an integer");
    }
    if (!currency || currency.length !== 3) {
      throw new Error(`Invalid currency code: ${currency}`);
    }
    this.minorUnits = minorUnits;
    this.currency = currency.toUpperCase();
  }

  /** Construct from a major unit value, e.g. Money.fromMajor(500, "INR") -> 500.00 INR */
  static fromMajor(value: number, currency: string): Money {
    const minorUnits = Math.round(value * 100);
    return new Money(minorUnits, currency);
  }

  /** Construct directly from minor units (as stored in the DB). */
  static fromMinorUnits(minorUnits: number, currency: string): Money {
    return new Money(minorUnits, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: cannot operate on ${this.currency} and ${other.currency}`
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  isNegative(): boolean {
    return this.minorUnits < 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  getMinorUnits(): number {
    return this.minorUnits;
  }

  getCurrency(): string {
    return this.currency;
  }

  toString(): string {
    return `${(this.minorUnits / 100).toFixed(2)} ${this.currency}`;
  }
}
