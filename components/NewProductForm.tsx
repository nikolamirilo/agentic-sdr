"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Icon, Notice, Spinner, Tag, inputClass } from "@/components/ui";

type PendingFile = { name: string; size: number; file: File };

/**
 * Registers the product and attaches everything worth reading, then hands off to
 * the flow. Profile generation deliberately happens on the other side of this —
 * it takes minutes, and it belongs to the product, not to a form submission.
 */
export function NewProductForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const canSubmit = Boolean(websiteUrl.trim() || files.length > 0 || links.length > 0);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      setStatus("Registering the product…");
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || inferName(websiteUrl),
          websiteUrl: websiteUrl.trim() ? normalizeUrl(websiteUrl) : undefined,
          links,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not register the product");

      const productId = data.product.id as string;

      for (const pending of files) {
        setStatus(`Uploading ${pending.name}…`);
        await uploadOne(productId, pending);
      }

      router.push(`/admin/products/${productId}`);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card padding="lg">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !busy) void submit();
          }}
        >
          <Field
            label="Product website"
            htmlFor="website"
            hint="We read the homepage plus up to eight pages that describe the product, its pricing and its customers."
          >
            <div className="relative">
              <Icon.Link className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                id="website"
                className={`${inputClass} pl-10`}
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="acme.com"
                autoComplete="off"
                disabled={busy}
              />
            </div>
          </Field>

          <Field label="Product name" htmlFor="name" hint="Optional. We infer it from the site otherwise.">
            <input
              id="name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Analytics"
              disabled={busy}
            />
          </Field>

          <Field label="Documents" hint="Decks, one-pagers, case studies. PDFs only, up to 40 pages each.">
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong bg-surface-sunken px-6 py-8 text-center transition-colors ${
                busy ? "opacity-50" : "cursor-pointer hover:border-accent-line hover:bg-accent-tint"
              }`}
            >
              <Icon.Upload className="h-5 w-5 text-ink-3" />
              <span className="text-[14px] font-medium text-ink">Choose PDF files</span>
              <span className="text-[13px] text-ink-3">or drop them here</span>
              <input
                type="file"
                accept="application/pdf"
                multiple
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? []).map((file) => ({
                    name: file.name,
                    size: file.size,
                    file,
                  }));
                  setFiles((prev) => [...prev, ...chosen]);
                  event.target.value = "";
                }}
              />
            </label>
          </Field>

          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5"
                >
                  <Icon.Document className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{file.name}</span>
                  <span className="tabular shrink-0 text-[12px] text-ink-3">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy}
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    className="text-ink-3 transition-colors hover:text-bad"
                  >
                    <Icon.Close className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Field label="Additional links" hint="Anything else worth reading. Press Enter to add.">
            <input
              className={inputClass}
              value={linkDraft}
              disabled={busy}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const value = linkDraft.trim();
                if (!value) return;
                setLinks((prev) => [...new Set([...prev, normalizeUrl(value)])]);
                setLinkDraft("");
              }}
              placeholder="https://a-page-worth-reading.com"
            />
          </Field>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <Tag key={link} onRemove={() => setLinks((prev) => prev.filter((l) => l !== link))}>
                  {link.replace(/^https?:\/\//, "")}
                </Tag>
              ))}
            </div>
          )}

          {error && <Notice tone="bad">{error}</Notice>}

          <Button type="submit" variant="primary" size="lg" disabled={!canSubmit || busy}>
            {busy ? <Spinner /> : <Icon.ArrowRight />}
            {busy ? status || "Working…" : "Create product"}
          </Button>
        </form>
      </Card>

      <aside>
        <Card padding="md">
          <h2 className="text-[14px] font-semibold">What happens next</h2>
          <ol className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-2">
            {[
              "We read everything you attached here",
              "You generate the profile and edit it",
              "Research runs against that profile",
              "You approve leads and their messages",
            ].map((item, index) => (
              <li key={item} className="flex gap-2.5">
                <span className="section-number mt-0.5 shrink-0">0{index + 1}</span>
                {item}
              </li>
            ))}
          </ol>
        </Card>
      </aside>
    </div>
  );
}

async function uploadOne(productId: string, pending: PendingFile) {
  const created = await fetch(`/api/products/${productId}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "pdf",
      filename: pending.name,
      mimeType: pending.file.type || "application/pdf",
      sizeBytes: pending.size,
    }),
  });
  const data = await created.json();
  if (!created.ok) throw new Error(data.error ?? "Could not start the upload");

  // The bytes go straight to storage; they never pass through the app server.
  const put = await fetch(data.upload.url, {
    method: "PUT",
    headers: data.upload.headers,
    body: pending.file,
  });
  if (!put.ok) throw new Error(`Upload of ${pending.name} failed (${put.status})`);

  const completed = await fetch(
    `/api/products/${productId}/sources/${data.source.id}/complete`,
    { method: "POST" }
  );
  if (!completed.ok) {
    const result = await completed.json().catch(() => ({}));
    throw new Error(result.error ?? `Could not read ${pending.name}`);
  }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function inferName(websiteUrl: string): string {
  try {
    return new URL(normalizeUrl(websiteUrl)).hostname.replace(/^www\./, "");
  } catch {
    return "Untitled product";
  }
}
