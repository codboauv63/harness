import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";

export async function qaNode(state: typeof GraphState.State) {
  console.log("--- QA TESTER NODE ---");

  // 1. Déplacer la carte sur Gitea
  await updateIssueLabel(state.issueNumber, "status: 3-qa_testing");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const skillInstructions = "---\nname: qa-tester\ndescription: Act as the QA / E2E Tester of the MAS system. You are responsible for writing and executing integration and end-to-end tests to ensure the Frontend and Backend communicate correctly.\n---\n\n# QA Tester Agent Skill\n\nAs the QA Tester, your primary role is to validate the system as a whole. You intervene after the Dev Front and/or Dev Back have completed their work.\n\n## Your Context\nYour execution environment injects the following into your prompt:\n- **Global PRD & Epic Context:** The expected functional behavior.\n- **Prompt History:** Contains the **Architect's API Contracts** and the **Devs' implementations**. You MUST read these to know what endpoints exist and what UI elements were built.\n\n## Core Responsibilities\n1. **Write E2E Tests:** Write automated tests (e.g., Cypress, Playwright, or Vitest) to guarantee that the OpenAPI contracts are respected and the business rules are functioning.\n2. **Execute Tests:** Run the tests to verify the system.\n3. **Report:** If a test fails, clearly document the error and the steps to reproduce in your response so the Leadtech can reject the code and send it back to the Devs.\n\n## Critical Rules\n- **Interactive E2E Tests ONLY:** You MUST write interactive E2E tests. Simulate realistic user flows: fill inputs, click buttons, submit forms, and assert the system's state change.\n- **No Direct App Modifications:** You only write and run tests. You do NOT fix the frontend or backend application code yourself.\n- **No Manual Trackers:** Do NOT reference or try to read `.mas/tracker` or `.mas/contracts`. All your instructions and context are provided directly in the Prompt History!\n";

  const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE DU DOMAINE (EPIC) ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n\n=== INSTRUCTIONS DE L'AGENT ===\n${skillInstructions}\n
Tu dois agir en tant que QA Tester.
Tâche : Tester les développements réalisés pour la User Story ${state.userStoryId} du domaine ${state.boundedContext}.

Implémentations précédentes :
Architecte : ${state.messages.filter((m: any) => m.role === "architect").map((m: any) => m.content).join("\n")}
Dev Front : ${state.messages.filter((m: any) => m.role === "dev-front").map((m: any) => m.content).join("\n")}
Dev Back : ${state.messages.filter((m: any) => m.role === "dev-back").map((m: any) => m.content).join("\n")}

=== RÉSULTATS DES TESTS AUTOMATISÉS (EXÉCUTÉS PAR LE HARNAIS) ===
${state.testResults}

Règles critiques :
1. Écris des tests de bout en bout (e2e).
2. Si un test échoue, remonte l'erreur dans ta synthèse et positionne le status à "failed".

Tu DOIS répondre UNIQUEMENT par un objet JSON valide, sans markdown autour, suivant cette structure exacte :
{
  "status": "success" | "blocked" | "failed",
  "synthesis": "Résumé ultra-concis (2-3 phrases) du résultat des tests.",
  "productions": [
    {
      "title": "Titre explicite (ex: Rapport d'Exécution, Trace d'Erreur)",
      "content": "Le contenu technique détaillé au format Markdown."
    }
  ]
}`;

  console.log("BEFORE AGY", Date.now());
  const response = await runAgyCommand(prompt);
  console.log("AFTER AGY", Date.now());

  let parsed: any = { status: "success", synthesis: response, productions: [] };
  try {
    let text = response.trim();
    if (text.startsWith('\`\`\`json')) text = text.slice(7);
    if (text.startsWith('\`\`\`')) text = text.slice(3);
    if (text.endsWith('\`\`\`')) text = text.slice(0, -3);
    parsed = JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse QA response, defaulting to raw response", e);
  }

  let modifiedFiles = "";
  try {
    const diff = execSync("git diff --name-only HEAD").toString().trim();
    if (diff) {
      modifiedFiles = "\n\n**[FILES] Fichiers d'E2E impactés/créés :**\n" + diff.split("\n").map(f => `- ${f}`).join("\n");
    }
  } catch (err) {
    // Ignore
  }

  let productionsMd = "";
  if (parsed.productions && Array.isArray(parsed.productions)) {
    for (const p of parsed.productions) {
      const prodComment = `[QA-TESTER] ${p.title}\n\n${p.content}`;
      await createIssueComment(state.issueNumber, prodComment);
      productionsMd += `### ${p.title}\n${p.content}\n\n`;
    }
  }

  const comment = `[QA-TESTER] Synthèse d'Exécution E2E\n\n**Statut** : ${parsed.status.toUpperCase()}\n\n**Synthèse** : ${parsed.synthesis}\n${modifiedFiles}\n\n<details><summary>[LOG] Prompt Log</summary>\n\n\`\`\`text\n${prompt}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment);

  const historyContent = `Status: ${parsed.status}\nSynthesis: ${parsed.synthesis}\nProductions:\n${productionsMd}`;
  return { qaStatus: parsed.status === "failed" ? "failed" : "tested", messages: [{ role: "qa", content: historyContent }] };
}
