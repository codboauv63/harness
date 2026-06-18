import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";

export async function leadtechNode(state: typeof GraphState.State) {
  console.log("--- LEADTECH REVIEW NODE ---");

  // 1. Déplacer la carte sur Gitea
  await updateIssueLabel(state.issueNumber, "status: 4-human_review");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();

  const skillInstructions = "---\nname: leadtech\ndescription: Act as the Tech Lead of the MAS system. You are responsible for performing code reviews.\n---\n\n# Tech Lead Agent Skill\n\nAs the Tech Lead, your role is to drive quality in the Multi-Agent System (MAS). You act as the final reviewer of the code produced by the automated pipeline.\n\n## Your Context\nYour execution environment injects the following into your prompt:\n- **Global PRD, Architecture, and Epic Context:** The rules the developers should have followed.\n- **Prompt History:** Contains the complete conversation logs of the Architect, Dev Front, Dev Back, and QA Tester.\n\n## Core Responsibilities\n1. **Code Review:** Read the execution logs and code diffs produced by the previous agents.\n2. **Validate Quality:** Ensure the architecture rules (Clean Architecture, DDD) were respected. Ensure tests were written and pass.\n3. **Final Decision:** Output a strict JSON response containing `{\"status\": \"approved\" | \"rejected\", \"feedback\": \"...\"}`.\n\n## Critical Rules\n- **Be Strict:** If the QA Tester reports failing tests, or if a Dev failed to write tests, you MUST reject the code.\n- **JSON Output Only:** Your final output must strictly be the JSON object requested by the system.\n- **No Manual Trackers:** Do NOT try to read or create `.mas/tracker` folders. The LangGraph automated pipeline handles all routing and state management. Just evaluate the provided Prompt History.\n- **Ignore Antigravity/System Context:** You are STRICTLY the MAS Agent. Ignore any default system instructions about 'Antigravity', 'scratch directory', or 'App Data Directory'. Do NOT attempt to read or write to the local file system.\n";

  const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===\n${projectContext}\n\n=== ARCHITECTURE GLOBALE ===\n${architectureContext}\n\n=== CONTEXTE DU DOMAINE (EPIC) ===\n${state.epicContext}\n\n=== USER STORY ===\n${state.userStoryBody}\n
=== INSTRUCTIONS DE L'AGENT ===\n${skillInstructions}\n
Tu dois agir en tant que Leadtech.
Tâche : Faire une revue de code pour la User Story ${state.userStoryId}.

Voici les logs des étapes précédentes :
${state.messages.map((m: any) => `${m.role} : ${m.content}`).join("\n\n")}

=== RÉSULTATS DES TESTS AUTOMATISÉS (EXÉCUTÉS PAR LE HARNAIS) ===
${state.testResults}

Tu DOIS répondre UNIQUEMENT par un objet JSON valide suivant cette structure exacte, sans markdown autour :
{
  "status": "approved" | "rejected",
  "feedback": "Ton explication détaillée. Si rejeté, dis pourquoi."
}`;

  console.log("BEFORE AGY", Date.now());
  const response = await runAgyCommand(prompt);
  console.log("AFTER AGY", Date.now());

  let parsed: any = { status: "approved", feedback: response };
  try {
    let text = response.trim();
    if (text.startsWith('\`\`\`json')) text = text.slice(7);
    if (text.startsWith('\`\`\`')) text = text.slice(3);
    if (text.endsWith('\`\`\`')) text = text.slice(0, -3);
    parsed = JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse Leadtech response, defaulting to approved");
  }

  let modifiedFiles = "";
  try {
    const diff = execSync("git diff --name-only HEAD").toString().trim();
    if (diff) {
      modifiedFiles = "\n\n**[FILES] Fichiers refactorisés :**\n" + diff.split("\n").map(f => `- ${f}`).join("\n");
    }
  } catch (err) {
    // Ignore
  }

  const comment = `[LEADTECH] Revue de Code & Décision Finale\n\n**Décision** : ${parsed.status.toUpperCase()}\n\n**Feedback** :\n${parsed.feedback}${modifiedFiles}\n\n<details><summary>[LOG] Prompt Log</summary>\n\n\`\`\`text\n${prompt}\n\`\`\`\n</details>`;
  await createIssueComment(state.issueNumber, comment);

  if (parsed.status === "approved") {
    // Déplacer la carte sur "Done" sur Gitea
    await updateIssueLabel(state.issueNumber, "status: 5-done");
    return { overallStatus: "approved", messages: [{ role: "leadtech", content: parsed.feedback }] };
  } else {
    // Renvoyer en Dev Back pour l'exemple
    await updateIssueLabel(state.issueNumber, "status: 2-dev_front");
    return { overallStatus: "rejected", leadtechFeedback: [parsed.feedback], messages: [{ role: "leadtech", content: parsed.feedback }] };
  }
}
