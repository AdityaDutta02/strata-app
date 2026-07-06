"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Menu, X, Coins } from "lucide-react";
import Sidebar from "./Sidebar";
import { formatCredits } from "@/app/_lib/format";
import { useCredits } from "@/context/CreditContext";

export default function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { balance } = useCredits();

  return (
    <div className="flex h-full min-h-dvh w-full bg-surface-page text-fg-default">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[232px] shrink-0 border-r border-line-subtle">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[248px] border-r border-line-subtle shadow-e3">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex lg:hidden items-center justify-between gap-3 border-b border-line-subtle bg-surface-card px-4 h-14">
          <button
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setNavOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-default hover:bg-surface-subtle"
          >
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="text-base font-medium tracking-tight text-fg-primary">Strata</span>
          <div className="flex items-center gap-1.5 rounded-sm border border-line-subtle bg-surface-page px-2 h-7">
            <Coins size={13} className="text-fg-secondary" strokeWidth={2} />
            <span className="tnum font-mono text-sm font-medium text-fg-primary">
              {formatCredits(balance)}
            </span>
          </div>
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
