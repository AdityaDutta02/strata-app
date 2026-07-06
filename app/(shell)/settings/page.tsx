"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, Clapperboard, Mail, ChevronRight, UserPlus } from "lucide-react";
import Button from "@/components/Button";
import StatusPill, { jobStatusToAssetStatus } from "@/components/StatusPill";
import { api, ApiError } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { useCredits } from "@/context/CreditContext";
import { formatCredits } from "@/app/_lib/format";
import type { Avatar, Voice } from "@/app/_lib/types";

const SUPPORT_EMAIL = "support@strata.app";

function SectionCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-sm border border-line-subtle bg-surface-card" style={{ boxShadow: "var(--shadow-e1)" }}>
      <div className="border-b border-line-subtle px-5 py-4">
        <div className="eyebrow text-[10px] text-fg-secondary">{eyebrow}</div>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-fg-primary">{title}</h2>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

// Settings is trimmed to what the MVP data model actually supports (wallet + trained
// avatars/voices + onboarding link). The design's branding/voice-defaults/API-status/
// billing-plan sections assumed data that doesn't exist in this schema (see build spec) —
// dropped, keeping the SectionCard visual pattern for what remains.
export default function Settings() {
  const { token } = useAuth();
  const { balance, trialLeft } = useCredits();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [v, a] = await Promise.all([api.voices(token), api.avatars(token)]);
        if (!cancelled) {
          setVoices(v);
          setAvatars(a);
        }
      } catch (e) {
        if (!(e instanceof ApiError) && !cancelled) throw e;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6">
        <div>
          <div className="eyebrow text-[11px] text-fg-secondary">Configure</div>
          <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
            Settings
          </h1>
          <p className="mt-2 text-sm text-fg-secondary">Your workspace, avatars and voices.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-5 max-w-[760px]">
        {/* ── Billing & credits ── */}
        <SectionCard eyebrow="Billing" title="Credits">
          <div className="flex items-center justify-between rounded-sm border border-line-subtle bg-surface-subtle px-4 py-4">
            <div>
              <p className="eyebrow text-[10px] text-fg-secondary">Current balance</p>
              <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-fg-primary">
                {formatCredits(balance)}
                <span className="ml-1.5 text-base font-normal text-fg-secondary">credits</span>
              </p>
              {trialLeft > 0 && (
                <p className="tnum mt-1 text-xs text-fg-secondary">
                  Includes <span className="font-medium text-fg-primary">{formatCredits(trialLeft)}</span> trial credits
                </p>
              )}
            </div>
            <Button
              variant="accent"
              icon={Mail}
              onClick={() => {
                window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Strata credit top-up")}`;
              }}
            >
              Contact admin to top up
            </Button>
          </div>
        </SectionCard>

        {/* ── Avatars ── */}
        <SectionCard eyebrow="Video" title="Your avatars">
          {loading ? (
            <p className="text-sm text-fg-secondary">Loading…</p>
          ) : avatars.length === 0 ? (
            <p className="text-sm text-fg-secondary">No avatars trained yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line-subtle">
              {avatars.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
                    <Clapperboard size={14} strokeWidth={2} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{a.name}</span>
                  <StatusPill status={jobStatusToAssetStatus(a.status === "training" ? "processing" : a.status === "ready" ? "ready" : "failed")} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <Link href="/onboard">
              <Button variant="secondary" icon={UserPlus}>Train new avatar</Button>
            </Link>
          </div>
        </SectionCard>

        {/* ── Voices ── */}
        <SectionCard eyebrow="Audio" title="Your voices">
          {loading ? (
            <p className="text-sm text-fg-secondary">Loading…</p>
          ) : voices.length === 0 ? (
            <p className="text-sm text-fg-secondary">No voices trained yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line-subtle">
              {voices.map((v) => (
                <div key={v.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-subtle text-fg-secondary">
                    <Mic size={14} strokeWidth={2} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{v.name}</span>
                  <StatusPill status={jobStatusToAssetStatus(v.status === "training" ? "processing" : v.status === "ready" ? "ready" : "failed")} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <Link href="/onboard">
              <Button variant="secondary" icon={UserPlus}>Train new voice</Button>
            </Link>
          </div>
        </SectionCard>

        <div className="flex items-center justify-between">
          <p className="text-sm text-fg-secondary">Need help with your workspace?</p>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}`;
            }}
          >
            Contact support
            <ChevronRight size={13} strokeWidth={2} className="ml-0.5" />
          </Button>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}
