import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Postgres driver and the LangGraph checkpointer both hold connection
  // state that must not be bundled per-route.
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres"],
};

export default nextConfig;
