"use client";
import { useEffect, useRef, useState } from "react";
import { useEmbedToken } from "@/hooks/use-embed-token";

interface DevJob {
  id: string;
  status: string;
  provider_job_id: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

export default function VoiceTrainDevPage() {
  const token = useEmbedToken();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [jobs, setJobs] = useState<DevJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadJobs(): Promise<void> {
    if (!token) return;
    const res = await fetch("/api/dev/voice-train", { headers: { "x-embed-token": token } });
    const body = await res.json();
    setJobs(body.jobs ?? []);
  }

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function run(): Promise<void> {
    if (!token || !file || !title.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("sample", file);
      form.append("title", title);
      const res = await fetch("/api/dev/voice-train", {
        method: "POST",
        headers: { "x-embed-token": token },
        body: form,
      });
      const body = await res.json();
      setResult(body);
      await loadJobs();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  if (!token) return <p style={{ padding: 24, fontFamily: "monospace" }}>Waiting for embed token…</p>;

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 900 }}>
      <h1>Dev 1 — Voice train (Fish Audio)</h1>
      <p>POST /model (real API, always). No mock mode.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <label>
          Title:{" "}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="my-test-voice" />
        </label>
        <label>
          Sample audio (wav/mp3/m4a/opus, min ~10s):{" "}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button onClick={() => void run()} disabled={running || !file || !title.trim()}>
          {running ? "Training…" : "Run"}
        </button>
      </div>

      {result != null && (
        <pre style={{ background: "#111", color: "#0f0", padding: 12, overflowX: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      <h2>History</h2>
      <table border={1} cellPadding={4} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>created</th>
            <th>status</th>
            <th>voiceId</th>
            <th>input</th>
            <th>error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.created_at}</td>
              <td>{j.status}</td>
              <td>{j.provider_job_id ?? "—"}</td>
              <td>{JSON.stringify(j.input_json)}</td>
              <td>{j.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
