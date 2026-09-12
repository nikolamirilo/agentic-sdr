import { z } from "zod";
import crypto from "node:crypto";
import { getProduct, insertSource, listSources } from "@/lib/db/queries";
import { getStorage, sourceObjectKey } from "@/lib/providers/storage";
import { apiError, apiOk, handleError, parseBody } from "@/lib/api";

const AddSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), uri: z.string().url() }),
  z.object({
    kind: z.literal("pdf"),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().positive().max(50 * 1024 * 1024).optional(),
  }),
]);

export async function GET(_request: Request, ctx: RouteContext<"/api/products/[id]/sources">) {
  const { id } = await ctx.params;
  try {
    return apiOk({ sources: await listSources(id) });
  } catch (error) {
    return handleError(error, "GET sources");
  }
}

/**
 * For a link, writes the row and is done. For a file, generates the object key
 * and returns a presigned upload URL so the bytes never pass through this
 * server — a 40 page PDF should not occupy a Node process that is also running
 * graph work.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/products/[id]/sources">) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, AddSourceSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const product = await getProduct(id);
    if (!product) return apiError("Product not found", 404);

    if (parsed.data.kind === "link") {
      const source = await insertSource({
        productId: id,
        kind: "link",
        uri: parsed.data.uri,
        status: "ready",
      });
      return apiOk({ source }, 201);
    }

    const storage = getStorage();
    const objectKey = sourceObjectKey(id, crypto.randomUUID(), parsed.data.filename);
    const upload = await storage.presignUpload(objectKey, parsed.data.mimeType);

    const source = await insertSource({
      productId: id,
      kind: "pdf",
      uri: parsed.data.filename,
      bucket: upload.bucket,
      objectKey,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      status: "pending",
    });

    return apiOk({ source, upload }, 201);
  } catch (error) {
    return handleError(error, "POST sources");
  }
}
