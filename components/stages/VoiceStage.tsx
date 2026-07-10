"use client";
import { useRef, useState } from "react";
import { ArrowRight, Mic2, Upload, Loader2 } from "lucide-react";
import Button from "../Button";
import JobProgress from "../JobProgress";
import StageHeader from "./StageHeader";
import type { Job, Voice, VoiceMode } from "@/app/_lib/types";

interface VoiceStageProps {
  voices: Voice[];
  loadingVoices: boolean;
  voiceId: string | null;
  voiceMode: VoiceMode;
  recordingKey: string | null;
  uploadingRecording: boolean;
  onSelectVoice: (id: string) => void;
  onChangeMode: (mode: VoiceMode) => void;
  onUploadRecording: (file: File) => void;
  voiceJob: Job | null;
  audioUrl: string | null;
  generating: boolean;
  generateError?: string | null;
  onGenerateVoice: () => void;
  onContinue: () => void;
}

const TABS: { key: VoiceMode; label: string }[] = [
  { key: "tts", label: "Generate from script" },
  { key: "swap", label: "Upload recording" },
];

// Voice stage: pick a voice, generate the voiceover, listen/review, then explicitly approve
// before moving to Video. Generation no longer auto-chains into video — a bad voiceover or an
// avatar consent requirement should surface here, before any video credits are spent.
export default function VoiceStage({
  voices,
  loadingVoices,
  voiceId,
  voiceMode,
  recordingKey,
  uploadingRecording,
  onSelectVoice,
  onChangeMode,
  onUploadRecording,
  voiceJob,
  audioUrl,
  generating,
  generateError,
  onGenerateVoice,
  onContinue,
}: VoiceStageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const readyVoices = voices.filter((v) => v.status === "ready");
  const canGenerate = (voiceMode === "tts" ? Boolean(voiceId) : Boolean(recordingKey)) && !generating;
  const isFailed = voiceJob?.status === "failed";
  const isReady = voiceJob?.status === "ready";
  const isGenerating = Boolean(voiceJob) && !isReady && !isFailed;
  const jobLabel = voiceMode === "swap" ? "Swapping voice" : "Generating voice";

  if (isGenerating || isFailed) {
    return (
      <div className="space-y-5">
        <StageHeader step={2} title="Voice" desc="Generating your voiceover — you'll review it before moving to video." />
        <JobProgress
          status={voiceJob!.status}
          label={jobLabel}
          errorMessage={voiceJob!.error}
          onRetry={onGenerateVoice}
        />
      </div>
    );
  }

  if (isReady) {
    return (
      <div className="space-y-5">
        <StageHeader step={2} title="Voice" desc="Your voiceover is ready. Approve it to continue to Video." />
        <div className="flex items-center gap-3 rounded-md border border-success/40 bg-surface-card p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-success/10 text-success">
            <Mic2 size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight text-fg-primary">Voiceover generated</h3>
            <p className="mt-0.5 text-sm text-fg-secondary">Not right? Regenerate before approving.</p>
            {audioUrl ? (
              <audio controls src={audioUrl} className="mt-3 h-9 w-full max-w-sm" />
            ) : (
              <p className="mt-3 text-xs text-fg-secondary">Loading playback…</p>
            )}
          </div>
        </div>
        {generateError && <p className="text-sm text-error" role="alert">{generateError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="subtle" onClick={onGenerateVoice} disabled={generating}>
            {generating ? "Regenerating…" : "Regenerate"}
          </Button>
          <Button variant="primary" icon={ArrowRight} onClick={onContinue}>
            Approve &amp; Continue to Video
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StageHeader
        step={2}
        title="Voice"
        desc="Generate a voiceover from a cloned voice, or upload a recording to swap onto one."
      />

      {/* tabs */}
      <div className="inline-flex rounded-sm border border-line-default bg-surface-subtle p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onChangeMode(t.key)}
            className={[
              "rounded-sm px-3 py-1.5 text-sm font-medium tracking-tight transition-colors",
              voiceMode === t.key ? "bg-surface-card text-fg-primary shadow-e1" : "text-fg-secondary hover:text-fg-primary",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {voiceMode === "tts" ? (
        <div>
          <div className="eyebrow mb-2 text-[10px] text-fg-secondary">Your voices</div>
          {loadingVoices ? (
            <p className="text-sm text-fg-secondary">Loading voices…</p>
          ) : readyVoices.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              No voices yet — train one from <span className="font-medium text-fg-default">Avatars</span> first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {readyVoices.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onSelectVoice(v.id)}
                  className={[
                    "rounded-md border p-3 text-left transition-colors",
                    voiceId === v.id ? "border-accent bg-accent-subtle" : "border-line-subtle bg-surface-card hover:border-line-default",
                  ].join(" ")}
                >
                  <span className="text-sm font-semibold tracking-tight text-fg-primary">{v.name}</span>
                  <span className="mt-0.5 block text-xs text-fg-secondary">{v.language}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onUploadRecording(file);
          }}
          className={[
            "flex flex-col items-center justify-center rounded-sm border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-accent bg-accent-subtle" : "border-line-muted bg-surface-card hover:border-line-default hover:bg-surface-subtle",
          ].join(" ")}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadRecording(file);
              e.target.value = "";
            }}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary">
            {uploadingRecording ? <Loader2 size={22} className="animate-spin" strokeWidth={1.75} /> : <Upload size={22} strokeWidth={1.75} />}
          </div>
          <p className="mt-3 text-sm font-medium text-fg-primary">
            {recordingKey ? "Recording uploaded" : "Drag an audio file or browse"}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">MP3, WAV, M4A</p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingRecording}>
              Browse files
            </Button>
          </div>
        </div>
      )}

      {generateError && <p className="text-sm text-error" role="alert">{generateError}</p>}

      <div className="flex justify-end">
        <Button variant="primary" icon={Mic2} disabled={!canGenerate} onClick={onGenerateVoice}>
          {generating ? "Starting…" : "Generate voice"}
        </Button>
      </div>
    </div>
  );
}
