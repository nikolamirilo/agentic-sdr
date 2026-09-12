import { extractText } from "unpdf";
import { getSource, updateSourceText } from "@/lib/db/queries";
import { getStorage } from "@/lib/providers/storage";
import { sha256 } from "@/lib/crypto";
import { apiError, apiOk, handleError } from "@/lib/api";

const MAX_PDF_PAGES = 40;

/**
 * Confirms the upload landed and pulls the text out of it. Extraction reads
 * through storage, not through the request, so the browser never re-sends the
 * bytes it already uploaded.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/products/[id]/sources/[sid]/complete">
) {
  const { sid } = await ctx.params;

  try {
    const source = await getSource(sid);
    if (!source) return apiError("Source not found", 404);
    if (!source.objectKey) return apiError("This source has no uploaded object", 400);

    const bytes = await getStorage().get(source.objectKey);
    if (!bytes) {
      await updateSourceText(sid, { status: "failed", error: "upload not found in storage" });
      return apiError("Upload not found in storage. Did the PUT succeed?", 409);
    }

    const { text, totalPages } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const pages = (text as string[]).slice(0, MAX_PDF_PAGES);
    const merged = pages
      .map((page, index) => `[page ${index + 1}]\n${page.trim()}`)
      .filter((page) => page.length > 20)
      .join("\n\n");
    const body =
      totalPages > MAX_PDF_PAGES
        ? `${merged}\n\n[truncated: ${totalPages - MAX_PDF_PAGES} further pages not read]`
        : merged;

    await updateSourceText(sid, {
      rawText: body,
      checksum: sha256(bytes),
      status: "ready",
      sizeBytes: bytes.byteLength,
    });

    return apiOk({
      source: await getSource(sid),
      pages: Math.min(totalPages, MAX_PDF_PAGES),
      totalPages,
      characters: body.length,
    });
  } catch (error) {
    await updateSourceText(sid, {
      status: "failed",
      error: (error as Error).message,
    }).catch(() => {});
    return handleError(error, "POST source complete");
  }
}
