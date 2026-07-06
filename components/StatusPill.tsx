import { Loader2, Check, TriangleAlert, Clock, Circle, Ban } from "lucide-react";

export type AssetStatus = "none" | "queued" | "generating" | "done" | "failed" | "cancelled";

const MAP: Record<AssetStatus, { label: string; cls: string; icon: typeof Check; spin?: boolean }> = {
  none: { label: "Not started", cls: "text-fg-secondary bg-surface-subtle", icon: Circle },
  queued: { label: "Queued", cls: "text-fg-secondary bg-surface-subtle", icon: Clock },
  generating: { label: "Generating", cls: "text-accent bg-accent-subtle", icon: Loader2, spin: true },
  done: { label: "Done", cls: "text-success bg-success/10", icon: Check },
  failed: { label: "Failed", cls: "text-error bg-error/10", icon: TriangleAlert },
  cancelled: { label: "Cancelled", cls: "text-fg-secondary bg-surface-subtle", icon: Ban },
};

/** Maps a backend job/asset status onto the design's AssetStatus vocabulary. */
export function jobStatusToAssetStatus(status: "queued" | "processing" | "ready" | "failed" | "cancelled"): AssetStatus {
  switch (status) {
    case "processing":
      return "generating";
    case "ready":
      return "done";
    default:
      return status;
  }
}

export default function StatusPill({ status }: { status: AssetStatus }) {
  const m = MAP[status];
  const Icon = m.icon;
  return (
    <span className={`eyebrow inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] leading-none ${m.cls}`}>
      <Icon size={11} strokeWidth={2} className={m.spin ? "animate-spin" : ""} />
      {m.label}
    </span>
  );
}
