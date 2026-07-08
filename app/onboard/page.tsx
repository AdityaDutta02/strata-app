"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Onboarding now lives at /avatars (single Avatars tab, not a standalone route).
// Kept as a redirect so old links/bookmarks still land somewhere useful.
export default function OnboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/avatars");
  }, [router]);
  return null;
}
