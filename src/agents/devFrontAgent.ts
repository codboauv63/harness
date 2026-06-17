import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";

export async function devFrontNode(state: typeof GraphState.State) {
  console.log("--- DEV FRONT NODE ---");

  // 1. Déplacer la carte sur Gitea de façon déterministe
  await updateIssueLabel(state.issueNumber, "status: 2-dev_front");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const skillInstructions = "---\nname: dev-front\ndescription: Act as the Frontend Developer in the MAS system. You are responsible for implementing User Interfaces.\n---\n\n# Frontend Developer Agent Skill\n\nAs the Frontend Developer, your role is to translate User Stories, Architectural Decisions, and API contracts into working, tested, and maintainable frontend code.\n\n## Your Context\nYour execution environment already injects the following into your prompt:\n- **Global PRD & Architecture:** The overall constraints.\n- **Epic Context:** The functional rules.\n- **Prompt History:** This is CRUCIAL. It contains the **Architect's decisions** (API contracts, data models) and potentially the **Dev Back's implementation**. You MUST read this history to know what endpoints to call and what models to use.\n\n## Core Responsibilities\n1. **Implement UI:** Slice the requirements into small, single-responsibility components (e.g., Vue 3).\n2. **Integrate Logic:** Connect the UI to the API endpoints defined by the Architect in the Prompt History.\n3. **Mocking (if needed):** If the Backend is not yet developed, use mocking tools (like MSW) based on the Architect's contract.\n\n## Critical Rules\n- **Mobile First:** Always code the UI with a \"Mobile First\" approach.\n- **Code Coverage:** Write unit tests for your components. 100% coverage is the target.\n- **No Direct Execution:** Do not worry about running commands or setting up trackers. You are in an automated pipeline. Write the code, and your output will be synced.\n- **No Manual Trackers:** Do NOT reference or try to read `.mas/tracker` or `.mas/contracts`. All your instructions and contracts are provided directly in the Prompt History!\n";

  // 2. Lancer l'agent
  const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE DU DOMAINE (EPIC) ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n\n=== INSTRUCTIONS DE L'AGENT ===\n${skillInstructions}\n
Tu dois agir en tant que Frontend Developer.
Tâche : Implémenter le code Frontend pour la User Story ${state.userStoryId} du domaine ${state.boundedContext}.

Retours précédents (QA/Leadtech) : ${state.leadtechFeedback.join(" | ")} ${state.qaFeedback.join(" | ")}
Commentaires Humains / Corrections demandées :
${state.humanFeedback}

Historique des agents précédents (TRÈS IMPORTANT pour lire les directives de l'Architecte) :
${state.messages.map((m: any) => `${m.role} : ${m.content}`).join("\n\n")}

Règles critiques :
1. Mobile First & Validation Visuelle stricte.
2. N'oublie pas de te baser sur les éventuels écrans du dossier docs/screens.

Tu DOIS répondre UNIQUEMENT par un objet JSON valide, sans markdown autour, suivant cette structure exacte :
{
  "status": "success" | "blocked" | "failed",
  "synthesis": "Résumé ultra-concis (2-3 phrases) de ce que tu as codé.",
  "productions": [
    {
      "title": "Titre explicite (ex: Composants UI, Stores, Mocks)",
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
    console.error("Failed to parse DevFront response, defaulting to raw response", e);
  }

  // Capture modified files
  let modifiedFiles = "";
  try {
    const diff = execSync("git diff --name-only HEAD").toString().trim();
    if (diff) {
      modifiedFiles = "\n\n**[FILES] Fichiers impactés/créés :**\n" + diff.split("\n").map(f => `- ${f}`).join("\n");
    }
  } catch (err) {
    // Ignore git error
  }

  let productionsMd = "";
  if (parsed.productions && Array.isArray(parsed.productions)) {
    for (const p of parsed.productions) {
      const prodComment = `[DEV-FRONT] ${p.title}\n\n${p.content}`;
      await createIssueComment(state.issueNumber, prodComment);
      productionsMd += `### ${p.title}\n${p.content}\n\n`;
    }
  }

  // 3. Poster le log sur Gitea
  const comment = `[DEV-FRONT] Synthèse d'Implémentation\n\n**Statut** : ${parsed.status.toUpperCase()}\n\n**Synthèse** : ${parsed.synthesis}\n${modifiedFiles}\n\n<details><summary>[LOG] Prompt Log</summary>\n\n\`\`\`text\n${prompt}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment);

  const historyContent = `Status: ${parsed.status}\nSynthesis: ${parsed.synthesis}\nProductions:\n${productionsMd}`;
  return { frontStatus: "dev_done", messages: [{ role: "dev-front", content: historyContent }] };
}
