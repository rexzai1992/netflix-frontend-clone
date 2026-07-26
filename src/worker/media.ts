import { Env, error } from "./lib";
import { getAdmin, getUser } from "./auth";
import { getSubscription, isEntitled } from "./billing";

function guessType(key: string) {
  const extension = key.split(".").pop()?.toLowerCase() || "";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  return "";
}

async function canStreamVideo(request: Request, env: Env) {
  if (await getAdmin(request, env)) return true;
  const user = await getUser(request, env);
  if (!user) return false;
  return isEntitled(await getSubscription(env, user.id));
}

export async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error("Method not allowed", 405);
  }

  // Videos are the paid product: only admins and entitled subscribers may stream them.
  const isVideo = guessType(key).startsWith("video/");
  if (isVideo && !(await canStreamVideo(request, env))) {
    return error("An active subscription is required to stream video", 403);
  }

  const options: R2GetOptions = {};
  if (request.headers.has("range")) options.range = request.headers;
  if (request.headers.has("if-none-match")) options.onlyIf = request.headers;
  const object = await env.MEDIA.get(key, options);
  if (!object) return new Response("Not found", { status: 404 });
  if ("body" in object === false) return new Response(null, { status: 304 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (isVideo) {
    headers.set("cache-control", "private, max-age=3600");
  } else {
    headers.set("cache-control", headers.get("cache-control") || "public, max-age=31536000, immutable");
  }

  let status = 200;
  if (request.headers.has("range") && object.range) {
    const range = object.range as { offset?: number; length?: number };
    if (typeof range.offset === "number" && typeof range.length === "number") {
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      );
      headers.set("content-length", String(range.length));
      status = 206;
    }
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}
