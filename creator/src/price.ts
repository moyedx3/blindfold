const STAR_PER_NIGHT = 1_000_000n;

export function priceNightToStar(input: string): bigint {
  const value = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) {
    throw new Error("price must be a NIGHT amount with at most 6 decimals");
  }

  const [whole, fraction = ""] = value.split(".");
  const star = BigInt(whole) * STAR_PER_NIGHT + BigInt((fraction + "000000").slice(0, 6));
  if (star <= 0n) throw new Error("price must be positive");
  return star;
}
