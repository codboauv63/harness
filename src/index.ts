import { StateGraph, END, START } from "@langchain/langgraph";
import { GraphState } from "./state";
import { leadtechPlanningNode } from "./agents/leadtechPlanningAgent";
import { architectNode } from "./agents/architectAgent";
import { devFrontNode } from "./agents/devFrontAgent";
import { devBackNode } from "./agents/devBackAgent";
import { qaNode } from "./agents/qaTesterAgent";
import { leadtechNode } from "./agents/leadtechAgent";
import { getAllOpenIssues, getIssueComments } from "./giteaApi";

declare const require: any;

// Routing logic
function routeFromPlanning(state: typeof GraphState.State) {
  if (state.needsArchitect) return "architect";
  if (state.needsFront) return "devFront";
  if (state.needsBack) return "devBack";
  return "leadtech";
}

function routeFromArchitect(state: typeof GraphState.State) {
  if (state.needsFront) return "devFront";
  if (state.needsBack) return "devBack";
  return "leadtech";
}

function routeFromFront(state: typeof GraphState.State) {
  if (state.needsBack) return "devBack";
  return "qa";
}

function routeLeadtechDecision(state: typeof GraphState.State) {
  console.log(`[Router] Leadtech status: ${state.overallStatus}`);
  return state.overallStatus === "approved" ? "approved" : "rejected";
}

// 4. Build the Graph
export const workflow = new StateGraph(GraphState)
  .addNode("leadtechPlanning", leadtechPlanningNode)
  .addNode("architect", architectNode)
  .addNode("devFront", devFrontNode)
  .addNode("devBack", devBackNode)
  .addNode("qa", qaNode)
  .addNode("leadtech", leadtechNode)

  // Start with Planning
  .addEdge(START, "leadtechPlanning")
  
  // Conditional routes
  .addConditionalEdges("leadtechPlanning", routeFromPlanning, {
    "architect": "architect",
    "devFront": "devFront",
    "devBack": "devBack",
    "qa": "qa",
    "leadtech": "leadtech"
  })
  .addConditionalEdges("architect", routeFromArchitect, {
    "devFront": "devFront",
    "devBack": "devBack",
    "qa": "qa",
    "leadtech": "leadtech"
  })
  .addConditionalEdges("devFront", routeFromFront, {
    "devBack": "devBack",
    "qa": "qa"
  })
  .addEdge("devBack", "qa")
  .addEdge("qa", "leadtech")
  
  // Final Review
  .addConditionalEdges("leadtech", routeLeadtechDecision, {
    "approved": END,
    "rejected": "leadtechPlanning" // Re-evaluate planning if rejected
  });

const app = workflow.compile();

// 5. Run the Graph
async function run() {
  console.log("Starting MAS Harness: Dynamic Pipeline...");

  const issues = await getAllOpenIssues();
  const selectedIssues = issues.filter((i: any) => i.labels.some((l: any) => l.name === 'status: 1-selected_for_dev'));

  if (selectedIssues.length === 0) {
    console.log("Aucun ticket sélectionné pour le développement. (status: 1-selected_for_dev)");
    return;
  }

  // Find US to process
  const usToProcess: any[] = [...selectedIssues];

  if (usToProcess.length === 0) {
    console.log("Aucune User Story à traiter.");
    return;
  }

  console.log(`[ORCHESTRATOR] Total de User Stories à traiter: ${usToProcess.length}`);

  for (const us of usToProcess) {
    console.log(`\n\n=== Démarrage du workflow pour la carte #${us.number} : ${us.title} ===`);
    const usCodeMatch = us.title.match(/^(US-\d+)/);
    const usCode = usCodeMatch ? usCodeMatch[0] : `US-${us.number}`;

    const comments = await getIssueComments(us.number);
    let humanFeedback = "";
    if (comments && comments.length > 0) {
      humanFeedback = comments.map((c: any) => `${c.user?.login || 'User'} : ${c.body}`).join('\n---\n');
    }

    let epicContext = "";
    if (us.milestone) {
      epicContext = us.milestone.description || "";
    }

    const initialState = {
      issueNumber: us.number,
      userStoryId: usCode,
      boundedContext: us.title, // or extract from milestone title if needed
      humanFeedback,
      epicContext
    };

    const result = await app.stream(initialState, {
      configurable: { thread_id: `mas-harness-execution-${us.number}` },
    });

    console.log("RESULT", result);
    console.log(`=== Workflow terminé pour la carte #${us.number} ===\n`);
  }

  console.log("Toutes les exécutions sont terminées avec succès.");
}

if (require.main === module) {
  run().catch(console.error);
}
