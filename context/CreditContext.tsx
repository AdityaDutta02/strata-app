"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "@/app/_lib/api-client";
import { useAuth } from "./AuthContext";

interface CreditCtx {
  balance: number;
  trialLeft: number;
  loading: boolean;
  canAfford: (n: number) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<CreditCtx | null>(null);

// MVP has no payments UI — balance only ever moves via server-side job reservation/refund
// or a manual admin top-up, so this context is read-only: it fetches /api/wallet and
// exposes refresh() for callers to re-sync after an action (e.g. after generate()).
export function CreditProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState(0);
  const [trialLeft, setTrialLeft] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      setLoading(true);
      const wallet = await api.wallet(token);
      setBalance(wallet.balance);
      setTrialLeft(wallet.trialLeft);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canAfford = useCallback((n: number) => balance >= n, [balance]);

  const value = useMemo<CreditCtx>(
    () => ({ balance, trialLeft, loading, canAfford, refresh }),
    [balance, trialLeft, loading, canAfford, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCredits(): CreditCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCredits must be used within CreditProvider");
  return c;
}
