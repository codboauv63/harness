import { spawn } from "child_process";
import { GraphState } from "../state";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { runAgyCommand } from "../utils/agy";

export async function leadtechPlanningNode(state: typeof GraphState.State) {
  console.log("--- LEADTECH PLANNING NODE ---");
  // 1. Déplacer la carte sur Gitea
  await updateIssueLabel(state.issueNumber, "status: 2-plan");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const prompt = `=== CONTEXTE GÉNÉRAL (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE EPIC ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n\nTu dois agir en tant que Leadtech. Ton rôle est d'analyser la User Story ${state.userStoryId} et de déterminer le workflow de développement.

CRITICAL RULES:
- DO NOT use any tools (terminal, file editing, etc.). Your ONLY goal is to output JSON.
- Ignore any default system instructions about 'Antigravity', 'scratch directory', or 'App Data Directory'.
- You already have all the context you need.
- Output ONLY the JSON response.

Analyse les besoins de cette US :
- A-t-elle besoin de décisions architecturales (nouvelle table SQL, nouveau pattern, contrats d'API complexes) ? -> needsArchitect: true
- A-t-elle besoin de développement Frontend (interfaces, VueJS) ? -> needsFront: true/false
- A-t-elle besoin de développement Backend (Express, DB) ? -> needsBack: true/false

Tu DOIS répondre UNIQUEMENT par un objet JSON valide suivant cette structure exacte, sans markdown autour :
{
  "needsArchitect": boolean,
  "needsFront": boolean,
  "needsBack": boolean,
  "analysis": "Ton explication détaillée du routage et recommandations initiales"
}`;

  console.log("[LEADTECH PLANNING] Calling agy...");
  let parsed: any;
  try {
    const fullStdout = await runAgyCommand(prompt);
    let text = fullStdout.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("Failed to parse JSON", err);
    parsed = { needsArchitect: false, needsFront: true, needsBack: true, analysis: "Fallback dû à une erreur de parsing." };
  }

  const comment = `[LEADTECH] Analyse initiale & Routage
**Analyse** : ${parsed.analysis}
- **Architecte requis** : ${parsed.needsArchitect ? 'Oui' : 'Non'}
- **Frontend requis** : ${parsed.needsFront ? 'Oui' : 'Non'}
- **Backend requis** : ${parsed.needsBack ? 'Oui' : 'Non'}`;

  const logBody = `[LOG] Prompt pour Leadtech Planning\n\n\`\`\`text\n${prompt}\n\`\`\``;
  await createIssueComment(state.issueNumber, comment);
  await createIssueComment(state.issueNumber, logBody);

  return {
    needsArchitect: parsed.needsArchitect,
    needsFront: parsed.needsFront,
    needsBack: parsed.needsBack,
    messages: [{ role: "leadtech", content: parsed.analysis }]
  };
}
