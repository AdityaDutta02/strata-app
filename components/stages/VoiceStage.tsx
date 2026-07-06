"use client";
import { useRef, useState } from "react";
import { Upload, ArrowRight, Loader2 } from "lucide-react";
import Button from "../Button";
import StageHeader from "./StageHeader";
import type { Voice, VoiceMode } from "@/app/_lib/types";

interface VoiceStageProps {
  voices: Voice[];
  loadingVoices: boolean;
  voiceId: string | null;
  voiceMode: VoiceMode;
  recordingKey: string | null;
  uploadingRecording: boolean;
  savingSelection: boolean;
  onSelectVoice: (id: string) => void;
  onChangeMode: (mode: VoiceMode) => void;
  onUploadRecording: (file: File) => void;
  onContinue: () => void;
}

const TABS: { key: VoiceMode; label: string }[] = [
  { key: "tts", label: "Generate from script" },
  { key: "swap", label: "Upload recording" },
];

// Voice stage repurposed per docs/BUILD-SPEC-MVP.md: two tabs — TTS voice picker,
// or upload a recording to swap onto the selected voice (Kits.ai). No per-scene UI —
// this only records the selection; the chain is kicked off from the Video stage.
export default function VoiceStage({
  voices,
  loadingVoices,
  voiceId,
  voiceMode,
  recordingKey,
  uploadingRecording,
  savingSelection,
  onSelectVoice,
  onChangeMode,
  onUploadRecording,
  onContinue,
}: VoiceStageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const readyVoices = voices.filter((v) => v.status === "ready");
  const canContinue = voiceMode === "tts" ? Boolean(voiceId) : Boolean(recordingKey);

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
              No voices yet — train one from <span className="font-medium text-fg-default">Onboarding</span> first.
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

      <div className="flex justify-end">
        <Button variant="primary" icon={ArrowRight} disabled={!canContinue || savingSelection} onClick={onContinue}>
          {savingSelection ? "Saving…" : "Continue to Video"}
        </Button>
      </div>
    </div>
  );
}
