export function formatCredits(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const POSTER_VARS = [
  "var(--poster-grad-0)",
  "var(--poster-grad-1)",
  "var(--poster-grad-2)",
  "var(--poster-grad-3)",
] as const;

/** Deterministic poster tint (0-3) derived from an id — the design ships 4 duotone gradients. */
export function tintFor(id: string): 0 | 1 | 2 | 3 {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 4) as 0 | 1 | 2 | 3;
}

export function posterGradient(tint: 0 | 1 | 2 | 3): string {
  return POSTER_VARS[tint];
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
