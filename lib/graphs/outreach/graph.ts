import { StateGraph, START, END } from "@langchain/langgraph";
import { OutreachStateAnnotation } from "@/lib/graphs/outreach/state";
import {
  loadContext,
  decideAngle,
  draft,
  critique,
  revise,
  awaitApproval,
  send,
  routeAfterCritique,
  routeAfterApproval,
} from "@/lib/graphs/outreach/nodes";
import { checkpointerReady } from "@/lib/graphs/shared/checkpointer";

/**
 * load_context -> decide_angle -> draft -> critique -> revise
 *                                             |
 *                                     (interrupt: approval)
 *                                             |
 *                                           send
 *
 * The interrupt is the reason this graph is checkpointed: the run pauses at
 * approval, the state sits in Postgres, and a later HTTP request resumes it.
 *
 * The critique node is named `critique_draft` because LangGraph forbids a node
 * name that collides with a state channel, and `critique` is both.
 */
export async function outreachGraph() {
  const checkpointer = await checkpointerReady();

  return new StateGraph(OutreachStateAnnotation)
    .addNode("load_context", loadContext)
    .addNode("decide_angle", decideAngle)
    .addNode("draft", draft)
    .addNode("critique_draft", critique)
    .addNode("revise", revise)
    .addNode("await_approval", awaitApproval)
    .addNode("send", send)

    .addEdge(START, "load_context")
    .addEdge("load_context", "decide_angle")
    .addEdge("decide_angle", "draft")
    .addEdge("draft", "critique_draft")
    .addConditionalEdges("critique_draft", routeAfterCritique, {
      revise: "revise",
      await_approval: "await_approval",
    })
    .addEdge("revise", "await_approval")
    .addConditionalEdges("await_approval", routeAfterApproval, {
      send: "send",
      [END]: END,
    })
    .addEdge("send", END)
    .compile({ checkpointer });
}

let compiled: Awaited<ReturnType<typeof outreachGraph>> | undefined;

export async function getOutreachGraph() {
  if (!compiled) compiled = await outreachGraph();
  return compiled;
}
