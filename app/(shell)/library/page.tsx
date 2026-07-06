"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Film, Mic, FileType, FolderOpen, X, Play, Download } from "lucide-react";
import Button from "@/components/Button";
import { api, ApiError } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { formatDuration, posterGradient, tintFor } from "@/app/_lib/format";
import type { Asset, Project } from "@/app/_lib/types";

// The API contract only defines project-scoped GET /api/assets?projectId=; there is no
// workspace-wide listing endpoint. This page aggregates by fetching assets per ready
// project client-side. Recommend backend add an optional workspace-wide GET /api/assets
// (no projectId) for efficiency if the library grows large.

type LibTab = "video" | "audio" | "notes" | "uploads";

interface AssetRow extends Asset {
  projectTitle: string;
  projectTint: 0 | 1 | 2 | 3;
}

const TABS: { key: LibTab; label: string; icon: typeof Film }[] = [
  { key: "video", label: "Video", icon: Film },
  { key: "audio", label: "Audio", icon: Mic },
  { key: "notes", label: "Notes", icon: FileType },
  { key: "uploads", label: "Uploads", icon: FolderOpen },
];

function kindsForTab(tab: LibTab): Asset["kind"][] {
  switch (tab) {
    case "video":
      return ["video"];
    case "audio":
      return ["audio"];
    case "notes":
      return ["notes", "notes_pdf"];
    case "uploads":
      return ["upload"];
  }
}

export default function Library() {
  const { token } = useAuth();
  const [tab, setTab] = useState<LibTab>("video");
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const projects: Project[] = await api.projects.list(token);
        const rows = await Promise.all(
          projects.map(async (p): Promise<AssetRow[]> => {
            try {
              const list = await api.assets.list(token, p.id);
              return list.map((a) => ({ ...a, projectTitle: p.title, projectTint: tintFor(p.id) }));
            } catch {
              return [];
            }
          })
        );
        if (!cancelled) setAssets(rows.flat());
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load library");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(() => {
    const kinds = kindsForTab(tab);
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => kinds.includes(a.kind))
      .filter((a) => q === "" || a.projectTitle.toLowerCase().includes(q));
  }, [assets, tab, query]);

  const counts = useMemo(
    () =>
      TABS.reduce<Record<LibTab, number>>((acc, t) => {
        const kinds = kindsForTab(t.key);
        acc[t.key] = assets.filter((a) => kinds.includes(a.kind)).length;
        return acc;
      }, { video: 0, audio: 0, notes: 0, uploads: 0 }),
    [assets]
  );

  async function handleDownload(assetId: string): Promise<void> {
    if (!token) return;
    const { url } = await api.assets.url(token, assetId);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6">
        <div>
          <div className="eyebrow text-[11px] text-fg-secondary">Assets</div>
          <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
            Library
          </h1>
          <p className="mt-2 text-sm text-fg-secondary">
            <span className="tnum">{assets.length}</span> assets across all projects
          </p>
        </div>

        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary"
            strokeWidth={2}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by project"
            className="h-9 w-52 rounded-sm border border-line-default bg-surface-card pl-8 pr-8 text-sm text-fg-default placeholder:text-fg-secondary outline-none focus:border-line-focus focus:ring-2 focus:ring-line-focus/30"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary hover:text-fg-primary"
            >
              <X size={13} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs — underline register */}
      <div className="mt-6 flex items-center gap-6 border-b border-line-subtle">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "group -mb-px inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium tracking-tight",
                active ? "border-fg-primary text-fg-primary" : "border-transparent text-fg-secondary hover:text-fg-primary",
              ].join(" ")}
            >
              {t.label}
              <span
                className={[
                  "tnum rounded-sm px-1.5 text-[11px] font-mono leading-none py-0.5",
                  active ? "bg-primary text-primary-fg" : "bg-surface-muted text-fg-secondary",
                ].join(" ")}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-fg-secondary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-error">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-line-muted bg-surface-card px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary">
              <FolderOpen size={22} strokeWidth={1.75} />
            </div>
            <h3 className="mt-3 text-base font-medium text-fg-primary">Nothing here yet</h3>
            <p className="mt-1 max-w-xs text-sm text-fg-secondary">
              Assets show up here once a project finishes generating.
            </p>
          </div>
        ) : tab === "video" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((a) => (
              <div key={a.id} className="group relative flex flex-col overflow-hidden rounded-sm border border-line-subtle bg-surface-card" style={{ boxShadow: "var(--shadow-e1)" }}>
                <div className="relative w-full" style={{ paddingBottom: "177.78%", background: posterGradient(a.projectTint) }}>
                  {a.duration_sec != null && (
                    <span className="tnum absolute bottom-2 right-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[11px] font-mono text-white">
                      {formatDuration(a.duration_sec)}
                    </span>
                  )}
                  <button
                    onClick={() => void handleDownload(a.id)}
                    className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
                      <Play size={18} strokeWidth={2} />
                    </div>
                  </button>
                </div>
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-medium text-fg-primary">{a.projectTitle}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-line-subtle bg-surface-card" style={{ boxShadow: "var(--shadow-e1)" }}>
            {filtered.map((a) => (
              <div key={a.id} className="flex items-center gap-4 border-b border-line-subtle px-4 py-3 last:border-0 hover:bg-surface-subtle">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg-primary">{a.projectTitle}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-secondary">{a.kind}</p>
                </div>
                {a.duration_sec != null && (
                  <span className="tnum shrink-0 text-xs text-fg-secondary">{formatDuration(a.duration_sec)}</span>
                )}
                <Button variant="subtle" size="sm" icon={Download} onClick={() => void handleDownload(a.id)}>
                  Download
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
