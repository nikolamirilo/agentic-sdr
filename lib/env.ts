/**
 * Environment access in one place, so a missing key fails loudly at the edge
 * that needs it rather than three layers into a graph run.
 */

function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function required(value: string | undefined, names: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${names}`);
  return value;
}

export const env = {
  /** Neon pooled connection string. */
  get databaseUrl(): string {
    return required(
      pick("DATABASE_URL", "NEON_PG_DB_CONNECTION_STRING"),
      "DATABASE_URL (or NEON_PG_DB_CONNECTION_STRING)"
    );
  },

  appUrl: pick("APP_URL", "NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  // --- model provider -----------------------------------------------------
  xaiApiKey: pick("XAI_API_KEY", "GROK_API_KEY"),
  openaiApiKey: pick("OPENAI_API_KEY"),
  anthropicApiKey: pick("ANTHROPIC_API_KEY"),
  modelId: pick("MODEL_ID"),
  fastModelId: pick("FAST_MODEL_ID"),

  // --- tool layer ---------------------------------------------------------
  exaApiKey: pick("EXA_API_KEY", "EXO_API_KEY"),
  firecrawlApiKey: pick("FIRECRAWL_API_KEY"),
  enrichmentApiKey: pick("ENRICHMENT_API_KEY"),
  /** Up2Data answers "who holds this role at this kind of company". */
  up2dataApiKey: pick("UP2DATA_API_KEY"),

  // --- object storage (S3-compatible; Neon object storage in production) ---
  storageBucket: pick("NEON_STORAGE_BUCKET", "S3_BUCKET"),
  storageEndpoint: pick("NEON_STORAGE_ENDPOINT", "S3_ENDPOINT"),
  storageRegion: pick("NEON_STORAGE_REGION", "S3_REGION") ?? "auto",
  storageAccessKeyId: pick("NEON_STORAGE_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"),
  storageSecretAccessKey: pick("NEON_STORAGE_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"),

  // --- gmail --------------------------------------------------------------
  googleClientId: pick("GOOGLE_CLIENT_ID"),
  googleClientSecret: pick("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: pick("GOOGLE_REDIRECT_URI"),
  tokenEncryptionKey: pick("TOKEN_ENCRYPTION_KEY"),

  // --- budgets ------------------------------------------------------------
  budgetCandidates: Number(pick("RUN_BUDGET_CANDIDATES") ?? 120),
  budgetSeconds: Number(pick("RUN_BUDGET_SECONDS") ?? 600),
  budgetTokens: Number(pick("RUN_BUDGET_TOKENS") ?? 2_000_000),
} as const;

export const features = {
  storage: Boolean(
    env.storageBucket && env.storageEndpoint && env.storageAccessKeyId && env.storageSecretAccessKey
  ),
  gmail: Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri && env.tokenEncryptionKey),
  exa: Boolean(env.exaApiKey),
  firecrawl: Boolean(env.firecrawlApiKey),
  enrichment: Boolean(env.enrichmentApiKey),
  up2data: Boolean(env.up2dataApiKey),
} as const;
