import type { ReactNode } from "react";

export default function StageHeader({
  step,
  title,
  desc,
  action,
}: {
  step: number;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle pb-4">
      <div>
        <div className="eyebrow text-[10px] text-fg-secondary">Stage {step} · {title}</div>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-fg-primary">{title}</h2>
        <p className="mt-1 text-sm text-fg-secondary">{desc}</p>
      </div>
      {action}
    </div>
  );
}

export function StaleBanner({ onRegenerate, cost }: { onRegenerate: () => void; cost?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-warning/40 bg-warning-bg px-3 py-2.5">
      <span className="text-sm text-fg-default">
        <span className="font-medium text-warning">Out of date.</span> The script changed after this was generated.
      </span>
      <button
        onClick={onRegenerate}
        className="ml-auto inline-flex items-center gap-1.5 rounded-sm border border-warning/50 bg-surface-card px-2.5 h-7 text-xs font-medium text-warning hover:bg-warning-bg"
      >
        Regenerate
        {typeof cost === "number" && <span className="tnum font-mono">≈{cost}</span>}
      </button>
    </div>
  );
}
