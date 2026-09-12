import { TOP_UP_DENOMINATIONS_STAR } from '@blindfold/midnight-web';

export function canBuy(balanceStar: bigint, priceStar: bigint): boolean {
  return balanceStar >= priceStar;
}

/** Smallest of 5/10/50 NIGHT that brings `balance` to at least `price`, or null if none does. */
export function smallestTopUpCovering(priceStar: bigint, balanceStar: bigint): bigint | null {
  for (const d of TOP_UP_DENOMINATIONS_STAR) if (balanceStar + d >= priceStar) return d;
  return null;
}
