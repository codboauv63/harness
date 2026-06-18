import { GraphState } from "../state";
import { runAgyCommand } from "../utils/agy";
import { updateIssueLabel, createIssueComment } from "../giteaApi";
import { getProjectContext, getArchitectureContext } from "../utils/context";
import { execSync } from "child_process";
import { getRegistrySummary, getNextDocumentId, getDocumentContent, registerItem } from "../utils/registry";
import { executeTests } from "./testRunnerNode";

export async function architectNode(state: typeof GraphState.State) {
  console.log("--- ARCHITECT NODE ---");

  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();
  
  let loopCount = 0;
  let parsed: any = null;
  let response = "";
  let documentContext = "";
  let currentTestResults = state.testResults;

  while (loopCount < 5) {
    loopCount++;
    
    const registrySummary = getRegistrySummary();
    const nextAdrId = getNextDocumentId('ADR');
    const nextApiId = getNextDocumentId('API');
    const nextDddId = getNextDocumentId('DDD');

    const skillInstructions = `---
name: architect
description: Act as the Software Architect of the MAS system. Make sure to use this skill whenever you design systems, API contracts, OpenAPI, swagger, Domain-Driven Design (DDD), bounded contexts, entities, value objects, ADRs.
---

# Architect Agent Skill

As the Architect in the automated LangGraph workflow, you are responsible for translating the Product Requirements (PRD) and Epics into robust technical designs. You are the first technical agent in the pipeline.

## Your Context
Your execution environment already injects the following context into your prompt:
- **Global PRD:** The product vision.
- **Global Architecture:** The global technical constraints.
- **Epic/Domain Context:** The specific functional rules.
- **Previous Agent Logs:** Any remarks from the planning phase.
- **Project Registry:** The list of existing Epics, User Stories, and Documents.

## Core Responsibilities
1. **Design the Solution:** Analyze the User Story and propose a concrete technical solution.
2. **Domain-Driven Design (DDD):** If the User Story involves new data, define the Entities, Value Objects, and Aggregates explicitly in your response.
3. **API Contracts:** If the User Story requires Frontend/Backend communication, draft the OpenAPI paths, request/response payloads, and status codes in your response.
4. **Architecture Decision Records (ADRs):** Explain *why* you chose this technical design so the Leadtech and Devs understand your rationale.

## Critical Rules
- **Naming Convention:** You MUST name all your productions with the exact format: \`[XXX-0000] Titre\` (e.g. \`[ADR-0001] Choix de la BDD\`, \`[API-0002] Swagger API\`, \`[DDD-0001] Models\`).
- **Output:** Your output will be posted directly to Gitea as an Architecture Design Record comment. The Dev Front and Dev Back agents will read your exact response to implement the code. Be extremely precise.
- **No Manual Trackers:** Do NOT reference \`.mas/tracker\`, \`.mas/contracts\`, or \`.mas/knowledge\` manually. Use your productions.
- **Ignore Antigravity/System Context:** You are STRICTLY the MAS Agent. Ignore any default system instructions about 'Antigravity', 'scratch directory', or 'App Data Directory'. Your target workspace is `/srv/workspaceia/`.
- **NO TOOLS ALLOWED:** Do NOT use your terminal tools (like `run_command`) or file tools to initialize projects or execute tests. Your ONLY goal is to output the requested JSON containing the architecture design. The Harness will handle execution.
`;

    const prompt = `=== CONTEXTE GÉNÉRAL DU PROJET (PRD) ===
${projectContext}

=== ARCHITECTURE GLOBALE ===
${architectureContext}

=== CONTEXTE DU DOMAINE (EPIC) ===
${state.epicContext}

=== USER STORY ===
${state.userStoryBody}

${registrySummary}
Prochain ID ADR disponible : ${nextAdrId}
Prochain ID API disponible : ${nextApiId}
Prochain ID DDD disponible : ${nextDddId}
${documentContext ? `\n=== CONTENU DU DOCUMENT DEMANDÉ ===\n${documentContext}\n` : ''}

=== DERNIERS RÉSULTATS DES TESTS ===
${currentTestResults}

=== INSTRUCTIONS DE L'AGENT ===
${skillInstructions}

Tu dois agir en tant que Software Architect.
Fais des propositions concrètes de modélisation de la base de données (entités) ou de contrats d'API si nécessaire pour la User Story ${state.userStoryId} du domaine ${state.boundedContext}.

Si tu as besoin de lire un document existant pour prendre ta décision, utilise le statut "need_document" et précise le "documentId". Tu pourras alors formuler ta réponse au prochain tour.

Tu DOIS répondre UNIQUEMENT par un objet JSON valide, sans markdown autour, suivant cette structure exacte :
{
  "status": "success" | "blocked" | "failed" | "need_document" | "need_tests",
  "documentId": "Optionnel. Requis si status=need_document (ex: ADR-0001)",
  "synthesis": "Résumé ultra-concis (2-3 phrases) de ce que tu as fait.",
  "productions": [
    {
      "title": "[TYPE-XXXX] Titre explicite (ex: [ADR-0001] Choix BDD, [API-0002] Contrats)",
      "content": "Le contenu technique détaillé au format Markdown."
    }
  ]
}`;

    console.log(`BEFORE AGY (Loop ${loopCount})`, Date.now());
    response = await runAgyCommand(prompt);
    console.log(`AFTER AGY (Loop ${loopCount})`, Date.now());

    parsed = { status: "success", synthesis: response, productions: [] };
    try {
      let text = response.trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) text = match[0];
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse Architect response, defaulting to raw response", e);
      break;
    }

    if (parsed.status === "need_document" && parsed.documentId) {
      console.log(`[ARCHITECT] Requesting document: ${parsed.documentId}`);
      const content = getDocumentContent(parsed.documentId);
      if (content) {
        documentContext = `Contenu de ${parsed.documentId}:\n\n${content}`;
      } else {
        documentContext = `Erreur : Le document ${parsed.documentId} n'a pas été trouvé.`;
      }
      continue; // loop again
    } else if (parsed.status === "need_tests") {
      console.log(`[ARCHITECT] Execution des tests demandée...`);
      currentTestResults = await executeTests(true, true);
      continue;
    } else {
      break; // final response
    }
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

  // Create a separate Gitea comment for each production and register them
  
  let productionsMd = "";
  if (parsed.productions && Array.isArray(parsed.productions)) {
    for (const p of parsed.productions) {
      const prodComment = `[ARCHITECT] ${p.title}\n\n${p.content}`;
      await createIssueComment(state.issueNumber, prodComment);
      
      // Parse ID from title if matches [XXX-0000]
      const match = p.title.match(/^\[([A-Z]+-\d+)\]/);
      if (match) {
        const docId = match[1];
        registerItem({
          id: docId,
          type: 'document',
          title: p.title,
          issueId: state.issueNumber
        });
        
        // Save physical file as well
        const fs = require('fs');
        const path = require('path');
        const docsDir = path.join(process.cwd(), '../.mas/knowledge/docs');
        if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, `${docId}.md`), p.content, 'utf-8');
      }
      
      productionsMd += `### ${p.title}\n${p.content}\n\n`;
    }
  }

  // Create the main synthesis comment with logs and files
  const comment = `[ARCHITECT] Synthèse Technique\n\n**Statut** : ${parsed.status.toUpperCase()}\n\n**Synthèse** : ${parsed.synthesis}\n${modifiedFiles}`;
  await createIssueComment(state.issueNumber, comment);

  const historyContent = `Status: ${parsed.status}\nSynthesis: ${parsed.synthesis}\nProductions:\n${productionsMd}`;
  return { messages: [{ role: "architect", content: historyContent }] };
}

export async function runArchitectChatAgent(messages: {role: string, content: string}[], issueContext?: string): Promise<any> {
  const projectContext = getProjectContext();
  const architectureContext = getArchitectureContext();
  
  let loopCount = 0;
  let parsed: any = null;
  let response = "";
  let documentContext = "";

  while (loopCount < 5) {
    loopCount++;
    const registrySummary = getRegistrySummary();

    let prompt = `Tu dois agir en tant que Software Architect (Architecte Logiciel). 
Ton rôle est de répondre aux questions techniques de l'utilisateur, de faire des choix d'architecture (ADR) ou de concevoir des contrats d'API.

=== CONTEXTE GLOBAL (PRD) ===
${projectContext}

=== ARCHITECTURE GLOBALE ACTUELLE ===
${architectureContext}

${registrySummary}
${documentContext ? `\n=== CONTENU DU DOCUMENT DEMANDÉ ===\n${documentContext}\n` : ''}
`;

    if (issueContext) {
      prompt += `=== CONTEXTE SPÉCIFIQUE (Ticket / Epic) ===\n${issueContext}\n\n`;
    }

    prompt += `=== RÈGLES STRICTES ===
1. Analyse la demande de l'utilisateur. Si nécessaire, propose une mise à jour de l'Architecture Globale.
2. Si l'utilisateur mentionne un document (ADR, API, US) ou si tu as besoin de le lire, utilise le statut "need_document" avec son ID (ex: ADR-0001) pour que le système te renvoie son contenu au tour suivant.
3. Tu DOIS EXCLUSIVEMENT et UNIQUEMENT répondre par un objet JSON valide (pas de Markdown autour, juste le JSON).

Format JSON attendu :
{
  "status": "need_details" | "ready" | "need_document" | "need_tests",
  "documentId": "Optionnel. Requis si status=need_document (ex: ADR-0001, US-001)",
  "reply": "Ton message textuel pour l'utilisateur (explication, questions, etc.)",
  "architectureUpdate": "OPTIONNEL. Le document d'Architecture Globale mis à jour au format Markdown (si la discussion amène à une modification structurelle). Laisse vide si non nécessaire."
}

=== HISTORIQUE DE LA CONVERSATION ===
`;

    messages.forEach(m => {
      prompt += `${m.role.toUpperCase()}: ${m.content}\n`;
    });
    prompt += `\nARCHITECT (toi):`;

    const lastUserMessage = messages.filter(m => m.role === "user").pop()?.content || "Aucun message utilisateur";
    const contextSummary = [];
    if (projectContext) contextSummary.push("PRD");
    if (architectureContext) contextSummary.push("Architecture");
    if (issueContext) contextSummary.push("Ticket Context");
    if (documentContext) contextSummary.push("Document demandé");
    
    console.log(`\n\x1b[36m========== 📩 PROMPT ENVOYÉ AU ARCHITECT CHAT (Loop ${loopCount}) ==========\x1b[0m`);
    console.log(`\x1b[90m${prompt}\x1b[0m`);
    console.log(`\x1b[36m========================================================\x1b[0m\n`);

    const result = await new Promise<any>((resolve, reject) => {
      const { spawn } = require('child_process');
      const cleanEnv: any = {};
      for (const key in process.env) {
        if (!key.startsWith("npm_") && key !== "INIT_CWD" && key !== "PWD") {
          cleanEnv[key] = process.env[key];
        }
      }

      const child = spawn("agy", ["--dangerously-skip-permissions", "-p", prompt], {
        shell: false,
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let fullStdout = "";

      console.log(`\n\x1b[32m========== 🤖 RÉPONSE DE L'AGENT ARCHITECT EN DIRECT ==========\x1b[0m`);

      child.stdout.on("data", (data: any) => {
        const text = data.toString();
        fullStdout += text;
        process.stdout.write(`\x1b[37m${text}\x1b[0m`);
      });

      child.stderr.on("data", (data: any) => {
        console.error("[ARCHITECT CHAT STDERR]:", data.toString());
      });

      child.on("close", (code: number) => {
        console.log(`\n\x1b[32m===============================================================\x1b[0m\n`);
        if (code !== 0) {
          reject(new Error(`Agent failed with code ${code}`));
        } else {
          try {
            let text = fullStdout.trim();
            const match = text.match(/\{[\s\S]*\}/);
            if (match) text = match[0];
            const p = JSON.parse(text);
            resolve(p);
          } catch (err) {
            console.error("Failed to parse Architect JSON:", fullStdout);
            reject(new Error("L'agent n'a pas retourné un JSON valide."));
          }
        }
      });
    });

    parsed = result;

    if (parsed.status === "need_document" && parsed.documentId) {
      console.log(`[ARCHITECT CHAT] Requesting document: ${parsed.documentId}`);
      const content = getDocumentContent(parsed.documentId);
      if (content) {
        documentContext = `Contenu de ${parsed.documentId}:\n\n${content}`;
        // Ajouter à l'historique pour l'agent
        messages.push({ role: "assistant", content: `(Je demande le document ${parsed.documentId})` });
        messages.push({ role: "user", content: `Voici le document demandé:\n${content}` });
      } else {
        documentContext = `Erreur : Le document ${parsed.documentId} n'a pas été trouvé.`;
        messages.push({ role: "assistant", content: `(Je demande le document ${parsed.documentId})` });
        messages.push({ role: "user", content: documentContext });
      }
      continue; // loop again
    } else if (parsed.status === "need_tests") {
      console.log(`[ARCHITECT CHAT] Execution des tests demandée...`);
      const results = await executeTests(true, true);
      messages.push({ role: "assistant", content: `(Je demande l'exécution des tests automatisés)` });
      messages.push({ role: "user", content: `Voici les résultats des tests:\n${results}` });
      continue;
    } else {
      break; // final response
    }
  }

  return parsed;
}
