import { StateGraph, START, END } from "@langchain/langgraph";
import { ResearchStateAnnotation } from "@/lib/graphs/research/state";
import { planQueries } from "@/lib/graphs/research/nodes/plan";
import { discover } from "@/lib/graphs/research/nodes/discover";
import { dedupe } from "@/lib/graphs/research/nodes/dedupe";
import { enrich } from "@/lib/graphs/research/nodes/enrich";
import { score } from "@/lib/graphs/research/nodes/score";
import { filter } from "@/lib/graphs/research/nodes/filter";
import { accumulate } from "@/lib/graphs/research/nodes/accumulate";
import { checkDone, routeAfterCheck } from "@/lib/graphs/research/nodes/checkDone";
import { refineQueries } from "@/lib/graphs/research/nodes/refine";

/**
 * plan_queries
 *      |
 *      v
 *   discover  <-----------------+
 *      |                        |
 *   dedupe                      |
 *      |                        |
 *   enrich                      |
 *      |                        |
 *    score                      |
 *      |                        |
 *   filter                      |
 *      |                        |
 *  accumulate                   |
 *      |                        |
 *  check_done --no--> refine_queries
 *      |
 *     yes
 *      |
 *     END
 *
 * Node order is the cost order: dedupe first, cheap heuristic filter inside it,
 * enrich third, model scoring last. Getting that wrong multiplies the cost of a
 * run by ten.
 */
export function buildResearchGraph() {
  return new StateGraph(ResearchStateAnnotation)
    .addNode("plan_queries", planQueries)
    .addNode("discover", discover)
    .addNode("dedupe", dedupe)
    .addNode("enrich", enrich)
    .addNode("score", score)
    .addNode("filter", filter)
    .addNode("accumulate", accumulate)
    .addNode("check_done", checkDone)
    .addNode("refine_queries", refineQueries)

    .addEdge(START, "plan_queries")
    .addEdge("plan_queries", "discover")
    .addEdge("discover", "dedupe")
    .addEdge("dedupe", "enrich")
    .addEdge("enrich", "score")
    .addEdge("score", "filter")
    .addEdge("filter", "accumulate")
    .addEdge("accumulate", "check_done")
    .addConditionalEdges("check_done", routeAfterCheck, {
      [END]: END,
      refine_queries: "refine_queries",
    })
    .addEdge("refine_queries", "discover")
    .compile();
}

let compiled: ReturnType<typeof buildResearchGraph> | undefined;

export function researchGraph() {
  if (!compiled) compiled = buildResearchGraph();
  return compiled;
}
