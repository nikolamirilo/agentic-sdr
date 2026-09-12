import { z } from "zod";
import { createProduct, insertSource, listProducts } from "@/lib/db/queries";
import { apiOk, handleError, parseBody } from "@/lib/api";

const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  websiteUrl: z.string().url().optional(),
  links: z.array(z.string().url()).max(20).optional(),
});

export async function GET() {
  try {
    return apiOk({ products: await listProducts() });
  } catch (error) {
    return handleError(error, "GET /api/products");
  }
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, CreateProductSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const product = await createProduct(parsed.data.name, parsed.data.websiteUrl);

    if (parsed.data.websiteUrl) {
      await insertSource({
        productId: product.id,
        kind: "website",
        uri: parsed.data.websiteUrl,
        status: "ready",
      });
    }
    for (const link of parsed.data.links ?? []) {
      await insertSource({ productId: product.id, kind: "link", uri: link, status: "ready" });
    }

    return apiOk({ product }, 201);
  } catch (error) {
    return handleError(error, "POST /api/products");
  }
}
