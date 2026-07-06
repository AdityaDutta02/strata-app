import { Play, Loader2, TriangleAlert, Film } from "lucide-react";
import { formatCredits, posterGradient } from "@/app/_lib/format";

interface VideoPreviewProps {
  tint: 0 | 1 | 2 | 3;
  processing: boolean;
  failed: boolean;
  ready: boolean;
  videoUrl?: string | null;
  creditsSpent: number;
}

// Single-video 9:16 player card — adapted from the design's scene-based PreviewCanvas
// for the avatar-video pipeline (one video per project, not per-scene).
export default function VideoPreview({ tint, processing, failed, ready, videoUrl, creditsSpent }: VideoPreviewProps) {
  return (
    <div className="lg:sticky lg:top-6">
      <div className="rounded-md border border-line-subtle bg-surface-card p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow text-[10px] text-fg-secondary">Preview</span>
          <span className="tnum font-mono text-[11px] text-fg-secondary">9:16</span>
        </div>

        {/* 9:16 stage */}
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-sm bg-surface-inverse">
          {ready && videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full object-cover" data-testid="preview-video" />
          ) : (
            <div className="absolute inset-0" style={{ background: posterGradient(tint) }} />
          )}

          {processing && !ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30">
              <Loader2 size={22} className="animate-spin text-white" strokeWidth={2} />
              <span className="eyebrow text-[10px] text-white/90">Generating</span>
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          )}

          {failed && !ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45">
              <TriangleAlert size={22} className="text-white" strokeWidth={2} />
              <span className="eyebrow text-[10px] text-white/90">Generation failed</span>
            </div>
          )}

          {!processing && !failed && !ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15">
                <Film size={20} className="text-white/70" strokeWidth={1.5} />
              </div>
            </div>
          )}

          {ready && !videoUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15">
                <Play size={20} className="ml-0.5 text-white" strokeWidth={2} fill="currentColor" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* running cost — never hide the money */}
      <div className="mt-2 flex items-center justify-between rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2">
        <span className="text-xs text-fg-secondary">Spent on this project</span>
        <span className="tnum font-mono text-sm font-medium text-fg-primary">{formatCredits(creditsSpent)}</span>
      </div>
    </div>
  );
}
