import { FileQuestion } from "lucide-react";
import StageHeader from "./StageHeader";
import type { TranscriptWord } from "@/app/_lib/types";

interface ReviewStageProps {
  videoUrl: string | null;
  transcriptWords: TranscriptWord[] | null;
  loadingAssets: boolean;
}

// Render stage repurposed as "Review" per docs/BUILD-SPEC-MVP.md: video player +
// transcript preview only — HeyGen output is final, no captions/music/watermark options.
export default function ReviewStage({ videoUrl, transcriptWords, loadingAssets }: ReviewStageProps) {
  return (
    <div className="space-y-5">
      <StageHeader step={4} title="Review" desc="Check the finished video and transcript before publishing." />

      {loadingAssets ? (
        <p className="text-sm text-fg-secondary">Loading…</p>
      ) : !videoUrl ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-muted bg-surface-card px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
            <FileQuestion size={20} strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-base font-semibold tracking-tight text-fg-primary">Not ready yet</h3>
          <p className="mt-1 max-w-xs text-sm text-fg-secondary">Finish the Video stage to generate the render.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr]">
          <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-md bg-surface-inverse">
            <video src={videoUrl} controls className="aspect-[9/16] w-full object-cover" data-testid="review-video" />
          </div>

          <div className="min-w-0">
            <div className="eyebrow mb-2 text-[10px] text-fg-secondary">Transcript</div>
            <div className="max-h-[400px] overflow-y-auto rounded-md border border-line-subtle bg-surface-card p-4">
              {transcriptWords && transcriptWords.length > 0 ? (
                <p className="text-sm leading-relaxed text-fg-default">
                  {transcriptWords.map((w, i) => (
                    <span key={i}>{w.word} </span>
                  ))}
                </p>
              ) : (
                <p className="text-sm text-fg-secondary">Transcript still processing.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
