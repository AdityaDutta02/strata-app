"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, FolderOpen, Settings, Layers, Coins, Plus, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Button from "./Button";
import { formatCredits } from "@/app/_lib/format";
import { useCredits } from "@/context/CreditContext";

const SUPPORT_EMAIL = "support@strata.app";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Projects", icon: LayoutGrid },
  { to: "/library", label: "Library", icon: FolderOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { balance } = useCredits();

  return (
    <div className="flex h-full w-full flex-col bg-surface-card">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-line-subtle">
        <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-fg">
          <Layers size={16} strokeWidth={2.25} />
        </div>
        <span className="text-[17px] font-semibold tracking-tight text-fg-primary">Strata</span>
      </div>

      {/* New video CTA */}
      <div className="px-3 pt-3">
        <Button
          variant="primary"
          icon={Plus}
          fullWidth
          data-testid="new-project-cta"
          onClick={() => {
            router.push("/project/new");
            onNavigate?.();
          }}
        >
          New video
        </Button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-3 pt-4">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              href={item.to}
              onClick={onNavigate}
              className={[
                "flex items-center gap-2.5 rounded-sm px-2.5 h-9 text-sm",
                isActive
                  ? "bg-surface-subtle text-fg-primary font-medium"
                  : "text-fg-secondary hover:bg-surface-subtle hover:text-fg-primary font-normal",
              ].join(" ")}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Credits — persistent */}
      <div className="p-3">
        <div className="rounded-sm border border-line-subtle bg-surface-page p-3">
          <div className="eyebrow flex items-center gap-1.5 text-[10px] text-fg-secondary">
            <Coins size={12} strokeWidth={2} />
            Credits
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="tnum font-mono text-xl font-medium text-fg-primary">
              {formatCredits(balance)}
            </span>
          </div>
          <div className="mt-2.5">
            <Button
              variant="secondary"
              size="sm"
              icon={Mail}
              fullWidth
              onClick={() => {
                window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                  "Strata credit top-up"
                )}`;
              }}
            >
              Top up
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
