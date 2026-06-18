import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { runPmAgent } from './agents/pmAgent';
import { upsertMilestone, upsertIssue, ensureLabelsExist, getMilestones } from './giteaApi';
import { workflow } from './index';
import { getProjectContext, saveProjectContext, getArchitectureContext, saveArchitectureContext } from './utils/context';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/workflow/start', (req, res) => {
  console.log("Démarrage du workflow LangGraph en tâche de fond...");
  const child = spawn('npx', ['ts-node', 'src/index.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'inherit'
  });
  child.unref();
  res.json({ success: true, message: "Workflow démarré en tâche de fond." });
});

let clients: express.Response[] = [];
app.get('/api/workflow/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.push(res);
  req.on('close', () => { clients = clients.filter(client => client !== res); });
});

app.post('/api/workflow/webhook/update', (req, res) => {
  clients.forEach(client => client.write(`data: refresh\n\n`));
  res.json({ success: true });
});

app.get('/api/workflow/graph', (req, res) => {
  try {
    const graphStr = workflow.compile().getGraph().drawMermaid();
    res.json({ graph: graphStr });
  } catch (err: any) {
    console.error("Erreur graphe:", err);
    res.status(500).json({ error: err.message });
  }
});

// Project Context Routes
app.get('/api/project/context', (req, res) => {
  try {
    res.json({ context: getProjectContext() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/project/context', (req, res) => {
  try {
    const { context } = req.body;
    saveProjectContext(context || "");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/project/architecture', (req, res) => {
  try {
    res.json({ architecture: getArchitectureContext() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/project/architecture', (req, res) => {
  try {
    const { architecture } = req.body;
    saveArchitectureContext(architecture || "");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

import { runArchitectChatAgent } from './agents/architectAgent';
import { getIssue, getMilestoneByTitle, getAllOpenIssues, getMilestones } from './giteaApi';
import { getRegistry } from './utils/registry';

app.get('/api/workflow/registry', async (req, res) => {
  try {
    const registry = getRegistry();
    const milestones = await getMilestones();
    const issues = await getAllOpenIssues();
    
    // Filter out old epics/us from local registry to avoid duplicates
    const documents = registry.items.filter(i => i.type === 'document');
    
    const liveEpics = milestones.map((m: any) => ({
      id: `EPIC-${m.id}`,
      type: 'epic',
      title: m.title
    }));
    
    const liveUS = issues.filter((i: any) => i.title.startsWith('US-')).map((i: any) => ({
      id: i.title.split(' ')[0], // US-001
      type: 'us',
      title: i.title
    }));

    const items = [
      { id: 'PRD', type: 'document', title: 'Product Requirements Document (PRD)' },
      { id: 'ARCHITECTURE', type: 'document', title: 'Architecture Globale' },
      ...documents,
      ...liveEpics,
      ...liveUS
    ];
    
    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Agent Chat Routes
const conversations = new Map<string, { role: string, content: string }[]>();

app.post('/api/workflow/agent/chat', async (req, res) => {
  try {
    const { agent, conversationId, message, issueNumber } = req.body;
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, []);
    }
    const history = conversations.get(conversationId)!;
    history.push({ role: "user", content: message });
    
    let issueContext = "";
    if (issueNumber) {
      if (issueNumber === 'PRD') {
        issueContext = `Contexte: L'utilisateur se réfère au PRD.`;
      } else if (issueNumber === 'ARCHITECTURE') {
        issueContext = `Contexte: L'utilisateur se réfère à l'Architecture Globale.`;
      } else {
        try {
          if (issueNumber.startsWith('EPIC-')) {
            const epic = await getMilestoneByTitle(issueNumber);
            if (epic) {
              issueContext = `Epic: ${epic.title}\nDescription: ${epic.description}`;
            }
          } else {
            const issue = await getIssue(issueNumber);
            if (issue) {
              issueContext = `Titre: ${issue.title}\nDescription: ${issue.body}\nEpic: ${issue.milestone?.title || 'Aucune'}`;
            }
          }
        } catch (err) {
          console.warn(`Impossible de récupérer la référence ${issueNumber} pour le contexte.`);
        }
      }
    }

    let agentResponse;
    if (agent === 'architect') {
      agentResponse = await runArchitectChatAgent(history, issueContext);
      history.push({ role: "assistant", content: agentResponse.reply || "Voici l'architecture proposée :" });
    } else {
      agentResponse = await runPmAgent(history);
      history.push({ role: "assistant", content: agentResponse.reply || "Voici le plan proposé :" });
    }
    
    res.json(agentResponse);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workflow/pm/approve', async (req, res) => {
  try {
    const { epics, userStories, prd } = req.body;

    // Update PRD if generated
    if (prd) {
      saveProjectContext(prd);
    }
    
    // Ensure all labels exist
    const labels = await ensureLabelsExist();
    const backlogLabel = labels.find((l: any) => l.name === 'status: 0-backlog');
    
    // Load existing milestones
    const existingMilestones = await getMilestones();
    const epicMap: Record<string, number> = {};
    for (const m of existingMilestones) {
      epicMap[m.title.trim().toLowerCase()] = m.id;
    }
    
    // Create Epics (Milestones)
    if (epics && Array.isArray(epics)) {
      for (const e of epics) {
        const milestone = await upsertMilestone(e.title, e.description);
        if (milestone) epicMap[e.title.trim().toLowerCase()] = milestone.id;
      }
    }
    
    // Create User Stories (Issues)
    if (userStories && Array.isArray(userStories)) {
      for (const us of userStories) {
        let milestoneId = undefined;
        if (us.epicTitle) {
          const searchTitle = us.epicTitle.trim().toLowerCase();
          // Exact match
          if (epicMap[searchTitle]) {
            milestoneId = epicMap[searchTitle];
          } else {
            // Permissive match (contains or starts with)
            const matchedKey = Object.keys(epicMap).find(k => k.includes(searchTitle) || searchTitle.includes(k));
            if (matchedKey) milestoneId = epicMap[matchedKey];
          }
        }
        await upsertIssue(us.title, us.body, backlogLabel ? [backlogLabel.id] : [], milestoneId);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur Harness démarré sur le port ${PORT}`);
});
