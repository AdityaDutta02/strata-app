"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/app/_lib/api-client";
import type { Job } from "@/app/_lib/types";

const POLL_INTERVAL_MS = 5000;

function jobsAreActive(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "processing");
}

/**
 * Polls GET /api/jobs?projectId= at most every 5s while any job for the project is
 * still queued/processing. Pauses while the tab is hidden per docs/BUILD-SPEC-MVP.md.
 */
export function useJobPolling(
  token: string | null,
  projectId: string | null
): {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestJobsRef = useRef<Job[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async (): Promise<Job[]> => {
    if (!token || !projectId) return [];
    try {
      const next = await api.jobs.list(token, projectId);
      latestJobsRef.current = next;
      setJobs(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load job status");
      return latestJobsRef.current;
    } finally {
      setLoading(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !projectId) return;
    let cancelled = false;

    async function tick(): Promise<void> {
      if (cancelled) return;
      const result = await fetchOnce();
      if (cancelled) return;
      if (document.hidden || !jobsAreActive(result)) {
        timerRef.current = null;
        return;
      }
      timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }

    function onVisibilityChange(): void {
      if (!document.hidden && timerRef.current === null && jobsAreActive(latestJobsRef.current)) {
        void tick();
      }
    }

    void tick();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [token, projectId, fetchOnce]);

  return { jobs, loading, error, refresh: async () => { await fetchOnce(); } };
}
