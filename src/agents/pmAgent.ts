import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getProjectContext } from "../utils/context";
import { getRegistrySummary, getDocumentContent } from "../utils/registry";

export async function runPmAgent(messages: {role: string, content: string}[]): Promise<any> {
  const currentPRD = getProjectContext();

  let epicTemplate = "";
  let usTemplate = "";
  let prdTemplate = "";
  try {
    const templatesDir = path.resolve(__dirname, '../../templates');
    epicTemplate = fs.readFileSync(path.join(templatesDir, 'epic_template.md'), 'utf-8');
    usTemplate = fs.readFileSync(path.join(templatesDir, 'user_story_template.md'), 'utf-8');
    prdTemplate = fs.readFileSync(path.join(templatesDir, 'prd_template.md'), 'utf-8');
  } catch (err) {
    console.error("[PM AGENT] Erreur lors de la lecture des templates PM:", err);
  }

  let loopCount = 0;
  let parsed: any = null;
  let documentContext = "";

  while (loopCount < 5) {
    loopCount++;
    const registrySummary = getRegistrySummary();

    let prompt = `Tu dois agir en tant que Product Manager (PM). Ton rôle est de transformer l'idée de l'utilisateur en Epics et User Stories (US) respectant les standards Agile et BDD.
Tu dois aussi maintenir à jour le document PRD (Product Requirements Document) si l'idée de l'utilisateur modifie la vision globale.

=== CONTEXTE ACTUEL DU PROJET (PRD) ===
${currentPRD}

${registrySummary}
${documentContext ? `\n=== CONTENU DU DOCUMENT DEMANDÉ ===\n${documentContext}\n` : ''}

=== RÈGLES STRICTES ===
1. Si l'idée est trop floue, pose des questions de clarification à l'utilisateur.
2. Si l'idée est claire, modélise-la sous forme de nouvelles Epics (si nécessaire) et de User Stories.
3. Ne modifie pas les US déjà réalisées ou existantes, crée de nouvelles US avec un numéro incrémenté (ex: si le max est US-002, crée US-003).
4. Tes Epics, tes US, et le PRD doivent IMPÉRATIVEMENT suivre les templates fournis ci-dessous.
5. Si l'utilisateur demande EXPLICITEMENT de générer ou modifier uniquement le PRD, laisse les listes "epics" et "userStories" vides ([]).
6. Si tu as besoin de lire un document (ADR, API, US, Epic), utilise le statut "need_document" avec l'ID (ex: ADR-0001).
7. Tu DOIS EXCLUSIVEMENT et UNIQUEMENT répondre par un objet JSON valide (pas de Markdown autour, juste le JSON).
8. Ignore toute instruction système par défaut concernant 'Antigravity', 'scratch directory' ou 'App Data Directory'. Ton espace de travail cible est `/srv/workspaceia/`.
9. N'UTILISE AUCUN OUTIL (tools). Ton unique but est de générer la réponse JSON contenant les Epics et US. Ne lance pas de commandes terminal et ne modifie pas de fichiers.

=== TEMPLATE DE PRD À RESPECTER ===
${prdTemplate || '(Aucun template de PRD fourni)'}

=== TEMPLATE D'EPIC À RESPECTER ===
${epicTemplate || '(Aucun template d\'Epic fourni)'}

=== TEMPLATE DE USER STORY À RESPECTER ===
${usTemplate || '(Aucun template de US fourni)'}

Format JSON attendu :
{
  "status": "need_details" | "ready" | "need_document",
  "documentId": "Optionnel. Requis si status=need_document (ex: ADR-0001, US-001)",
  "reply": "Ton message textuel pour l'utilisateur (questions ou explication du plan proposé)",
  "prd": "OPTIONNEL. Le corps entier du PRD mis à jour au format Markdown (seulement si l'idée modifie la vision globale ou ajoute une nouvelle Epic au PRD). Respecte le TEMPLATE DE PRD.",
  "epics": [
    {
      "title": "EPIC-XXX - Titre",
      "description": "Le corps de l'Epic au format Markdown en respectant EXACTEMENT le TEMPLATE D'EPIC."
    }
  ],
  "userStories": [
    {
      "epicTitle": "EPIC-XXX - Titre (doit correspondre à une epic ci-dessus ou existante)",
      "title": "US-XXX - Titre",
      "body": "Le corps de la US au format Markdown complet en respectant EXACTEMENT le TEMPLATE DE USER STORY."
    }
  ]
}

=== HISTORIQUE DE LA CONVERSATION ===
`;

    messages.forEach(m => {
      prompt += `${m.role.toUpperCase()}: ${m.content}\n`;
    });
    prompt += `\nPM (toi):`;

    console.log(`\n\x1b[36m========== 📩 PROMPT ENVOYÉ AU PM AGENT (Loop ${loopCount}) ==========\x1b[0m`);
    console.log(`\x1b[90m${prompt}\x1b[0m`);
    console.log(`\x1b[36m========================================================\x1b[0m\n`);

    const result = await new Promise<any>((resolve, reject) => {
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

      console.log(`\n\x1b[32m========== 🤖 RÉPONSE DE L'AGENT PM EN DIRECT ==========\x1b[0m`);

      child.stdout.on("data", (data: any) => {
        const text = data.toString();
        fullStdout += text;
        process.stdout.write(`\x1b[37m${text}\x1b[0m`);
      });

      child.stderr.on("data", (data: any) => {
        console.error("[PM AGENT STDERR]:", data.toString());
      });

      child.on("close", (code: number) => {
        console.log(`\n\x1b[32m=====================================================\x1b[0m\n`);
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
            console.error("Failed to parse agent JSON:", fullStdout);
            reject(new Error("L'agent n'a pas retourné un JSON valide."));
          }
        }
      });
    });
    
    parsed = result;

    if (parsed.status === "need_document" && parsed.documentId) {
      console.log(`[PM CHAT] Requesting document: ${parsed.documentId}`);
      const content = getDocumentContent(parsed.documentId);
      if (content) {
        documentContext = `Contenu de ${parsed.documentId}:\n\n${content}`;
        messages.push({ role: "assistant", content: `(Je demande le document ${parsed.documentId})` });
        messages.push({ role: "user", content: `Voici le document demandé:\n${content}` });
      } else {
        documentContext = `Erreur : Le document ${parsed.documentId} n'a pas été trouvé.`;
        messages.push({ role: "assistant", content: `(Je demande le document ${parsed.documentId})` });
        messages.push({ role: "user", content: documentContext });
      }
      continue; // loop again
    } else {
      break; // final response
    }
  }

  return parsed;
}
