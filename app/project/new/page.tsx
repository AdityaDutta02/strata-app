"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle, Check } from "lucide-react";
import Button from "@/components/Button";
import { api, ApiError } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import type { Format } from "@/app/_lib/types";

// CreateFlow adapted per docs/BUILD-SPEC-MVP.md: the design's 3-step idea/format/style
// wizard assumed AI script generation and per-scene style, neither of which exist in this
// schema (projects only have title/format/language — see db-migrations.sql). Trimmed to
// 2 steps (title, format) that map directly onto POST /api/projects, keeping the same
// progress-bar / card visual language.

const FORMATS: { id: Format; label: string; sub: string; grad: string; aspect: string }[] = [
  { id: "vertical", label: "Vertical", sub: "9:16 — Reels, Shorts, TikTok", grad: "var(--poster-grad-0)", aspect: "aspect-[9/16] w-9" },
  { id: "horizontal", label: "Horizontal", sub: "16:9 — YouTube, presentations", grad: "var(--poster-grad-3)", aspect: "aspect-[16/9] w-16" },
];

function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100);
  return (
    <div className="h-[2px] w-full bg-surface-muted overflow-hidden rounded-full">
      <div className="h-full bg-[#0A0A0B] transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function CreateFlow() {
  const router = useRouter();
  const { token } = useAuth();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 2;

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [format, setFormat] = useState<Format | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step1Valid = title.trim().length > 0;
  const step2Valid = format !== null;

  function canContinue(): boolean {
    if (step === 1) return step1Valid;
    if (step === 2) return step2Valid;
    return false;
  }

  async function handleContinue(): Promise<void> {
    if (step === 1) {
      if (!step1Valid) {
        setTitleTouched(true);
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2 && format && token) {
      try {
        setCreating(true);
        setError(null);
        const project = await api.projects.create(token, { title: title.trim(), format });
        router.push(`/project/${project.id}?stage=script`);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not create project");
      } finally {
        setCreating(false);
      }
    }
  }

  function handleBack(): void {
    if (step > 1) setStep((s) => s - 1);
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <header className="sticky top-0 z-20 border-b border-line-subtle bg-surface-page/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[640px] items-center gap-4 px-5 py-3">
          <button
            onClick={() => router.push("/")}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-surface-subtle hover:text-fg-primary"
            aria-label="Back to projects"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="eyebrow text-[13px] font-semibold tracking-widest text-fg-primary">Strata</span>
          <div className="flex-1" />
          <span className="eyebrow text-[11px] text-fg-secondary">
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
        <div className="mx-auto max-w-[640px] px-5 pb-0">
          <ProgressBar step={step} total={TOTAL_STEPS} />
        </div>
        <div className="h-3" />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-5 py-10 pb-36">
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <div className="eyebrow text-[11px] text-fg-secondary">New video</div>
                <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
                  What&apos;s this video called?
                </h1>
                <p className="mt-2 text-sm text-fg-secondary">
                  Give it a title — you&apos;ll upload the script next.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-fg-default" htmlFor="title-input">
                  Title
                </label>
                <input
                  id="title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => setTitleTouched(true)}
                  placeholder="e.g. Q3 product launch"
                  className={[
                    "h-11 w-full rounded-sm border bg-surface-card px-3.5 text-[16px] text-fg-default",
                    "placeholder:text-fg-secondary outline-none transition-colors",
                    "focus:border-line-focus focus:ring-2 focus:ring-[rgba(46,75,235,0.28)]",
                    titleTouched && !step1Valid ? "border-[#D0342C] ring-2 ring-[rgba(208,52,44,0.18)]" : "border-line-default",
                  ].join(" ")}
                />
                {titleTouched && !step1Valid && (
                  <div className="flex items-center gap-1.5 text-[13px] text-[#D0342C]">
                    <AlertCircle size={13} strokeWidth={2} />
                    Give your video a title before continuing.
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-8">
              <div>
                <div className="eyebrow text-[11px] text-fg-secondary">Step 2</div>
                <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
                  Pick a format
                </h1>
                <p className="mt-2 text-sm text-fg-secondary">Choose the orientation for this video.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {FORMATS.map((f) => {
                  const selected = format === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id)}
                      className={[
                        "flex flex-col items-center gap-3 rounded-sm border px-6 py-5 transition-all",
                        selected
                          ? "border-[#2E4BEB] bg-[rgba(46,75,235,0.05)] ring-2 ring-[rgba(46,75,235,0.28)]"
                          : "border-line-muted bg-surface-card hover:border-line-default hover:bg-surface-subtle",
                      ].join(" ")}
                    >
                      <div className={`relative flex h-16 items-center justify-center rounded-sm ${f.aspect}`} style={{ background: f.grad }}>
                        {selected && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90">
                              <Check size={11} strokeWidth={2.5} className="text-[#2E4BEB]" />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-center">
                        <div className={["text-sm font-medium", selected ? "text-[#2E4BEB]" : "text-fg-primary"].join(" ")}>
                          {f.label}
                        </div>
                        <div className="mt-0.5 text-[12px] text-fg-secondary">{f.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {error && <p className="text-sm text-error">{error}</p>}
            </div>
          )}
        </div>
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-line-subtle bg-surface-page/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3 px-5 py-4">
          <div>
            {step > 1 ? (
              <Button variant="subtle" onClick={handleBack}>
                Back
              </Button>
            ) : (
              <div />
            )}
          </div>
          <div className="flex items-center gap-3">
            {step < TOTAL_STEPS ? (
              <Button variant="primary" disabled={!canContinue()} onClick={() => void handleContinue()}>
                Continue
              </Button>
            ) : (
              <Button variant="accent" disabled={!canContinue() || creating} onClick={() => void handleContinue()}>
                {creating ? "Creating…" : "Create project"}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
