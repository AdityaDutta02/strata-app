// app/api/dev/voice-train/route.ts — /dev harness module 1: Fish Audio voice training.
// Uses the existing `jobs` table (viewer_id='dev-harness', type='dev_voice_train') so no new
// DB table is needed — db-migrations.sql is not guaranteed to re-run on redeploy.
import { NextResponse } from "next/server";
import { dbInsert, dbList, dbUpdate } from "../../../../lib/db";
import { storageUpload } from "../../../../lib/storage";
import { cloneVoice, getModel } from "../../../../lib/dev-providers/fish";
import { logger } from "../../../../lib/logger";

const DEV_VIEWER_ID = "dev-harness";
const JOB_TYPE = "dev_voice_train";

interface DevJobRow {
  id: string;
  viewer_id: string;
  type: string;
  status: string;
  provider_job_id: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-embed-token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing x-embed-token header" }, { status: 401 });
  try {
    const jobs = await dbList<DevJobRow>("jobs", { viewer_id: DEV_VIEWER_ID, type: JOB_TYPE }, token);
    jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json({ jobs });
  } catch (err) {
    logger.error({ msg: "GET /api/dev/voice-train failed", err });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-embed-token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing x-embed-token header" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("sample");
  const title = form.get("title");
  if (!(file instanceof File) || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "sample (file) and title (string) are required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "audio/wav";
  const sampleKey = `dev/voice-train/${Date.now()}-${file.name}`;

  let job = await dbInsert<DevJobRow>(
    "jobs",
    {
      viewer_id: DEV_VIEWER_ID,
      type: JOB_TYPE,
      status: "processing",
      input_json: { title, sampleKey, bytes: buffer.byteLength, contentType },
      output_json: {},
    },
    token,
  );

  try {
    await storageUpload(sampleKey, buffer, contentType, token);
    let model = await cloneVoice(buffer, contentType, title);
    // fast train_mode is usually already `trained` on the create response; poll once more
    // if it's still `training` so the UI doesn't have to implement its own retry loop.
    if (model.state === "training") {
      await new Promise((r) => setTimeout(r, 3000));
      model = await getModel(model._id);
    }
    if (model.state === "failed") {
      throw new Error("Fish Audio reported training state=failed");
    }

    job = await dbUpdate<DevJobRow>(
      "jobs",
      job.id,
      {
        status: model.state === "trained" ? "ready" : "processing",
        provider_job_id: model._id,
        output_json: { voiceId: model._id, state: model.state, title: model.title },
      },
      token,
    );
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ msg: "dev voice-train failed", err });
    job = await dbUpdate<DevJobRow>("jobs", job.id, { status: "failed", error: message }, token);
    return NextResponse.json({ job, error: message }, { status: 502 });
  }
}
