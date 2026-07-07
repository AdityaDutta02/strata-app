"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Layers, Video, Mic, Loader2, Upload, Check } from "lucide-react";
import Button from "@/components/Button";
import StatusPill, { jobStatusToAssetStatus } from "@/components/StatusPill";
import { api, ApiError, uploadFile } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import type { Avatar, Voice } from "@/app/_lib/types";

// New route per docs/BUILD-SPEC-MVP.md: name + upload training video (avatar) + upload
// training audio (voice) → POST /api/onboard, then shows a status list. Matches the
// design's onboarding visual language (eyebrow steps, upload dropzones, StatusPill).
export default function OnboardPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);

  useEffect(() => {
    if (!token || !submitted) return;
    let cancelled = false;
    async function poll(): Promise<void> {
      if (!token) return;
      try {
        const [a, v] = await Promise.all([api.avatars(token), api.voices(token)]);
        if (!cancelled) {
          setAvatars(a);
          setVoices(v);
        }
      } catch {
        // transient — next poll will retry
      }
    }
    void poll();
    const iv = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token, submitted]);

  /** HeyGen rejects footage outside 15s–10min — catch it before spending the upload. */
  function videoDurationSeconds(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(probe.duration) ? probe.duration : null);
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      probe.src = url;
    });
  }

  async function handleRetryAvatar(id: string): Promise<void> {
    if (!token) return;
    try {
      setSubmitError(null);
      await api.retryAvatar(token, id);
      const fresh = await api.avatars(token);
      setAvatars(fresh);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "Retry failed");
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!token || !videoFile || !audioFile || name.trim() === "") return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const duration = await videoDurationSeconds(videoFile);
      if (duration !== null && (duration < 15 || duration > 600)) {
        setSubmitError(
          `Training video is ${Math.round(duration)}s — HeyGen requires between 15 seconds and 10 minutes of clear, front-facing footage.`,
        );
        setSubmitting(false);
        return;
      }
      const [avatarUploadKey, voiceUploadKey] = await Promise.all([
        uploadFile(token, "avatar_training", videoFile),
        uploadFile(token, "voice_training", audioFile),
      ]);
      await api.onboard(token, { name: name.trim(), avatarUploadKey, voiceUploadKey });
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "Could not start training");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim() !== "" && videoFile !== null && audioFile !== null && !submitting;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-page">
      <header className="sticky top-0 z-20 border-b border-line-subtle bg-surface-page/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[640px] items-center gap-4 px-5 py-3">
          <button
            onClick={() => router.push("/")}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-surface-subtle hover:text-fg-primary"
            aria-label="Back to projects"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-fg">
              <Layers size={14} strokeWidth={2.25} />
            </div>
            <span className="eyebrow text-[13px] font-semibold tracking-widest text-fg-primary">Strata</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[640px] flex-1 px-5 py-10">
        <div className="eyebrow text-[11px] text-fg-secondary">Onboarding</div>
        <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
          Train your avatar &amp; voice
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Upload a short video for your talking-head avatar and a voice sample. This only needs to happen once.
        </p>

        {!submitted ? (
          <div className="mt-8 flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg-default" htmlFor="onboard-name">
                Name
              </label>
              <input
                id="onboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme presenter"
                className="h-11 w-full rounded-sm border border-line-default bg-surface-card px-3.5 text-[16px] text-fg-default placeholder:text-fg-secondary outline-none focus:border-line-focus focus:ring-2 focus:ring-line-focus/25"
              />
            </div>

            <UploadField
              label="Avatar training video"
              hint="A clear, front-facing video, 30s or more"
              icon={Video}
              file={videoFile}
              accept="video/*"
              onSelect={setVideoFile}
            />

            <UploadField
              label="Voice training audio"
              hint="A clean recording with minimal background noise, 30s or more"
              icon={Mic}
              file={audioFile}
              accept="audio/*"
              onSelect={setAudioFile}
            />

            {submitError && <p className="text-sm text-error">{submitError}</p>}

            <div className="flex justify-end">
              <Button variant="accent" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                {submitting ? "Starting…" : "Start training"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-sm border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success">
              <Check size={15} strokeWidth={2} /> Training started — this can take a few minutes.
            </div>

            <div className="overflow-hidden rounded-sm border border-line-subtle bg-surface-card">
              {avatars.slice(0, 1).map((a) => (
                <StatusRow
                  key={a.id}
                  icon={Video}
                  label={a.name}
                  status={a.status}
                  error={a.error}
                  consentUrl={a.consent_url}
                  onRetry={a.status === "failed" ? () => void handleRetryAvatar(a.id) : undefined}
                />
              ))}
              {voices.slice(0, 1).map((v) => (
                <StatusRow key={v.id} icon={Mic} label={v.name} status={v.status} error={v.error} />
              ))}
              {avatars.length === 0 && voices.length === 0 && (
                <div className="flex items-center gap-3 px-4 py-3 text-sm text-fg-secondary">
                  <Loader2 size={15} className="animate-spin" strokeWidth={2} /> Waiting for status…
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="primary" onClick={() => router.push("/")}>Back to projects</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  status,
  error,
  consentUrl,
  onRetry,
}: {
  icon: typeof Video;
  label: string;
  status: "training" | "ready" | "failed";
  error?: string | null;
  consentUrl?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="border-b border-line-subtle last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
          <Icon size={14} strokeWidth={2} />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{label}</span>
        <StatusPill status={jobStatusToAssetStatus(status === "training" ? "processing" : status === "ready" ? "ready" : "failed")} />
      </div>
      {status === "training" && consentUrl && (
        <div className="flex items-start gap-2 border-t border-line-subtle bg-surface-subtle px-4 py-2.5 text-sm text-fg-secondary">
          <span className="min-w-0 flex-1">
            One-time consent approval needed — the person in the footage must approve it.
          </span>
          <a
            href={consentUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-medium text-accent underline underline-offset-2"
          >
            Open consent page
          </a>
        </div>
      )}
      {status === "failed" && (
        <div className="flex items-start gap-2 border-t border-line-subtle bg-error/5 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1 break-words text-error">{error ?? "Training failed."}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="shrink-0 rounded-sm border border-line-default px-2.5 py-1 text-xs font-medium text-fg-primary hover:bg-surface-subtle"
            >
              Retry training
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UploadField({
  label,
  hint,
  icon: Icon,
  file,
  accept,
  onSelect,
}: {
  label: string;
  hint: string;
  icon: typeof Video;
  file: File | null;
  accept: string;
  onSelect: (f: File) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-fg-default">{label}</label>
      <label className="flex cursor-pointer items-center gap-3 rounded-sm border-2 border-dashed border-line-muted bg-surface-card px-4 py-4 hover:border-line-default hover:bg-surface-subtle">
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onSelect(f);
          }}
        />
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
          {file ? <Icon size={16} strokeWidth={2} /> : <Upload size={16} strokeWidth={2} />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg-primary">{file ? file.name : "Choose a file"}</p>
          <p className="text-xs text-fg-secondary">{hint}</p>
        </div>
      </label>
    </div>
  );
}
