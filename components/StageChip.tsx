import {
  FileText,
  AudioLines,
  Clapperboard,
  Loader2,
  CircleCheck,
  TriangleAlert,
  Eye,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ProjectDbStatus, Stage } from "@/app/_lib/types";

interface Meta {
  label: string;
  icon: LucideIcon;
  tone: string; // text + icon color class
  spin?: boolean;
}

const STAGE_META: Record<Stage, Meta> = {
  script: { label: "Script", icon: FileText, tone: "text-fg-primary" },
  voice: { label: "Voice", icon: AudioLines, tone: "text-fg-primary" },
  video: { label: "Video", icon: Clapperboard, tone: "text-fg-primary" },
  render: { label: "Review", icon: Eye, tone: "text-fg-primary" },
  publish: { label: "Publish", icon: Send, tone: "text-fg-primary" },
};

interface StageChipProps {
  status: ProjectDbStatus;
  stage: Stage;
  /** solid = opaque pill for use over dark posters; plain = inline on light */
  solid?: boolean;
}

export default function StageChip({ status, stage, solid = false }: StageChipProps) {
  let label = STAGE_META[stage].label;
  let Icon: LucideIcon = STAGE_META[stage].icon;
  let tone = STAGE_META[stage].tone;
  let spin = false;

  if (status === "processing") {
    label = `${STAGE_META[stage].label}…`;
    Icon = Loader2;
    tone = "text-accent";
    spin = true;
  } else if (status === "ready") {
    label = "Ready";
    Icon = CircleCheck;
    tone = "text-success";
  } else if (status === "failed") {
    label = "Failed";
    Icon = TriangleAlert;
    tone = "text-error";
  }

  return (
    <span
      className={[
        "eyebrow inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] leading-none",
        tone,
        solid ? "bg-surface-card/95 shadow-e1" : "bg-surface-subtle",
      ].join(" ")}
    >
      <Icon size={11} strokeWidth={2} className={spin ? "animate-spin" : ""} />
      <span className="tnum">{label}</span>
    </span>
  );
}
