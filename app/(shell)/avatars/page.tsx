"use client";
import { useEffect, useState } from "react";
import { Mic, Clapperboard, Loader2, Upload, UserPlus, Trash2, RefreshCw } from "lucide-react";
import Button from "@/components/Button";
import StatusPill, { jobStatusToAssetStatus } from "@/components/StatusPill";
import { api, ApiError, uploadFile } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import type { Avatar, Voice } from "@/app/_lib/types";

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

export default function AvatarsPage() {
  const { token } = useAuth();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [name, setName] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!token) return;
    try {
      const [a, v] = await Promise.all([api.avatars(token), api.voices(token)]);
      setAvatars(a);
      setVoices(v);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const isTraining = avatars.some((a) => a.status === "training") || voices.some((v) => v.status === "training");
    if (!isTraining) return;
    const iv = setInterval(() => void refresh(), 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatars, voices, token]);

  const avatar = avatars[0];
  const voice = voices[0];
  const hasAvatar = Boolean(avatar);

  async function handleRetry(id: string): Promise<void> {
    if (!token) return;
    try {
      setFormError(null);
      await api.retryAvatar(token, id);
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Retry failed");
    }
  }

  async function handleRemove(id: string): Promise<void> {
    if (!token) return;
    try {
      setFormError(null);
      await api.removeAvatar(token, id);
      setConfirmRemove(false);
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Remove failed");
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!token || !videoFile || !audioFile || name.trim() === "") return;
    try {
      setSubmitting(true);
      setFormError(null);
      const duration = await videoDurationSeconds(videoFile);
      if (duration !== null && (duration < 15 || duration > 600)) {
        setFormError(
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
      setShowForm(false);
      setName("");
      setVideoFile(null);
      setAudioFile(null);
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not start training");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim() !== "" && videoFile !== null && audioFile !== null && !submitting;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6">
        <div>
          <div className="eyebrow text-[11px] text-fg-secondary">Talking-head</div>
          <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">Avatars</h1>
          <p className="mt-2 text-sm text-fg-secondary">Your video avatar and cloned voice, trained together.</p>
        </div>
        <Button variant="primary" icon={UserPlus} disabled={hasAvatar || loading} onClick={() => setShowForm(true)}>
          Add avatar
        </Button>
      </div>

      <div className="mt-6 max-w-[760px]">
        {loading ? (
          <p className="text-sm text-fg-secondary">Loading…</p>
        ) : !hasAvatar && !showForm ? (
          <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-line-muted bg-surface-card px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary">
              <UserPlus size={22} strokeWidth={1.75} />
            </div>
            <h3 className="mt-3 text-base font-medium text-fg-primary">No avatar yet</h3>
            <p className="mt-1 max-w-xs text-sm text-fg-secondary">
              Add a video + voice sample to train your talking-head avatar. This only needs to happen once.
            </p>
            <div className="mt-4">
              <Button variant="primary" icon={UserPlus} onClick={() => setShowForm(true)}>
                Add avatar
              </Button>
            </div>
          </div>
        ) : showForm ? (
          <div className="flex flex-col gap-6 rounded-sm border border-line-subtle bg-surface-card p-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg-default" htmlFor="avatar-name">
                Name
              </label>
              <input
                id="avatar-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme presenter"
                className="h-11 w-full rounded-sm border border-line-default bg-surface-card px-3.5 text-[16px] text-fg-default placeholder:text-fg-secondary outline-none focus:border-line-focus focus:ring-2 focus:ring-line-focus/25"
              />
            </div>

            <UploadField
              label="Avatar training video"
              hint="A clear, front-facing video, 30s or more"
              icon={Clapperboard}
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

            {formError && <p className="text-sm text-error">{formError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="subtle" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="accent" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                {submitting ? "Starting…" : "Start training"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-sm border border-line-subtle bg-surface-card">
              {avatar && (
                <StatusRow
                  icon={Clapperboard}
                  label={avatar.name}
                  status={avatar.status}
                  error={avatar.error}
                  consentUrl={avatar.consent_url}
                  onRetry={avatar.status === "failed" ? () => void handleRetry(avatar.id) : undefined}
                  onRemove={avatar.status !== "training" ? () => setConfirmRemove(true) : undefined}
                />
              )}
              {voice ? (
                <StatusRow icon={Mic} label={voice.name} status={voice.status} error={voice.error} />
              ) : (
                <div className="flex items-center gap-3 border-t border-line-subtle px-4 py-3 text-sm text-fg-secondary">
                  <Loader2 size={15} className="animate-spin" strokeWidth={2} /> Waiting for voice status…
                </div>
              )}
            </div>
            {formError && <p className="text-sm text-error">{formError}</p>}
          </div>
        )}
      </div>

      {confirmRemove && avatar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmRemove(false)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-[400px] rounded-md border border-line-subtle bg-surface-card p-5 shadow-e4">
            <h2 className="text-base font-semibold text-fg-primary">Remove this avatar?</h2>
            <p className="mt-2 text-sm text-fg-secondary">
              This frees up your one avatar slot so you can train a new one. Nothing is deleted — contact support if
              you need it restored.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="subtle" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button variant="danger" icon={Trash2} onClick={() => void handleRemove(avatar.id)}>Remove</Button>
            </div>
          </div>
        </div>
      )}
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
  onRemove,
}: {
  icon: typeof Clapperboard;
  label: string;
  status: "training" | "ready" | "failed";
  error?: string | null;
  consentUrl?: string | null;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="border-b border-line-subtle last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
          <Icon size={14} strokeWidth={2} />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{label}</span>
        <StatusPill status={jobStatusToAssetStatus(status === "training" ? "processing" : status === "ready" ? "ready" : "failed")} />
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-surface-subtle hover:text-error"
            aria-label="Remove avatar"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {status === "training" && consentUrl && (
        <div className="flex items-start gap-2 border-t border-line-subtle bg-surface-subtle px-4 py-2.5 text-sm text-fg-secondary">
          <span className="min-w-0 flex-1">One-time consent approval needed — the person in the footage must approve it.</span>
          <a href={consentUrl} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-accent underline underline-offset-2">
            Open consent page
          </a>
        </div>
      )}
      {status === "failed" && (
        <div className="flex items-start gap-2 border-t border-line-subtle bg-error/5 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1 break-words text-error">{error ?? "Training failed."}</span>
          {onRetry && (
            <button onClick={onRetry} className="shrink-0 inline-flex items-center gap-1 rounded-sm border border-line-default px-2.5 py-1 text-xs font-medium text-fg-primary hover:bg-surface-subtle">
              <RefreshCw size={12} strokeWidth={2} /> Retry training
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
  icon: typeof Clapperboard;
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
