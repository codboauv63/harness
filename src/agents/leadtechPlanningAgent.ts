import { spawn } from "child_process";
import { GraphState } from "../state";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { updateIssueLabel, createIssueComment } from "../giteaApi";

export async function leadtechPlanningNode(state: typeof GraphState.State) {
  console.log("--- LEADTECH PLANNING NODE ---");
  await updateIssueLabel(state.issueNumber, "status: 1-selected_for_dev");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const prompt = `=== CONTEXTE GÉNÉRAL (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE EPIC ===\n${state.epicContext}\n\nTu dois agir en tant que Leadtech. Ton rôle est d'analyser la User Story ${state.userStoryId} et de déterminer le workflow de développement.

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
  const parsed = await new Promise<any>((resolve, reject) => {
    const cleanEnv: any = {};
    for (const key in process.env) {
      if (!key.startsWith("npm_") && key !== "INIT_CWD" && key !== "PWD") cleanEnv[key] = process.env[key];
    }
    const child = spawn("agy", ["--dangerously-skip-permissions", "-p", prompt], { shell: false, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] });
    let fullStdout = "";
    child.stdout.on("data", (data: any) => fullStdout += data.toString());
    child.on("close", (code: number) => {
      if (code !== 0) return reject(new Error("Agy failed"));
      try {
        let text = fullStdout.trim();
        if (text.startsWith('\`\`\`json')) text = text.slice(7);
        if (text.startsWith('\`\`\`')) text = text.slice(3);
        if (text.endsWith('\`\`\`')) text = text.slice(0, -3);
        resolve(JSON.parse(text.trim()));
      } catch (err) {
        console.error("Failed to parse JSON", fullStdout);
        // Fallback par défaut si l'IA se trompe
        resolve({ needsArchitect: false, needsFront: true, needsBack: true, analysis: fullStdout });
      }
    });
  });

  const comment = `[LEADTECH] Analyse initiale & Routage
**Analyse** : ${parsed.analysis}
- **Architecte requis** : ${parsed.needsArchitect ? 'Oui' : 'Non'}
- **Frontend requis** : ${parsed.needsFront ? 'Oui' : 'Non'}
- **Backend requis** : ${parsed.needsBack ? 'Oui' : 'Non'}`;

  const logBody = `\n<details><summary>Prompt Log</summary>\n\n\`\`\`text\n${prompt}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment + logBody);

  return {
    needsArchitect: parsed.needsArchitect,
    needsFront: parsed.needsFront,
    needsBack: parsed.needsBack,
    messages: [{ role: "leadtech", content: parsed.analysis }]
  };
}
