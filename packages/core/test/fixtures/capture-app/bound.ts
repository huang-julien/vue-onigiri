// Toy stand-in for a host clamp helper (e.g. Nuxt's islands vforBound).
export function bound(count: number): number {
  return Math.min(count, 3);
}
