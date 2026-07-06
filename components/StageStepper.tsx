import { Check, Lock } from "lucide-react";
import type { Stage } from "@/app/_lib/types";

export type StepState = "done" | "current" | "locked";

export const STAGE_ORDER: Stage[] = ["script", "voice", "video", "render", "publish"];
export const STAGE_LABELS: Record<Stage, string> = {
  script: "Script",
  voice: "Voice",
  video: "Video",
  render: "Review",
  publish: "Publish",
};

interface StageStepperProps {
  stageState: Record<Stage, StepState>;
  active: Stage;
  onSelect: (s: Stage) => void;
}

export default function StageStepper({ stageState, active, onSelect }: StageStepperProps) {
  return (
    <div className="flex items-center">
      {STAGE_ORDER.map((stage, i) => {
        const state = stageState[stage];
        const isActive = stage === active;
        const locked = state === "locked";
        const done = state === "done";
        const num = i + 1;
        const prevStage = STAGE_ORDER[i - 1];

        return (
          <div key={stage} className="flex items-center">
            {i > 0 && prevStage && (
              <div
                className={[
                  "h-px w-6 sm:w-10",
                  done || stageState[prevStage] === "done" ? "bg-fg-primary/30" : "bg-line-muted",
                ].join(" ")}
              />
            )}
            <button
              disabled={locked}
              onClick={() => !locked && onSelect(stage)}
              title={locked && prevStage ? `Finish ${STAGE_LABELS[prevStage]} first` : STAGE_LABELS[stage]}
              className={[
                "group inline-flex items-center gap-2 rounded-sm px-2 py-1.5",
                locked ? "cursor-not-allowed" : "hover:bg-surface-subtle",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tnum",
                  isActive
                    ? "border-accent bg-accent text-accent-fg ring-2 ring-accent-subtle"
                    : done
                    ? "border-fg-primary bg-fg-primary text-primary-fg"
                    : "border-line-default bg-surface-card text-fg-secondary",
                ].join(" ")}
              >
                {done ? <Check size={13} strokeWidth={2.5} /> : locked ? <Lock size={11} strokeWidth={2} /> : num}
              </span>
              <span
                className={[
                  "hidden text-sm font-medium tracking-tight sm:inline",
                  isActive ? "text-fg-primary" : locked ? "text-fg-disabled" : "text-fg-secondary group-hover:text-fg-primary",
                ].join(" ")}
              >
                {STAGE_LABELS[stage]}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
