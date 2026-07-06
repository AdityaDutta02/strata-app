"use client";
import { Clapperboard } from "lucide-react";
import Button from "../Button";
import JobProgress from "../JobProgress";
import StageHeader, { StaleBanner } from "./StageHeader";
import type { Avatar, EstimateResponse, Job } from "@/app/_lib/types";

interface VideoStageProps {
  avatars: Avatar[];
  loadingAvatars: boolean;
  avatarId: string | null;
  savingSelection: boolean;
  onSelectAvatar: (id: string) => void;
  estimate: EstimateResponse | null;
  chainJobs: Job[];
  stale: boolean;
  generating: boolean;
  generateError?: string | null;
  onGenerate: () => void;
  onRetryJob: (job: Job) => void;
}

const CHAIN_ORDER: Job["type"][] = ["voice_gen", "voice_swap", "video_gen", "transcribe", "notes"];

function mostRelevantJob(jobs: Job[]): Job | null {
  const chain = jobs
    .filter((j) => CHAIN_ORDER.includes(j.type))
    .sort((a, b) => CHAIN_ORDER.indexOf(a.type) - CHAIN_ORDER.indexOf(b.type));
  return chain.find((j) => j.status !== "ready") ?? chain[chain.length - 1] ?? null;
}

// Video stage repurposed per docs/BUILD-SPEC-MVP.md: avatar picker grid + single
// "Generate avatar video" job card (replaces the design's per-scene prompt cards).
export default function VideoStage({
  avatars,
  loadingAvatars,
  avatarId,
  savingSelection,
  onSelectAvatar,
  estimate,
  chainJobs,
  stale,
  generating,
  generateError,
  onGenerate,
  onRetryJob,
}: VideoStageProps) {
  const readyAvatars = avatars.filter((a) => a.status === "ready");
  const activeJob = mostRelevantJob(chainJobs);
  const chainStarted = chainJobs.length > 0 && !stale;

  return (
    <div className="space-y-5">
      <StageHeader
        step={3}
        title="Video"
        desc="Pick a trained avatar, then generate the talking-head video, transcript and editor notes."
        action={
          !chainStarted ? (
            <Button
              variant="accent"
              icon={Clapperboard}
              cost={estimate?.credits}
              disabled={!avatarId || savingSelection || generating}
              onClick={onGenerate}
              data-testid="generate-button"
            >
              {generating ? "Starting…" : "Generate avatar video"}
            </Button>
          ) : undefined
        }
      />

      {stale && chainJobs.length > 0 && (
        <StaleBanner onRegenerate={onGenerate} cost={estimate?.credits} />
      )}

      {generateError && !chainStarted && (
        <p className="text-sm text-error" role="alert">{generateError}</p>
      )}

      {!chainStarted && (
        <div>
          <div className="eyebrow mb-2 text-[10px] text-fg-secondary">Your avatars</div>
          {loadingAvatars ? (
            <p className="text-sm text-fg-secondary">Loading avatars…</p>
          ) : readyAvatars.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              No avatars yet — train one from <span className="font-medium text-fg-default">Onboarding</span> first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {readyAvatars.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onSelectAvatar(a.id)}
                  className={[
                    "flex flex-col overflow-hidden rounded-md border text-left transition-colors",
                    avatarId === a.id ? "border-accent ring-1 ring-accent" : "border-line-subtle hover:border-line-default",
                  ].join(" ")}
                >
                  <div className="relative aspect-[9/16] w-full overflow-hidden bg-surface-inverse">
                    {/* AvatarRow only carries a storage key (thumb_key), not a presigned URL —
                        no endpoint currently presigns arbitrary avatar thumbnails, so this shows
                        a placeholder icon instead of an image. */}
                    <div className="flex h-full items-center justify-center text-white/40">
                      <Clapperboard size={20} strokeWidth={1.5} />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <span className="text-sm font-medium tracking-tight text-fg-primary">{a.name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {chainStarted && activeJob && (
        <JobProgress
          status={activeJob.status}
          label={jobLabel(activeJob.type)}
          errorMessage={activeJob.error}
          onRetry={() => onRetryJob(activeJob)}
        />
      )}
    </div>
  );
}

function jobLabel(type: Job["type"]): string {
  switch (type) {
    case "voice_gen":
      return "Generating voice";
    case "voice_swap":
      return "Swapping voice";
    case "video_gen":
      return "Generating avatar video";
    case "transcribe":
      return "Transcribing";
    case "notes":
      return "Writing editor notes";
    default:
      return "Processing";
  }
}
