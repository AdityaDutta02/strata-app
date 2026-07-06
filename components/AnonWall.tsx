"use client";
import { Layers, LogIn } from "lucide-react";
import Button from "./Button";

const PLATFORM_URL =
  process.env.NEXT_PUBLIC_TERMINAL_AI_PLATFORM_URL ?? "https://terminalai.studioionique.com";

// Anonymous viewers (isAnon in token claims / no token) hit a full-screen hard wall —
// nothing else renders. Matches the design language of BrandedLoader.
export default function AnonWall() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-page px-6 text-center">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-primary text-primary-fg">
          <Layers size={24} strokeWidth={2.25} />
        </div>
        <span className="text-2xl font-semibold tracking-tight text-fg-primary">Strata</span>
      </div>

      <div className="max-w-xs">
        <h1 className="text-lg font-semibold tracking-tight text-fg-primary">Sign in to continue</h1>
        <p className="mt-1.5 text-sm text-fg-secondary">
          Strata workspaces are personal. Sign in with your Terminal AI account to create and manage videos.
        </p>
      </div>

      <Button
        variant="primary"
        icon={LogIn}
        onClick={() => {
          window.location.href = PLATFORM_URL;
        }}
      >
        Sign in
      </Button>
    </div>
  );
}
