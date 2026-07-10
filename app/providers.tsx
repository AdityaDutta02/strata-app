"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
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

// /dev/** is an isolated engineering harness for verifying provider APIs in isolation —
// it must not go through the real-account/credits gate (it has no wallet, no project, no
// avatar cap). It still needs a real embed token to authenticate gateway calls, so each
// /dev page pulls its own token via useEmbedToken() rather than reading it from context here.
export default function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const token = useEmbedToken();
  if (pathname?.startsWith("/dev")) return <>{children}</>;
  return (
    <AuthProvider token={token}>
      <Gate>{children}</Gate>
    </AuthProvider>
  );
}
