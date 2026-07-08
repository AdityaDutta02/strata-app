"use client";
import { Mail, ChevronRight } from "lucide-react";
import Button from "@/components/Button";
import { useCredits } from "@/context/CreditContext";
import { formatCredits } from "@/app/_lib/format";

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

// Settings is trimmed to what the MVP data model actually supports (wallet only — avatar
// and voice management moved to the dedicated Avatars tab, see app/(shell)/avatars/page.tsx).
export default function Settings() {
  const { balance, trialLeft } = useCredits();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6">
        <div>
          <div className="eyebrow text-[11px] text-fg-secondary">Configure</div>
          <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">Settings</h1>
          <p className="mt-2 text-sm text-fg-secondary">Your workspace billing.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-5 max-w-[760px]">
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
