// xorshift32 : doit rester identique à public.xorshift32 (supabase/migrations).
export function xorshift32(x: number): number {
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x;
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 4294967295);
}
