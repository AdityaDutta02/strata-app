"use client";
import { AlertTriangle } from "lucide-react";
import Button from "./Button";

export default function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-page px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-error/10 text-error">
        <AlertTriangle size={22} strokeWidth={2} />
      </div>
      <div className="max-w-xs">
        <h1 className="text-lg font-semibold tracking-tight text-fg-primary">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-fg-secondary">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
