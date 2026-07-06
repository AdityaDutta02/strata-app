"use client";
import { useCallback, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import StageHeader from "./StageHeader";
import type { EstimateResponse, Format, VoiceMode } from "@/app/_lib/types";

interface ScriptStageProps {
  script: string;
  format: Format;
  voiceMode: VoiceMode;
  onChangeScript: (text: string) => void;
  estimate: EstimateResponse | null;
  estimating: boolean;
  saving: boolean;
}

// Script stage repurposed per docs/BUILD-SPEC-MVP.md: upload/paste ONLY — no
// AI generate/rewrite. Textarea + .txt/.md file upload, live word count → est
// duration → est credit cost (server /api/estimate).
export default function ScriptStage({ script, estimate, estimating, saving, onChangeScript }: ScriptStageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const wordCount = script.trim().length === 0 ? 0 : script.trim().split(/\s+/).length;

  const handleFile = useCallback(
    (file: File) => {
      const allowed = /\.(txt|md)$/i.test(file.name);
      if (!allowed) {
        setFileError("Only .txt or .md files are supported.");
        return;
      }
      setFileError(null);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") onChangeScript(reader.result);
      };
      reader.onerror = () => setFileError("Could not read that file.");
      reader.readAsText(file);
    },
    [onChangeScript]
  );

  return (
    <div className="space-y-5">
      <StageHeader
        step={1}
        title="Script"
        desc="Upload or paste your script. We'll turn it into voice, avatar video, transcript and notes."
        action={
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-sm border border-line-default bg-surface-card px-3 h-9 text-sm font-medium text-fg-primary hover:bg-surface-subtle"
          >
            <Upload size={15} strokeWidth={2} />
            Upload .txt / .md
          </button>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {fileError && <p className="text-xs text-error">{fileError}</p>}

      <div className="rounded-md border border-line-subtle bg-surface-card p-4">
        <textarea
          value={script}
          onChange={(e) => onChangeScript(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          rows={16}
          placeholder="Paste your script here, or drop a .txt / .md file…"
          className="w-full resize-none rounded-sm border border-line-muted bg-surface-page px-3 py-2 text-[16px] leading-relaxed text-fg-default outline-none focus:border-line-focus focus:ring-2 focus:ring-line-focus/25"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-secondary">
        <span className="tnum font-mono">{wordCount} words</span>
        <span className="inline-flex items-center gap-1">
          {saving ? "Saving…" : <><Check size={13} className="text-success" strokeWidth={2} /> Saved</>}
        </span>
      </div>

      <div className="flex items-center justify-between rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2.5">
        <span className="text-xs text-fg-secondary">Estimated length &amp; cost</span>
        <span className="tnum font-mono text-sm font-medium text-fg-primary">
          {estimating
            ? "Estimating…"
            : estimate
            ? `≈${estimate.minutes.toFixed(1)} min · ≈${estimate.credits} cr`
            : "—"}
        </span>
      </div>
    </div>
  );
}
