"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Plus, FolderPlus, UserPlus } from "lucide-react";
import Button from "@/components/Button";
import ProjectCard from "@/components/ProjectCard";
import { api, ApiError } from "@/app/_lib/api-client";
import { useAuth } from "@/context/AuthContext";
import type { Project } from "@/app/_lib/types";

type Filter = "all" | "progress" | "ready" | "failed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "progress", label: "In progress" },
  { key: "ready", label: "Ready" },
  { key: "failed", label: "Failed" },
];

function matchesFilter(p: Project, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "progress") return p.status === "draft" || p.status === "processing";
  if (f === "ready") return p.status === "ready";
  return p.status === "failed";
}

export default function Dashboard() {
  const router = useRouter();
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [hasAvatar, setHasAvatar] = useState(true); // optimistic — avoids a flash before load

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, avatars] = await Promise.all([api.projects.list(token), api.avatars(token)]);
        if (!cancelled) {
          setProjects(list);
          setHasAvatar(avatars.length > 0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const counts = useMemo(
    () => ({
      all: projects.length,
      progress: projects.filter((p) => p.status === "draft" || p.status === "processing").length,
      ready: projects.filter((p) => p.status === "ready").length,
      failed: projects.filter((p) => p.status === "failed").length,
    }),
    [projects]
  );

  const processing = projects.filter((p) => p.status === "processing").length;

  async function handleDeleteProject(id: string): Promise<void> {
    if (!token) return;
    await api.projects.remove(token, id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => q === "" || p.title.toLowerCase().includes(q));
  }, [projects, filter, query]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6">
        <div>
          <div className="eyebrow text-[11px] text-fg-secondary">Workspace</div>
          <h1 className="mt-2 text-[42px] font-semibold leading-[1.05] tracking-tight text-fg-primary">
            Projects
          </h1>
          <p className="mt-2 text-sm text-fg-secondary">
            <span className="tnum">{counts.all}</span> projects
            {processing > 0 && (
              <>
                {" · "}
                <span className="tnum text-accent">{processing} processing now</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary"
              strokeWidth={2}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              className="h-9 w-52 rounded-sm border border-line-default bg-surface-card pl-8 pr-2.5 text-sm text-fg-default placeholder:text-fg-secondary outline-none focus:border-line-focus focus:ring-2 focus:ring-line-focus/30"
            />
          </div>
          <Button
            variant="primary"
            icon={Plus}
            data-testid="new-project-cta"
            onClick={() => router.push("/project/new")}
          >
            New video
          </Button>
        </div>
      </div>

      {!loading && !hasAvatar && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-sm border border-line-subtle bg-surface-subtle px-4 py-3">
          <p className="text-sm text-fg-secondary">Train your avatar &amp; voice before generating a video.</p>
          <Link href="/avatars">
            <Button variant="secondary" size="sm" icon={UserPlus}>Add avatar</Button>
          </Link>
        </div>
      )}

      {/* Filter tabs — underline register */}
      <div className="mt-6 flex items-center gap-6 border-b border-line-subtle">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "group -mb-px inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium tracking-tight",
                active
                  ? "border-fg-primary text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary",
              ].join(" ")}
            >
              {f.label}
              <span
                className={[
                  "tnum rounded-sm px-1.5 text-[11px] font-mono leading-none py-0.5",
                  active ? "bg-primary text-primary-fg" : "bg-surface-muted text-fg-secondary",
                ].join(" ")}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid or empty */}
      {loading ? (
        <p className="mt-5 text-sm text-fg-secondary">Loading projects…</p>
      ) : error ? (
        <p className="mt-5 text-sm text-error">{error}</p>
      ) : visible.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={() => void handleDeleteProject(p.id)} />
          ))}
        </div>
      ) : (
        <div className="mt-5 flex flex-col items-center justify-center rounded-sm border border-dashed border-line-muted bg-surface-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary">
            <FolderPlus size={22} strokeWidth={1.75} />
          </div>
          <h3 className="mt-3 text-base font-medium text-fg-primary">
            {query.trim() ? "No matching projects" : "Nothing here yet"}
          </h3>
          <p className="mt-1 max-w-xs text-sm text-fg-secondary">
            {query.trim()
              ? "Try a different search or clear the filter."
              : "Upload a script and Strata handles voice, avatar video, transcript and notes."}
          </p>
          <div className="mt-4">
            {query.trim() ? (
              <Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); }}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" icon={Plus} onClick={() => router.push("/project/new")}>
                Create your first video
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
