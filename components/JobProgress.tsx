import { Loader2, Mail, CheckCircle2, TriangleAlert, Info, Clock } from "lucide-react";
import Button from "./Button";
import type { JobStatus } from "@/app/_lib/types";

interface JobProgressProps {
  status: JobStatus;
  label: string;
  errorMessage?: string | null;
  onRetry: () => void;
}

// Generic job-status card — adapted from the design's render-job progress patterns for
// provider jobs whose granular step/percent isn't available (HeyGen/Fish/Groq polling
// only exposes queued/processing/ready/failed, not intermediate progress).
export default function JobProgress({ status, label, errorMessage, onRetry }: JobProgressProps) {
  if (status === "failed") {
    return (
      <div className="rounded-md border border-error/40 bg-surface-card p-5" role="alert">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-error/10 text-error">
            <TriangleAlert size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-fg-primary">{label} failed</h3>
            <p className="mt-0.5 text-sm text-fg-secondary">{errorMessage ?? "The job stopped unexpectedly."}</p>
            <p className="mt-2 text-xs text-fg-secondary">Reserved credits for the failed job were refunded.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={onRetry}>Retry</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="rounded-md border border-success/40 bg-surface-card p-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={20} className="text-success" strokeWidth={2} />
          <div>
            <h3 className="text-base font-semibold tracking-tight text-fg-primary">{label} complete</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line-subtle bg-surface-card p-5">
      <div className="flex items-center gap-2.5">
        {status === "queued" ? (
          <Clock size={18} className="text-fg-secondary" strokeWidth={2} />
        ) : (
          <Loader2 size={18} className="animate-spin text-accent" strokeWidth={2} />
        )}
        <h3 className="text-base font-semibold tracking-tight text-fg-primary">
          {status === "queued" ? `Queued: ${label}` : `${label}…`}
        </h3>
      </div>

      {/* indeterminate progress bar — provider only reports discrete states */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className={[
            "h-full rounded-full bg-accent",
            status === "processing" ? "animate-[shimmer_1.6s_infinite] w-1/3" : "w-[4%]",
          ].join(" ")}
        />
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-sm border border-line-subtle bg-surface-subtle p-3">
        <Info size={15} className="mt-0.5 shrink-0 text-fg-secondary" strokeWidth={2} />
        <p className="text-xs text-fg-secondary">
          <span className="font-medium text-fg-default">Safe to leave.</span> This runs on our servers — you can close the tab.
          <span className="mt-1 flex items-center gap-1"><Mail size={12} strokeWidth={2} /> We&apos;ll email you when it&apos;s ready.</span>
        </p>
      </div>
    </div>
  );
}
