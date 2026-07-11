"use client";
import type { ReactNode } from "react";
import { useEmbedToken } from "@/hooks/use-embed-token";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CreditProvider } from "@/context/CreditContext";
import BrandedLoader from "@/components/BrandedLoader";
import AnonWall from "@/components/AnonWall";
import ErrorScreen from "@/components/ErrorScreen";

function Gate({ children }: { children: ReactNode }) {
  const { loading, isAnon, error, refreshMe } = useAuth();

  if (loading) return <BrandedLoader />;
  if (error) return <ErrorScreen message={error} onRetry={() => void refreshMe()} />;
  if (isAnon) return <AnonWall />;

  return <CreditProvider>{children}</CreditProvider>;
}

export default function Providers({ children }: { children: ReactNode }) {
  const token = useEmbedToken();
  return (
    <AuthProvider token={token}>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
