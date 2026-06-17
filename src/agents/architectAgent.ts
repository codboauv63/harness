import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";

export async function architectNode(state: typeof GraphState.State) {
  console.log("--- ARCHITECT NODE ---");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const skillInstructions = "---\nname: architect\ndescription: Act as the Software Architect of the MAS system. Make sure to use this skill whenever you design systems, API contracts, OpenAPI, swagger, Domain-Driven Design (DDD), bounded contexts, entities, value objects, ADRs.\n---\n\n# Architect Agent Skill\n\nAs the Architect in the automated LangGraph workflow, you are responsible for translating the Product Requirements (PRD) and Epics into robust technical designs. You are the first technical agent in the pipeline.\n\n## Your Context\nYour execution environment already injects the following context into your prompt:\n- **Global PRD:** The product vision.\n- **Global Architecture:** The global technical constraints.\n- **Epic/Domain Context:** The specific functional rules.\n- **Previous Agent Logs:** Any remarks from the planning phase.\n\n## Core Responsibilities\n1. **Design the Solution:** Analyze the User Story and propose a concrete technical solution.\n2. **Domain-Driven Design (DDD):** If the User Story involves new data, define the Entities, Value Objects, and Aggregates explicitly in your response.\n3. **API Contracts:** If the User Story requires Frontend/Backend communication, draft the OpenAPI paths, request/response payloads, and status codes in your response.\n4. **Architecture Decision Records (ADRs):** Explain *why* you chose this technical design so the Leadtech and Devs understand your rationale.\n\n## Critical Rules\n- **Output:** Your output will be posted directly to Gitea as an Architecture Design Record comment. The Dev Front and Dev Back agents will read your exact response to implement the code. Be extremely precise.\n- **No Manual Trackers:** Do NOT reference `.mas/tracker`, `.mas/contracts`, or `.mas/knowledge`. The MAS workflow is now fully automated. Write your guidelines directly in your textual response so the next agents can read them from the prompt history.\n";

  const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE DU DOMAINE (EPIC) ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n\n=== INSTRUCTIONS DE L'AGENT ===\n${skillInstructions}\n
Tu dois agir en tant que Software Architect.urales et l'ADR (Architecture Decision Record) pour la User Story ${state.userStoryId} du domaine ${state.boundedContext}.
Fais des propositions concrètes de modélisation de la base de données (entités) ou de contrats d'API si nécessaire.

Tu DOIS répondre UNIQUEMENT par un objet JSON valide, sans markdown autour, suivant cette structure exacte :
{
  "status": "success" | "blocked" | "failed",
  "synthesis": "Résumé ultra-concis (2-3 phrases) de ce que tu as fait.",
  "productions": [
    {
      "title": "Titre explicite (ex: ADR 001, Contrats API, Modèles de données)",
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
    console.error("Failed to parse Architect response, defaulting to raw response", e);
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

  // Create a separate Gitea comment for each production
  let productionsMd = "";
  if (parsed.productions && Array.isArray(parsed.productions)) {
    for (const p of parsed.productions) {
      const prodComment = `[ARCHITECT] ${p.title}\n\n${p.content}`;
      await createIssueComment(state.issueNumber, prodComment);
      productionsMd += `### ${p.title}\n${p.content}\n\n`;
    }
  }

  // Create the main synthesis comment with logs and files
  const comment = `[ARCHITECT] Synthèse Technique\n\n**Statut** : ${parsed.status.toUpperCase()}\n\n**Synthèse** : ${parsed.synthesis}\n${modifiedFiles}\n\n<details><summary>[LOG] Prompt Log</summary>\n\n\`\`\`text\n${prompt}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment);

  const historyContent = `Status: ${parsed.status}\nSynthesis: ${parsed.synthesis}\nProductions:\n${productionsMd}`;
  return { messages: [{ role: "architect", content: historyContent }] };
}
