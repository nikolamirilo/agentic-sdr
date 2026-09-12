import { getStorage } from "@/lib/providers/storage";
import { features } from "@/lib/env";
import { apiError, apiOk } from "@/lib/api";

/**
 * Upload target for the Postgres fallback driver only. When object storage is
 * configured the browser PUTs to a presigned URL and never reaches this route.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/storage/[key]">) {
  if (features.storage) return apiError("Object storage is configured; use the presigned URL", 400);

  const { key } = await ctx.params;
  const objectKey = decodeURIComponent(key);
  if (!objectKey.startsWith("products/")) return apiError("Invalid object key", 400);

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength === 0) return apiError("Empty body", 400);
  if (body.byteLength > 50 * 1024 * 1024) return apiError("File is larger than 50MB", 413);

  await getStorage().put(objectKey, body, request.headers.get("content-type") ?? "application/octet-stream");
  return apiOk({ objectKey, sizeBytes: body.byteLength }, 201);
}

export async function GET(_request: Request, ctx: RouteContext<"/api/storage/[key]">) {
  if (features.storage) return apiError("Object storage is configured; use the presigned URL", 400);

  const { key } = await ctx.params;
  const objectKey = decodeURIComponent(key);
  const body = await getStorage().get(objectKey);
  if (!body) return apiError("Not found", 404);

  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=60" },
  });
}
