"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Coins, FileQuestion } from "lucide-react";
import Button from "@/components/Button";
import StageStepper, { STAGE_ORDER } from "@/components/StageStepper";
import type { StepState } from "@/components/StageStepper";
import VideoPreview from "@/components/VideoPreview";
import CreditModal from "@/components/CreditModal";
import ScriptStage from "@/components/stages/ScriptStage";
import VoiceStage from "@/components/stages/VoiceStage";
import VideoStage from "@/components/stages/VideoStage";
import ReviewStage from "@/components/stages/ReviewStage";
import PublishStage from "@/components/stages/PublishStage";
import { api, ApiError, uploadFile } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { useCredits } from "@/context/CreditContext";
import { useJobPolling } from "@/hooks/use-job-polling";
import { formatCredits, tintFor } from "@/app/_lib/format";
import type {
  Asset,
  EstimateResponse,
  Job,
  Project,
  Stage,
  Transcript,
  Voice,
  VoiceMode,
} from "@/app/_lib/types";

function buildStageState(currentStage: Stage, status: Project["status"]): Record<Stage, StepState> {
  const curIdx = STAGE_ORDER.indexOf(currentStage);
  const state = {} as Record<Stage, StepState>;
  STAGE_ORDER.forEach((s, i) => {
    if (status === "ready") state[s] = s === "publish" ? "current" : "done";
    else if (i < curIdx) state[s] = "done";
    else if (i === curIdx) state[s] = "current";
    else state[s] = "locked";
  });
  return state;
}

export default function WorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const { balance, refresh: refreshWallet } = useCredits();

  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProject = useCallback(async () => {
    if (!token) return;
    try {
      const p = await api.projects.get(token, id);
      setProject(p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const { jobs, refresh: refreshJobs } = useJobPolling(token, project ? id : null);

  const [modal, setModal] = useState<{ open: boolean; cost: number; label: string }>({
    open: false,
    cost: 0,
    label: "",
  });

  function requestSpend(cost: number, label: string): boolean {
    if (balance >= cost) return true;
    setModal({ open: true, cost, label });
    return false;
  }

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface-page px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
          <FileQuestion size={22} strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-fg-primary">Project not found</h1>
        <p className="max-w-xs text-sm text-fg-secondary">This project may have been deleted or the link is wrong.</p>
        <Button variant="primary" icon={ArrowLeft} onClick={() => router.push("/")}>Back to projects</Button>
      </div>
    );
  }

  if (loading || !project || !token) {
    return <p className="p-8 text-sm text-fg-secondary">Loading…</p>;
  }

  return (
    <WorkspaceInner
      key={id}
      token={token}
      project={project}
      setProject={setProject}
      balance={balance}
      requestSpend={requestSpend}
      refreshWallet={refreshWallet}
      jobs={jobs}
      refreshJobs={refreshJobs}
      urlStage={searchParams.get("stage") as Stage | null}
      onStageChange={(s) => router.push(`/project/${id}?stage=${s}`)}
      modal={modal}
      setModal={setModal}
      onBack={() => router.push("/")}
    />
  );
}

interface InnerProps {
  token: string;
  project: Project;
  setProject: (p: Project) => void;
  balance: number;
  requestSpend: (cost: number, label: string) => boolean;
  refreshWallet: () => Promise<void>;
  jobs: ReturnType<typeof useJobPolling>["jobs"];
  refreshJobs: () => Promise<void>;
  urlStage: Stage | null;
  onStageChange: (s: Stage) => void;
  modal: { open: boolean; cost: number; label: string };
  setModal: (m: { open: boolean; cost: number; label: string }) => void;
  onBack: () => void;
}

function WorkspaceInner({
  token,
  project,
  setProject,
  balance,
  requestSpend,
  refreshWallet,
  jobs,
  refreshJobs,
  urlStage,
  onStageChange,
  modal,
  setModal,
  onBack,
}: InnerProps) {
  const activeStage: Stage = urlStage && STAGE_ORDER.includes(urlStage) ? urlStage : project.stage;
  const stageState = buildStageState(project.stage, project.status);
  const tint = tintFor(project.id);

  // ── Script ────────────────────────────────────────────────────────────────
  const [script, setScript] = useState(project.script);
  const [savingScript, setSavingScript] = useState(false);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [scriptDirty, setScriptDirty] = useState(false);
  const scriptSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistScript = useCallback(
    (text: string) => {
      if (scriptSaveTimer.current) clearTimeout(scriptSaveTimer.current);
      scriptSaveTimer.current = setTimeout(async () => {
        try {
          setSavingScript(true);
          setEstimating(true);
          // Bump stage past "script" the first time a non-empty script is saved, so Voice/Video
          // unlock in the stepper (the backend only advances `stage` itself once /generate runs).
          const stageBump = project.stage === "script" && text.trim().length > 0 ? { stage: "voice" as const } : {};
          const updated = await api.projects.patch(token, project.id, { script: text, ...stageBump });
          setProject(updated);
          const est = await api.estimate(token, { script: text, format: project.format, mode: project.voice_mode });
          setEstimate(est);
        } catch {
          // best-effort autosave — the textarea already holds the source of truth locally
        } finally {
          setSavingScript(false);
          setEstimating(false);
        }
      }, 600);
    },
    [token, project.id, project.format, project.voice_mode, project.stage, setProject]
  );

  useEffect(() => {
    if (project.script.trim().length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setEstimating(true);
        const est = await api.estimate(token, {
          script: project.script,
          format: project.format,
          mode: project.voice_mode,
        });
        if (!cancelled) setEstimate(est);
      } catch {
        // best-effort — the estimate strip just stays blank
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChangeScript(text: string): void {
    setScript(text);
    if (project.status === "ready" || project.status === "failed") setScriptDirty(true);
    persistScript(text);
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voiceId, setVoiceId] = useState<string | null>(project.voice_id);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(project.voice_mode);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [voiceGenerating, setVoiceGenerating] = useState(false);
  const [voiceGenerateError, setVoiceGenerateError] = useState<string | null>(null);

  const voiceJob =
    jobs
      .filter((j) => j.type === "voice_gen" || j.type === "voice_swap")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.voices(token);
        if (!cancelled) setVoices(list);
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleUploadRecording(file: File): Promise<void> {
    try {
      setUploadingRecording(true);
      const key = await uploadFile(token, "recording", file);
      setRecordingKey(key);
    } finally {
      setUploadingRecording(false);
    }
  }

  async function handleScriptContinue(): Promise<void> {
    if (project.stage === "script") {
      const updated = await api.projects.patch(token, project.id, { stage: "voice" });
      setProject(updated);
    }
    onStageChange("voice");
  }

  async function handleGenerateVoice(): Promise<void> {
    if (!estimate) return;
    if (voiceMode === "tts" && !voiceId) return;
    if (voiceMode === "swap" && !recordingKey) return;
    const voiceRate = voiceMode === "swap" ? 4 : 1;
    const voiceCost = estimate.minutes * voiceRate;
    if (!requestSpend(voiceCost, "Generate voice")) return;
    try {
      setVoiceGenerating(true);
      setVoiceGenerateError(null);
      await api.projects.patch(token, project.id, { voiceId, voiceMode });
      await api.projects.generateVoice(token, project.id, voiceMode === "swap" && recordingKey ? { recordingKey } : {});
      const updated = await api.projects.get(token, project.id);
      setProject(updated);
      await refreshJobs();
      await refreshWallet();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setModal({ open: true, cost: voiceCost, label: "Generate voice" });
      } else if (e instanceof ApiError) {
        setVoiceGenerateError(e.message);
      }
    } finally {
      setVoiceGenerating(false);
    }
  }

  async function handleVoiceApprove(): Promise<void> {
    const updated = await api.projects.patch(token, project.id, { stage: "video" });
    setProject(updated);
    onStageChange("video");
  }

  // ── Video / generate ────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    if (!estimate) return;
    const videoCost = estimate.minutes * 40;
    if (!requestSpend(videoCost, "Generate avatar video")) return;
    try {
      setGenerating(true);
      setGenerateError(null);
      await api.projects.generate(token, project.id, {});
      setScriptDirty(false);
      const updated = await api.projects.get(token, project.id);
      setProject(updated);
      await refreshJobs();
      await refreshWallet();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setModal({ open: true, cost: videoCost, label: "Generate avatar video" });
      } else if (e instanceof ApiError) {
        setGenerateError(e.message);
      }
    } finally {
      setGenerating(false);
    }
  }

  // ── Assets (review / publish) ───────────────────────────────────────────
  const [assets, setAssets] = useState<Asset[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const anyJobReady = jobs.some((j) => j.status === "ready");

  useEffect(() => {
    if (activeStage !== "render" && activeStage !== "publish") return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingAssets(true);
        const list = await api.assets.list(token, project.id);
        if (cancelled) return;
        setAssets(list);
        const video = list.find((a) => a.kind === "video");
        if (video) {
          const { url } = await api.assets.url(token, video.id);
          if (!cancelled) setVideoUrl(url);
        }
        const transcriptAsset = list.find((a) => a.kind === "transcript");
        if (transcriptAsset) {
          const { url } = await api.assets.url(token, transcriptAsset.id);
          const res = await fetch(url);
          if (res.ok && !cancelled) setTranscript((await res.json()) as Transcript);
        }
      } finally {
        if (!cancelled) setLoadingAssets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, token, project.id, anyJobReady]);

  async function handleDownload(asset: Asset): Promise<void> {
    const { url } = await api.assets.url(token, asset.id);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleRetryJob(job: Job): Promise<void> {
    if (job.type === "voice_gen" || job.type === "voice_swap") {
      await handleGenerateVoice();
      return;
    }
    if (job.type !== "video_gen") {
      await handleGenerate();
      return;
    }
    try {
      setGenerating(true);
      setGenerateError(null);
      await api.projects.retryVideo(token, project.id);
      const updated = await api.projects.get(token, project.id);
      setProject(updated);
      await refreshJobs();
      await refreshWallet();
    } catch (e) {
      setGenerateError(e instanceof ApiError ? e.message : "Retry failed");
    } finally {
      setGenerating(false);
    }
  }

  const videoAsset = assets.find((a) => a.kind === "video") ?? null;
  const transcriptAsset = assets.find((a) => a.kind === "transcript") ?? null;
  const notesAsset = assets.find((a) => a.kind === "notes_pdf") ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-page">
      {/* Minimal top bar — embedded-mode friendly */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line-subtle bg-surface-card/95 px-4 h-14 backdrop-blur-none">
        <button onClick={onBack} className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-fg-secondary hover:bg-surface-subtle hover:text-fg-primary">
          <ArrowLeft size={16} strokeWidth={2} /> <span className="hidden sm:inline">Projects</span>
        </button>
        <div className="h-5 w-px bg-line-muted" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight text-fg-primary">{project.title}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 rounded-sm border border-line-subtle bg-surface-page px-2.5 h-8">
          <Coins size={13} className="text-fg-secondary" strokeWidth={2} />
          <span className="tnum font-mono text-sm font-medium text-fg-primary">{formatCredits(balance)}</span>
        </div>
      </header>

      {/* Stepper */}
      <div className="sticky top-14 z-20 flex items-center justify-center border-b border-line-subtle bg-surface-page/95 px-4 py-3 backdrop-blur-none">
        <StageStepper stageState={stageState} active={activeStage} onSelect={onStageChange} />
      </div>

      {/* Body */}
      <div className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_300px] lg:px-8">
        <div className="min-w-0">
          {activeStage === "script" && (
            <ScriptStage
              script={script}
              format={project.format}
              voiceMode={project.voice_mode}
              onChangeScript={onChangeScript}
              estimate={estimate}
              estimating={estimating}
              saving={savingScript}
              onContinue={() => void handleScriptContinue()}
            />
          )}
          {activeStage === "voice" && (
            <VoiceStage
              voices={voices}
              loadingVoices={loadingVoices}
              voiceId={voiceId}
              voiceMode={voiceMode}
              recordingKey={recordingKey}
              uploadingRecording={uploadingRecording}
              onSelectVoice={setVoiceId}
              onChangeMode={setVoiceMode}
              onUploadRecording={(f) => void handleUploadRecording(f)}
              voiceJob={voiceJob}
              generating={voiceGenerating}
              generateError={voiceGenerateError}
              onGenerateVoice={() => void handleGenerateVoice()}
              onContinue={() => void handleVoiceApprove()}
            />
          )}
          {activeStage === "video" && (
            <VideoStage
              estimate={estimate}
              chainJobs={jobs}
              stale={scriptDirty}
              generating={generating}
              generateError={generateError}
              onGenerate={() => void handleGenerate()}
              onRetryJob={(job) => void handleRetryJob(job)}
            />
          )}
          {activeStage === "render" && (
            <ReviewStage videoUrl={videoUrl} transcriptWords={transcript?.words ?? null} loadingAssets={loadingAssets} />
          )}
          {activeStage === "publish" && (
            <PublishStage
              title={project.title}
              tint={tint}
              ready={project.status === "ready"}
              creditsSpent={project.credits_spent}
              videoAsset={videoAsset}
              transcriptAsset={transcriptAsset}
              notesAsset={notesAsset}
              onDownload={(a) => void handleDownload(a)}
              onJumpToReview={() => onStageChange("render")}
            />
          )}
        </div>

        {/* Preview */}
        <VideoPreview
          tint={tint}
          processing={project.status === "processing"}
          failed={project.status === "failed"}
          ready={project.status === "ready"}
          videoUrl={videoUrl}
          creditsSpent={project.credits_spent}
        />
      </div>

      <CreditModal open={modal.open} onClose={() => setModal({ ...modal, open: false })} cost={modal.cost} actionLabel={modal.label} />
    </div>
  );
}
