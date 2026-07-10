// lib/dev-providers/fish.ts — Fish Audio client for the /dev harness ONLY.
// Written fresh against https://docs.fish.audio — do not import lib/providers/fish.ts here
// and do not import this from the main app; the two are deliberately kept isolated until
// each /dev module is manually verified.
//
// Endpoints used:
//   POST https://api.fish.audio/model     — clone/train a voice from sample audio
//   GET  https://api.fish.audio/model/:id — poll training state
//   POST https://api.fish.audio/v1/tts    — text-to-speech using a trained voice
// Auth: `Authorization: Bearer <FISH_AUDIO_API_KEY>` on every call.

const BASE = "https://api.fish.audio";

function apiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new Error("FISH_AUDIO_API_KEY is not configured");
  return key;
}

async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return body ? `: ${body.slice(0, 500)}` : "";
}

export interface FishModel {
  _id: string;
  state: "created" | "training" | "trained" | "failed";
  title: string;
  train_mode: "fast" | "full";
}

/** POST /model — multipart/form-data. `voices` field carries one sample file. */
export async function cloneVoice(sampleBuffer: Buffer, sampleContentType: string, title: string): Promise<FishModel> {
  const sampleName = sampleContentType.includes("mpeg") || sampleContentType.includes("mp3") ? "sample.mp3" : "sample.wav";
  const form = new FormData();
  form.append("type", "tts");
  form.append("train_mode", "fast");
  form.append("title", title);
  form.append("visibility", "private");
  form.append("voices", new Blob([new Uint8Array(sampleBuffer)], { type: sampleContentType }), sampleName);

  const res = await fetch(`${BASE}/model`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`fish.cloneVoice failed: ${res.status}${await errorDetail(res)}`);
  const body = (await res.json()) as FishModel;
  if (!body._id) throw new Error("fish.cloneVoice: missing _id in response");
  return body;
}

/** GET /model/:id — poll training state. Fast mode is usually already `trained` on create. */
export async function getModel(id: string): Promise<FishModel> {
  const res = await fetch(`${BASE}/model/${id}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new Error(`fish.getModel failed: ${res.status}${await errorDetail(res)}`);
  return (await res.json()) as FishModel;
}

/** POST /v1/tts — `model` is a request HEADER (not a body field). Returns raw MP3 bytes
 *  when format="mp3" (the default) — confirmed against the OpenAPI spec, no envelope. */
export async function textToSpeech(text: string, referenceId: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      model: "s2.1-pro-free",
    },
    body: JSON.stringify({
      text,
      reference_id: referenceId,
      format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`fish.textToSpeech failed: ${res.status}${await errorDetail(res)}`);
  return Buffer.from(await res.arrayBuffer());
}
