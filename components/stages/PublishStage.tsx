"use client";
import { Play, Download, Lock, ArrowRight, FileText, FileType, Film } from "lucide-react";
import Button from "../Button";
import StageHeader from "./StageHeader";
import { formatCredits, posterGradient } from "@/app/_lib/format";
import type { Asset } from "@/app/_lib/types";

interface PublishStageProps {
  title: string;
  tint: 0 | 1 | 2 | 3;
  ready: boolean;
  creditsSpent: number;
  videoAsset: Asset | null;
  transcriptAsset: Asset | null;
  notesAsset: Asset | null;
  onDownload: (asset: Asset) => void;
  onJumpToReview: () => void;
}

// Publish stage repurposed per docs/BUILD-SPEC-MVP.md: player + 3 download rows
// (video / transcript / notes PDF) + credits-charged summary — no publish targets.
export default function PublishStage({
  title,
  tint,
  ready,
  creditsSpent,
  videoAsset,
  transcriptAsset,
  notesAsset,
  onDownload,
  onJumpToReview,
}: PublishStageProps) {
  if (!ready) {
    return (
      <div className="space-y-5">
        <StageHeader step={5} title="Publish" desc="Your finished video will appear here once generation completes." />
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-muted bg-surface-card px-6 py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
            <Lock size={20} strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-base font-semibold tracking-tight text-fg-primary">Not ready yet</h3>
          <p className="mt-1 max-w-xs text-sm text-fg-secondary">Finish the Review stage to unlock downloads.</p>
          <div className="mt-4">
            <Button variant="primary" icon={ArrowRight} onClick={onJumpToReview}>Go to review</Button>
          </div>
        </div>
      </div>
    );
  }

  const rows: { asset: Asset | null; label: string; icon: typeof Film }[] = [
    { asset: videoAsset, label: "Video (MP4)", icon: Film },
    { asset: transcriptAsset, label: "Transcript (JSON)", icon: FileText },
    { asset: notesAsset, label: "Editor notes (PDF)", icon: FileType },
  ];

  return (
    <div className="space-y-5">
      <StageHeader step={5} title="Publish" desc="Your video is ready. Download the video, transcript and editor notes." />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr]">
        {/* final player */}
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-md" style={{ background: posterGradient(tint) }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
              <Play size={24} className="ml-1 text-white" fill="currentColor" strokeWidth={0} />
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-fg-primary">{title}</h3>
            <p className="text-sm text-fg-secondary">MP4 · avatar video</p>
          </div>

          <div className="space-y-2">
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.label} className="flex items-center justify-between rounded-md border border-line-subtle bg-surface-card px-3 py-2.5">
                  <span className="flex items-center gap-2.5 text-sm font-medium text-fg-primary">
                    <Icon size={16} strokeWidth={2} className="text-fg-secondary" /> {row.label}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    disabled={!row.asset}
                    onClick={() => row.asset && onDownload(row.asset)}
                  >
                    Download
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2">
            <span className="text-xs text-fg-secondary">Credits charged</span>
            <span className="tnum font-mono text-sm font-medium text-fg-primary">{formatCredits(creditsSpent)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
