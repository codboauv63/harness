import { StateGraph, END, START } from "@langchain/langgraph";
import { GraphState } from "./state";
import { leadtechPlanningNode } from "./agents/leadtechPlanningAgent";
import { architectNode } from "./agents/architectAgent";
import { devFrontNode } from "./agents/devFrontAgent";
import { devBackNode } from "./agents/devBackAgent";
import { testRunnerNode } from "./agents/testRunnerNode";
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
  return "testRunner";
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
  .addNode("testRunner", testRunnerNode)
  .addNode("qa", qaNode)
  .addNode("leadtech", leadtechNode)

  // 4. Edges & Routing
workflow.addConditionalEdges(START, (state) => state.startNode, {
  "leadtechPlanning": "leadtechPlanning",
  "architect": "architect",
  "devFront": "devFront",
  "devBack": "devBack",
  "qa": "qa",
  "leadtech": "leadtech"
});
workflow.addConditionalEdges("leadtechPlanning", routeFromPlanning, {
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
    "testRunner": "testRunner"
  })
  .addEdge("devBack", "testRunner")
  .addEdge("testRunner", "qa")
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
  // Ne prendre que les tickets qui ont un statut, et qui ne sont pas backlog ni done
  const selectedIssues = issues.filter((i: any) => 
    i.labels.some((l: any) => l.name.startsWith('status:') && l.name !== 'status: 0-backlog' && l.name !== 'status: 6-done' && l.name !== 'status: 5-done')
  );

  if (selectedIssues.length === 0) {
    console.log("Aucun ticket sélectionné pour le workflow.");
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
    const messages: any[] = [];
    let startNode = "leadtechPlanning";
    
    // Déduction du startNode par défaut en fonction du label
    if (us.labels.some((l: any) => l.name === 'status: 2-plan')) startNode = "leadtechPlanning";
    if (us.labels.some((l: any) => l.name === 'status: 3-dev')) startNode = "devFront";
    if (us.labels.some((l: any) => l.name === 'status: 4-qa_testing')) startNode = "qa";
    if (us.labels.some((l: any) => l.name === 'status: 5-review')) startNode = "leadtech";

    if (comments && comments.length > 0) {
      for (const c of comments) {
        if (c.body.startsWith('[LEADTECH] Analyse initiale')) {
          messages.push({ role: 'Leadtech', content: c.body });
          if (startNode === "leadtechPlanning") startNode = "architect";
        }
        else if (c.body.startsWith('[ARCHITECT]')) {
          messages.push({ role: 'Architect', content: c.body });
        }
        else if (c.body.startsWith('[DEV-FRONT]')) {
          messages.push({ role: 'Dev Front', content: c.body });
          if (startNode === "devFront") startNode = "devBack"; // Si DevFront a fini, on passe à DevBack
        }
        else if (c.body.startsWith('[DEV-BACK]')) {
          messages.push({ role: 'Dev Back', content: c.body });
        }
        else if (c.body.startsWith('[QA-TESTER]')) {
          messages.push({ role: 'QA Tester', content: c.body });
        }
        else if (!c.body.startsWith('[LOG]')) {
          humanFeedback += `${c.user?.login || 'User'} : ${c.body}\n---\n`;
        }
      }
    }

    let epicContext = "";
    if (us.milestone) {
      epicContext = us.milestone.description || "";
    }

    const initialState = {
      issueNumber: us.number,
      userStoryId: usCode,
      userStoryBody: us.body || "",
      boundedContext: us.title, // or extract from milestone title if needed
      humanFeedback,
      epicContext,
      messages,
      startNode
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
