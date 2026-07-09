"use client";
import { Clapperboard, ShieldCheck } from "lucide-react";
import Button from "../Button";
import JobProgress from "../JobProgress";
import StageHeader, { StaleBanner } from "./StageHeader";
import type { EstimateResponse, Job } from "@/app/_lib/types";

interface VideoStageProps {
  estimate: EstimateResponse | null;
  chainJobs: Job[];
  stale: boolean;
  generating: boolean;
  generateError?: string | null;
  onGenerate: () => void;
  onRetryJob: (job: Job) => void;
}

const CHAIN_ORDER: Job["type"][] = ["video_gen", "transcribe", "notes"];

function mostRelevantJob(jobs: Job[]): Job | null {
  const chain = jobs
    .filter((j) => CHAIN_ORDER.includes(j.type))
    .sort((a, b) => CHAIN_ORDER.indexOf(a.type) - CHAIN_ORDER.indexOf(b.type));
  return chain.find((j) => j.status !== "ready") ?? chain[chain.length - 1] ?? null;
}

// Video stage: avatar is already attached at project creation, and voice was already
// generated + approved on the previous stage — this is just the "generate video, transcript,
// notes" trigger + progress. A failed video job with a consentUrl means HeyGen is blocking on
// one-time avatar consent — surface it as an actionable link, not just an error string.
export default function VideoStage({
  estimate,
  chainJobs,
  stale,
  generating,
  generateError,
  onGenerate,
  onRetryJob,
}: VideoStageProps) {
  const activeJob = mostRelevantJob(chainJobs);
  const chainStarted = chainJobs.length > 0 && !stale;
  const consentUrl = activeJob?.status === "failed" ? (activeJob.output_json.consentUrl as string | undefined) : undefined;
  const videoCost = estimate ? estimate.minutes * 40 : undefined;

  return (
    <div className="space-y-5">
      <StageHeader
        step={3}
        title="Video"
        desc="Generate the talking-head video, transcript and editor notes."
        action={
          !chainStarted ? (
            <Button
              variant="accent"
              icon={Clapperboard}
              cost={videoCost}
              disabled={generating}
              onClick={onGenerate}
              data-testid="generate-button"
            >
              {generating ? "Starting…" : "Generate avatar video"}
            </Button>
          ) : undefined
        }
      />

      {stale && chainJobs.length > 0 && (
        <StaleBanner onRegenerate={onGenerate} cost={videoCost} />
      )}

      {generateError && !chainStarted && (
        <p className="text-sm text-error" role="alert">{generateError}</p>
      )}

      {consentUrl && (
        <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 p-4">
          <ShieldCheck size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-sm text-fg-primary">
            <p className="font-medium">One-time avatar consent required</p>
            <p className="mt-0.5 text-fg-secondary">
              The person in the training footage must approve before video can render.
            </p>
            <a
              href={consentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-medium text-accent underline underline-offset-2"
            >
              Open consent page →
            </a>
          </div>
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
