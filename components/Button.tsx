"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "secondary" | "subtle" | "accent" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  cost?: number; // credit cost badge — "never hide the money"
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  // solid near-black — the standard primary action
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-pressed border border-transparent",
  // outlined white — the workhorse neutral button
  secondary:
    "bg-surface-card text-fg-primary hover:bg-surface-subtle active:bg-surface-muted border border-line-default",
  // ghost
  subtle:
    "bg-transparent text-fg-default hover:bg-surface-subtle active:bg-surface-muted border border-transparent",
  // cobalt — reserved for generate / render (the money buttons)
  accent:
    "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-pressed border border-transparent",
  danger:
    "bg-error text-fg-inverse hover:opacity-90 active:opacity-80 border border-transparent",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export default function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  cost,
  fullWidth,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  const Icon = icon;
  const iconSize = size === "sm" ? 14 : 16;
  const onDark = variant === "primary" || variant === "accent" || variant === "danger";
  return (
    <button
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center rounded-sm font-medium whitespace-nowrap tracking-tight",
        "outline-none focus-visible:ring-2 focus-visible:ring-line-focus/30 focus-visible:border-line-focus",
        "disabled:opacity-40 disabled:pointer-events-none select-none transition-colors",
        VARIANTS[variant],
        SIZES[size],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {Icon ? <Icon size={iconSize} strokeWidth={2} /> : null}
      {children}
      {typeof cost === "number" ? (
        <span
          className={[
            "tnum ml-0.5 inline-flex items-center rounded-sm px-1.5 text-[11px] font-mono font-medium leading-none py-1",
            onDark ? "bg-white/20 text-white" : "bg-accent-subtle text-accent",
          ].join(" ")}
        >
          ≈{cost.toLocaleString("en-US")}
        </span>
      ) : null}
    </button>
  );
}
