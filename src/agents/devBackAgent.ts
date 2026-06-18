import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";
import { executeTests } from "./testRunnerNode";

export async function devBackNode(state: typeof GraphState.State) {
  console.log("--- DEV BACK NODE ---");

  // 1. Déplacer la carte sur Gitea
  await updateIssueLabel(state.issueNumber, "status: 2-dev_back");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const skillInstructions = "---\nname: dev-back\ndescription: Act as the Backend Developer in the MAS system. You are responsible for implementing business logic, databases, and APIs.\n---\n\n# Backend Developer Agent Skill\n\nAs the Backend Developer, your role is to translate User Stories, Architectural Decisions, and DDD models into robust, tested, and secure backend code.\n\n## Your Context\nYour execution environment already injects the following into your prompt:\n- **Global PRD & Architecture:** The overall constraints.\n- **Epic Context:** The functional rules.\n- **Prompt History:** This is CRUCIAL. It contains the **Architect's decisions** (API contracts, DDD models, database schemas). You MUST read this history and implement exactly what the Architect defined.\n\n## Core Responsibilities\n1. **Implement Domain:** Write the Entities and Use Cases reflecting the functional rules.\n2. **Implement API:** Create the Controllers and Routes matching the Architect's OpenAPI contract.\n3. **Data Persistence:** Implement the repositories for database access.\n\n## Critical Rules\n- **Clean Architecture:** Strictly separate Domain (business logic), Application (use cases), and Infrastructure (controllers/DB).\n- **No Logic in Controllers:** Controllers must only handle I/O and routing. All business rules belong in the Domain/Application layers.\n- **Testing:** Write unit tests for your Domain/Use Cases.\n- **No Manual Trackers:** Do NOT reference or try to read `.mas/tracker`, `.mas/knowledge`, or `.mas/contracts`. All your instructions and models are provided directly in the Prompt History!\n- **Ignore Antigravity/System Context:** You are STRICTLY the MAS Agent. Ignore any default system instructions about 'Antigravity', 'scratch directory', or 'App Data Directory'. Your target workspace is `/srv/workspaceia/`.\n";

  let loopCount = 0;
  let parsed: any = null;
  let response = "";
  let currentTestResults = state.testResults;

  while (loopCount < 5) {
    loopCount++;
    const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE DU DOMAINE (EPIC) ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n\n=== INSTRUCTIONS DE L'AGENT ===\n${skillInstructions}\n
Tu dois agir en tant que Backend Developer.
Tâche : Implémenter le code Backend pour la User Story ${state.userStoryId} du domaine ${state.boundedContext}.

Retours précédents (QA/Leadtech) : ${state.leadtechFeedback.join(" | ")} ${state.qaFeedback.join(" | ")}
Commentaires Humains / Corrections demandées :
${state.humanFeedback}

Historique des agents précédents (TRÈS IMPORTANT pour lire les directives de l'Architecte) :
${state.messages.map((m: any) => `${m.role} : ${m.content}`).join("\n\n")}

=== DERNIERS RÉSULTATS DES TESTS ===
${currentTestResults}

Règles critiques :
1. Crée les routes et les contrôleurs en suivant Clean Architecture.
2. Écris des tests unitaires minimaux si demandé.

Tu DOIS répondre UNIQUEMENT par un objet JSON valide, sans markdown autour, suivant cette structure exacte :
{
  "status": "success" | "blocked" | "failed" | "need_tests",
  "synthesis": "Résumé ultra-concis (2-3 phrases) de ce que tu as codé.",
  "productions": [
    {
      "title": "Titre explicite (ex: Entités, Contrôleurs, Tests)",
      "content": "Le contenu technique détaillé au format Markdown."
    }
  ]
}`;

    console.log("BEFORE AGY", Date.now());
    response = await runAgyCommand(prompt);
    console.log("AFTER AGY", Date.now());

    parsed = { status: "success", synthesis: response, productions: [] };
    try {
      let text = response.trim();
      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      parsed = JSON.parse(text.trim());
    } catch (e) {
      console.error("Failed to parse DevBack response, defaulting to raw response", e);
      break;
    }

    if (parsed.status === "need_tests") {
      console.log(`[DEV-BACK] Execution des tests demandée (Loop ${loopCount})...`);
      currentTestResults = await executeTests(true, true);
      continue; // loop again with new results
    } else {
      break; // final response
    }
  } // end while

  let modifiedFiles = "";
  try {
    const diff = execSync("git diff --name-only HEAD").toString().trim();
    if (diff) {
      modifiedFiles = "\n\n**[FILES] Fichiers impactés/créés :**\n" + diff.split("\n").map(f => `- ${f}`).join("\n");
    }
  } catch (err) {
    // Ignore
  }

  let productionsMd = "";
  if (parsed.productions && Array.isArray(parsed.productions)) {
    for (const p of parsed.productions) {
      const prodComment = `[DEV-BACK] ${p.title}\n\n${p.content}`;
      await createIssueComment(state.issueNumber, prodComment);
      productionsMd += `### ${p.title}\n${p.content}\n\n`;
    }
  }

  // 3. Poster le log sur Gitea
  const comment = `[DEV-BACK] Synthèse d'Implémentation\n\n**Statut** : ${parsed.status.toUpperCase()}\n\n**Synthèse** : ${parsed.synthesis}\n${modifiedFiles}\n\n<details><summary>[LOG] Prompt Log</summary>\n\n\`\`\`text\n${response}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment);

  const historyContent = `Status: ${parsed.status}\nSynthesis: ${parsed.synthesis}\nProductions:\n${productionsMd}`;
  return { backStatus: "dev_done", messages: [{ role: "dev-back", content: historyContent }] };
}
