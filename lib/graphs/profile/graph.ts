import { StateGraph, START, END } from "@langchain/langgraph";
import { ProfileStateAnnotation } from "@/lib/graphs/profile/state";
import { ingestPlan, scrapeSite, parsePdfs, domainResearch } from "@/lib/graphs/profile/nodes/ingest";
import {
  extractProductDefinition,
  deriveIcp,
  deriveDomainLanguage,
  deriveDisqualifiers,
  deriveScoringCriteria,
  assembleProfile,
} from "@/lib/graphs/profile/nodes/synthesize";

/**
 *         ingest_plan
 *        /     |      \
 * scrape_site parse_pdfs domain_research     (parallel fan out)
 *        \     |      /
 *          extract_product_definition
 *                  |
 *               derive_icp
 *                  |
 *       +----------+-----------+
 *       |                      |
 * derive_domain_language   derive_disqualifiers      (parallel)
 *       |                      |
 * derive_scoring_criteria      |
 *       +----------+-----------+
 *                  |
 *           assemble_profile  -> product_profiles vN
 *
 * scoring_criteria runs after domain_language rather than beside it: the
 * criteria are better when they can use the verified vocabulary.
 *
 * Node names are prefixed `derive_` because LangGraph forbids a node name that
 * collides with a state channel, and `disqualifiers` is both.
 */
export function buildProfileGraph() {
  const graph = new StateGraph(ProfileStateAnnotation)
    .addNode("ingest_plan", ingestPlan)
    .addNode("scrape_site", scrapeSite)
    .addNode("parse_pdfs", parsePdfs)
    .addNode("domain_research", domainResearch)
    .addNode("extract_product_definition", extractProductDefinition)
    .addNode("derive_icp", deriveIcp)
    .addNode("derive_domain_language", deriveDomainLanguage)
    .addNode("derive_disqualifiers", deriveDisqualifiers)
    .addNode("derive_scoring_criteria", deriveScoringCriteria)
    .addNode("assemble_profile", assembleProfile)

    .addEdge(START, "ingest_plan")
    .addEdge("ingest_plan", "scrape_site")
    .addEdge("ingest_plan", "parse_pdfs")
    .addEdge("ingest_plan", "domain_research")
    .addEdge("scrape_site", "extract_product_definition")
    .addEdge("parse_pdfs", "extract_product_definition")
    .addEdge("domain_research", "extract_product_definition")
    .addEdge("extract_product_definition", "derive_icp")
    .addEdge("derive_icp", "derive_domain_language")
    .addEdge("derive_icp", "derive_disqualifiers")
    .addEdge("derive_domain_language", "derive_scoring_criteria")
    .addEdge("derive_disqualifiers", "assemble_profile")
    .addEdge("derive_scoring_criteria", "assemble_profile")
    .addEdge("assemble_profile", END);

  return graph.compile();
}

let compiled: ReturnType<typeof buildProfileGraph> | undefined;

export function profileGraph() {
  if (!compiled) compiled = buildProfileGraph();
  return compiled;
}
