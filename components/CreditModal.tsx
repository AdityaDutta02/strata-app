"use client";
import { useEffect } from "react";
import { X, Coins, Mail } from "lucide-react";
import Button from "./Button";
import { useCredits } from "@/context/CreditContext";
import { formatCredits } from "@/app/_lib/format";

const SUPPORT_EMAIL = "support@strata.app";

interface CreditModalProps {
  open: boolean;
  onClose: () => void;
  cost: number;
  actionLabel: string; // e.g. "Generate avatar video"
}

// 402 INSUFFICIENT_CREDITS — modal, not toast. MVP has no payments UI: top-up is
// "contact admin" only (docs/BUILD-SPEC-MVP.md).
export default function CreditModal({ open, onClose, cost, actionLabel }: CreditModalProps) {
  const { balance } = useCredits();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const shortfall = Math.max(0, cost - balance);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-modal-title"
        className="relative w-full max-w-[400px] rounded-md border border-line-subtle bg-surface-card shadow-e4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-warning-bg text-warning">
              <Coins size={18} strokeWidth={2} />
            </div>
            <div>
              <h2 id="credit-modal-title" className="text-base font-semibold tracking-tight text-fg-primary">
                Not enough credits
              </h2>
              <p className="text-xs text-fg-secondary">{actionLabel} needs more than you have</p>
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-surface-subtle hover:text-fg-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 p-5">
          <Row label="This action" value={`≈ ${formatCredits(cost)}`} />
          <Row label="Your balance" value={formatCredits(balance)} muted />
          <div className="my-1 border-t border-line-subtle" />
          <Row label="Shortfall" value={`${formatCredits(shortfall)}`} emphasis />
        </div>

        <div className="flex flex-col gap-2 border-t border-line-subtle p-5">
          <Button
            variant="accent"
            icon={Mail}
            fullWidth
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                "Strata credit top-up"
              )}`;
            }}
          >
            Contact admin to top up
          </Button>
          <Button variant="subtle" fullWidth onClick={onClose}>
            Back to stage
          </Button>
          <p className="text-center text-[11px] text-fg-secondary">
            You&apos;ll return to exactly where you left off.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  emphasis,
}: {
  label: string;
  value: string;
  muted?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${muted ? "text-fg-secondary" : "text-fg-default"}`}>{label}</span>
      <span
        className={[
          "tnum font-mono text-sm",
          emphasis ? "font-medium text-warning" : muted ? "text-fg-secondary" : "text-fg-primary",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
