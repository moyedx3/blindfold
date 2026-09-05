const STAR_PER_NIGHT = 1_000_000n;
export function formatNight(star: string | bigint): string {
  const v = typeof star === 'bigint' ? star : BigInt(star);
  const whole = v / STAR_PER_NIGHT, frac = v % STAR_PER_NIGHT;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}
