import { Layers } from "lucide-react";

// Branded loading screen for the standalone /embed/authorize round-trip.
export default function BrandedLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-page">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-primary text-primary-fg">
          <Layers size={24} strokeWidth={2.25} />
        </div>
        <span className="text-2xl font-semibold tracking-tight text-fg-primary">Strata</span>
      </div>

      {/* shimmer line */}
      <div className="relative h-0.5 w-40 overflow-hidden rounded-full bg-surface-muted">
        <div className="absolute inset-y-0 left-0 w-1/3 -translate-x-full animate-[shimmer_1.4s_infinite] rounded-full bg-fg-primary/60" />
      </div>

      <span className="eyebrow text-[10px] text-fg-secondary">Connecting to your workspace</span>
    </div>
  );
}
