"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "@/app/_lib/api-client";
import type { Workspace } from "@/app/_lib/types";

interface AuthCtxValue {
  token: string | null;
  workspace: Workspace | null;
  isAnon: boolean;
  loading: boolean;
  error: string | null;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthCtxValue | null>(null);

/**
 * Bootstraps GET /api/me once an embed token is available. Exposes workspace + isAnon
 * so the rest of the app can gate on it (BrandedLoader while loading, hard wall if anon).
 */
export function AuthProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isAnon, setIsAnon] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      setFetching(true);
      setError(null);
      const res = await api.me(token);
      setWorkspace(res.workspace);
      setIsAnon(res.isAnon);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to connect to your workspace");
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void refreshMe();
  }, [token, refreshMe]);

  const value = useMemo<AuthCtxValue>(
    () => ({
      token,
      workspace,
      isAnon,
      loading: token === null ? true : fetching,
      error,
      refreshMe,
    }),
    [token, workspace, isAnon, fetching, error, refreshMe]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtxValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
