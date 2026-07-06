"use client";
import { useRouter } from "next/navigation";
import { Film, Coins, Clock, RotateCcw, Play, MoreHorizontal } from "lucide-react";
import StageChip from "./StageChip";
import { formatCredits, posterGradient, relativeTime, tintFor } from "@/app/_lib/format";
import type { Project } from "@/app/_lib/types";

const STAGE_LABEL: Record<Project["stage"], string> = {
  script: "Script",
  voice: "Voice",
  video: "Video",
  render: "Review",
  publish: "Publish",
};

export default function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const isFailed = project.status === "failed";
  const isReady = project.status === "ready";
  const tint = tintFor(project.id);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="project-card"
      onClick={() => router.push(`/project/${project.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/project/${project.id}`);
        }
      }}
      className={[
        "group flex cursor-pointer flex-col overflow-hidden rounded-sm border bg-surface-card text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-line-focus/40 focus-visible:border-line-focus",
        isFailed
          ? "border-error/40 hover:border-error"
          : "border-line-subtle hover:border-line-default",
      ].join(" ")}
    >
      {/* Letterbox thumbnail (vertical 9:16 poster) */}
      <div className="relative flex h-44 items-center justify-center overflow-hidden bg-surface-inverse">
        <div
          className="flex h-40 w-[90px] items-center justify-center rounded-sm"
          style={{ background: posterGradient(tint) }}
        >
          {isReady ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <Play size={16} className="ml-0.5 text-white" strokeWidth={2} fill="currentColor" />
            </div>
          ) : (
            <Film size={20} className="text-white/45" strokeWidth={1.5} />
          )}
        </div>

        {/* Stage chip overlay */}
        <div className="absolute left-2 top-2">
          <StageChip status={project.status} stage={project.stage} solid />
        </div>

        {/* Menu */}
        <button
          aria-label="Project options"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-sm bg-surface-card/90 text-fg-secondary opacity-0 shadow-e1 hover:text-fg-default group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal size={14} />
        </button>

        {/* Format */}
        <span className="tnum absolute bottom-2 right-2 rounded-sm bg-black/55 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white">
          {project.format === "short" ? "Short" : "Long"}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3">
        <div>
          <div className="truncate text-[15px] font-semibold leading-snug tracking-tight text-fg-primary">{project.title}</div>
          <div className="truncate text-xs text-fg-secondary">{STAGE_LABEL[project.stage]}</div>
        </div>

        {isFailed ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-error">Generation failed — retry from this stage</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/project/${project.id}`);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-line-muted px-2 h-6 text-xs font-medium text-fg-default hover:bg-surface-subtle"
            >
              <RotateCcw size={12} strokeWidth={2} />
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-fg-secondary">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} strokeWidth={2} />
              {relativeTime(project.updated_at)}
            </span>
            <span className="tnum inline-flex items-center gap-1 font-mono">
              <Coins size={12} strokeWidth={2} />
              {formatCredits(project.credits_spent)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
