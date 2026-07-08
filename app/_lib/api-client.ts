import type {
  Asset,
  AssetUrlResponse,
  Avatar,
  EstimateResponse,
  GenerateResponse,
  Job,
  MeResponse,
  OnboardResponse,
  PresignResponse,
  Project,
  ProjectCreateInput,
  ProjectPatchInput,
  UploadKind,
  Voice,
  VoiceMode,
  WalletResponse,
  Format,
} from "./types";

// Typed client-side fetch wrapper. Every request carries the embed token in the
// `x-embed-token` header per docs/BUILD-SPEC-MVP.md; the server derives viewer_id from it.
// Every route wraps its payload in a per-resource envelope (e.g. `{ project }`,
// `{ projects }`) — see app/api/**/route.ts. This client unwraps them so callers just get
// the typed value.
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-embed-token": token,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
        message = (body as { error: string }).error;
      }
    } catch {
      // response had no JSON body — keep the default message
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: (token: string): Promise<MeResponse> => request<MeResponse>(token, "/api/me"),

  wallet: (token: string): Promise<WalletResponse> => request<WalletResponse>(token, "/api/wallet"),

  projects: {
    list: async (token: string): Promise<Project[]> =>
      (await request<{ projects: Project[] }>(token, "/api/projects")).projects,
    get: async (token: string, id: string): Promise<Project> =>
      (await request<{ project: Project }>(token, `/api/projects/${id}`)).project,
    create: async (token: string, body: ProjectCreateInput): Promise<Project> =>
      (
        await request<{ project: Project }>(token, "/api/projects", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).project,
    patch: async (token: string, id: string, body: ProjectPatchInput): Promise<Project> =>
      (
        await request<{ project: Project }>(token, `/api/projects/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      ).project,
    remove: async (token: string, id: string): Promise<void> => {
      await request<{ ok: boolean }>(token, `/api/projects/${id}`, { method: "DELETE" });
    },
    generate: (token: string, id: string, body: { recordingKey?: string } = {}): Promise<GenerateResponse> =>
      request<GenerateResponse>(token, `/api/projects/${id}/generate`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  estimate: (token: string, body: { script: string; format: Format; mode: VoiceMode }): Promise<EstimateResponse> =>
    request<EstimateResponse>(token, "/api/estimate", { method: "POST", body: JSON.stringify(body) }),

  voices: async (token: string): Promise<Voice[]> =>
    (await request<{ voices: Voice[] }>(token, "/api/voices")).voices,

  avatars: async (token: string): Promise<Avatar[]> =>
    (await request<{ avatars: Avatar[] }>(token, "/api/avatars")).avatars,

  retryAvatar: async (token: string, id: string): Promise<Avatar> =>
    (await request<{ avatar: Avatar }>(token, `/api/avatars/${id}/retry`, { method: "POST" })).avatar,

  removeAvatar: async (token: string, id: string): Promise<void> => {
    await request<{ ok: boolean }>(token, `/api/avatars/${id}/remove`, { method: "POST" });
  },

  onboard: (
    token: string,
    body: { name: string; avatarUploadKey: string; voiceUploadKey: string }
  ): Promise<OnboardResponse> =>
    request<OnboardResponse>(token, "/api/onboard", { method: "POST", body: JSON.stringify(body) }),

  presign: (
    token: string,
    body: { kind: UploadKind; filename: string; contentType: string; sizeBytes: number }
  ): Promise<PresignResponse> =>
    request<PresignResponse>(token, "/api/uploads/presign", { method: "POST", body: JSON.stringify(body) }),

  r2Presign: (
    token: string,
    body: { kind: "avatar_training" | "voice_training"; filename: string; contentType: string }
  ): Promise<{ url: string; key: string }> =>
    request<{ url: string; key: string }>(token, "/api/uploads/r2-presign", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  jobs: {
    list: async (token: string, projectId: string): Promise<Job[]> =>
      (await request<{ jobs: Job[] }>(token, `/api/jobs?projectId=${encodeURIComponent(projectId)}`)).jobs,
  },

  assets: {
    list: async (token: string, projectId: string): Promise<Asset[]> =>
      (await request<{ assets: Asset[] }>(token, `/api/assets?projectId=${encodeURIComponent(projectId)}`)).assets,
    url: (token: string, id: string): Promise<AssetUrlResponse> =>
      request<AssetUrlResponse>(token, `/api/assets/${id}/url`),
  },
};

/** Direct-upload helper: presigns then PUTs the file straight to storage. */
const RELAY_MAX_BYTES = 800 * 1024 * 1024;

/** Server-relay path — used when the browser cannot PUT to object storage directly
 *  (CORS not configured on the storage host for this origin). */
async function uploadViaRelay(token: string, kind: UploadKind, file: File): Promise<string> {
  const params = new URLSearchParams({ kind, filename: file.name });
  const res = await fetch(`/api/uploads/relay?${params}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", "x-embed-token": token },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!res.ok || !body.key) {
    throw new ApiError(body.error ?? `Upload relay failed with status ${res.status}`, res.status);
  }
  return body.key;
}

export async function uploadFile(token: string, kind: UploadKind, file: File): Promise<string> {
  const presigned = await api.presign(token, {
    kind,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  let putRes: Response;
  try {
    putRes = await fetch(presigned.url, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    // fetch threw before any response — CORS block or network failure on the
    // cross-origin storage host. Fall back to relaying through our own server.
    if (file.size <= RELAY_MAX_BYTES) return uploadViaRelay(token, kind, file);
    throw new ApiError(
      "Direct upload to storage was blocked by the browser and the file exceeds the 800MB relay limit. Please compress the recording and retry.",
      0,
    );
  }
  if (!putRes.ok) {
    throw new ApiError(`Upload failed with status ${putRes.status}`, putRes.status);
  }
  return presigned.key;
}

/** Direct-to-R2 upload for avatar/voice training assets — bypasses Terminal AI storage
 *  entirely (the training pipeline reads these straight back out of R2). */
export async function uploadFileToR2(
  token: string,
  kind: "avatar_training" | "voice_training",
  file: File
): Promise<string> {
  const { url, key } = await api.r2Presign(token, {
    kind,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(`Upload to storage failed with status ${res.status}`, res.status);
  }
  return key;
}
