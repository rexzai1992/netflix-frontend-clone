import { Env, HttpError, audit, error, json, mediaUrl, readJson, slug } from "./lib";

const mediaKinds = new Set(["poster", "backdrop", "logo", "video", "captions", "landing", "social"]);

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["text/vtt", "vtt"],
]);

const SIZE_LIMITS: Record<string, number> = {
  image: 15 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

function uploadDescriptor(data: Record<string, unknown>) {
  const type = String(data.contentType || "");
  const kind = String(data.kind || "");
  const extension = allowedTypes.get(type);
  if (!extension) throw new HttpError("Unsupported file type");
  if (!mediaKinds.has(kind)) throw new HttpError("Invalid media kind");
  if (kind === "video" && !type.startsWith("video/")) throw new HttpError("Video media requires a video file");
  if (kind === "captions" && type !== "text/vtt") throw new HttpError("Captions must be a WebVTT file");
  if (!["video", "captions"].includes(kind) && !type.startsWith("image/")) {
    throw new HttpError("This media kind requires an image file");
  }
  const declaredSize = Number(data.fileSize);
  const limit = SIZE_LIMITS[type.split("/")[0]] ?? SIZE_LIMITS.image;
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) throw new HttpError("File size is required");
  if (declaredSize > limit) {
    throw new HttpError(`File is too large (limit ${Math.round(limit / 1024 / 1024)} MB)`);
  }
  const contentId = slug(String(data.contentId || "site")) || "site";
  return {
    key: `uploads/${contentId}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`,
    type,
    kind,
    declaredSize,
  };
}

// Magic-byte check so a declared content type has to match the actual bytes stored.
function bytesMatchType(bytes: Uint8Array, contentType: string) {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  switch (contentType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes[0] === 0x89 && ascii(1, 3) === "PNG";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "image/avif":
      return ascii(4, 4) === "ftyp" && /avi[fs]/.test(ascii(8, 8));
    case "video/mp4":
      return ascii(4, 4) === "ftyp";
    case "video/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "text/vtt": {
      const text = new TextDecoder().decode(bytes.slice(0, 16)).replace(/^﻿/, "");
      return text.startsWith("WEBVTT");
    }
    default:
      return false;
  }
}

export async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const action = url.searchParams.get("action");

  if (request.method === "POST" && action === "init") {
    const body = await readJson<Record<string, unknown>>(request);
    const descriptor = uploadDescriptor(body);
    const upload = await env.MEDIA.createMultipartUpload(descriptor.key, {
      httpMetadata: {
        contentType: descriptor.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    await env.DB.prepare(
      `INSERT INTO media_assets (key, kind, content_type, size, status, upload_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(descriptor.key, descriptor.kind, descriptor.type, descriptor.declaredSize, upload.uploadId)
      .run();
    return json({ key: descriptor.key, type: descriptor.type, uploadId: upload.uploadId });
  }

  if (request.method === "POST" && action === "cleanup") {
    // Abort multipart uploads that never completed (older than 24h) and drop dead rows.
    const stale = await env.DB.prepare(
      `SELECT key, upload_id FROM media_assets
       WHERE status = 'pending' AND created_at < datetime('now', '-1 day')`,
    ).all<{ key: string; upload_id: string | null }>();
    let aborted = 0;
    for (const row of stale.results) {
      if (row.upload_id) {
        try {
          await env.MEDIA.resumeMultipartUpload(row.key, row.upload_id).abort();
          aborted += 1;
        } catch {
          // Already aborted/completed on the R2 side; row cleanup below still applies.
        }
      }
    }
    await env.DB.prepare(
      `DELETE FROM media_assets
       WHERE status IN ('pending', 'aborted') AND created_at < datetime('now', '-1 day')`,
    ).run();
    await audit(env, "admin", "media.cleanup_pending", "", `aborted ${aborted}`);
    return json({ ok: true, aborted });
  }

  const key = url.searchParams.get("key");
  if (!key || !key.startsWith("uploads/")) return error("Invalid upload key");

  if (request.method === "PUT" && action === "part") {
    const uploadId = url.searchParams.get("uploadId");
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!uploadId || !request.body || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 2048) {
      return error("Invalid multipart request");
    }
    const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json(part);
  }

  if (request.method === "POST" && action === "complete") {
    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return error("Missing upload id");
    const body = await readJson<{
      parts?: R2UploadedPart[];
      width?: number;
      height?: number;
      duration?: number;
    }>(request);
    if (!Array.isArray(body.parts) || !body.parts.length) return error("Missing upload parts");
    const object = await env.MEDIA.resumeMultipartUpload(key, uploadId).complete(body.parts);

    const declared = await env.DB.prepare("SELECT content_type FROM media_assets WHERE key = ?")
      .bind(key)
      .first<{ content_type: string }>();
    const head = await env.MEDIA.get(key, { range: { offset: 0, length: 64 } });
    const bytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
    if (!declared || !bytesMatchType(bytes, declared.content_type)) {
      await env.MEDIA.delete(key);
      await env.DB.prepare("UPDATE media_assets SET status = 'aborted' WHERE key = ?").bind(key).run();
      return error("Uploaded file does not match its declared type", 422);
    }

    await env.DB.prepare(
      `UPDATE media_assets SET status = 'complete', size = ?, width = ?, height = ?, duration_seconds = ?
       WHERE key = ?`,
    )
      .bind(
        object.size,
        Number.isFinite(Number(body.width)) ? Math.round(Number(body.width)) : null,
        Number.isFinite(Number(body.height)) ? Math.round(Number(body.height)) : null,
        Number.isFinite(Number(body.duration)) ? Number(body.duration) : null,
        key,
      )
      .run();
    await audit(env, "admin", "media.upload", key, `${object.size} bytes`);
    return json({ key: object.key, url: mediaUrl(object.key), size: object.size });
  }

  if (request.method === "DELETE" && action === "abort") {
    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return error("Missing upload id");
    try {
      await env.MEDIA.resumeMultipartUpload(key, uploadId).abort();
    } catch {
      // Aborting an unknown/expired upload should still succeed from the client's view.
    }
    await env.DB.prepare("UPDATE media_assets SET status = 'aborted' WHERE key = ?").bind(key).run();
    return new Response(null, { status: 204 });
  }

  return error("Unsupported upload operation", 405);
}
