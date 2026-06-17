import * as fs from 'fs';
import * as path from 'path';

// Ignore SSL certificates (for self-signed local Gitea)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Charge les variables d'environnement si on exécute ce script en standalone
try {
  const envFile = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
} catch (e) {
  // Ignorer s'il n'y a pas de fichier .env (ex: docker-compose s'en charge)
}

const GITEA_URL = process.env.GITEA_API_URL || "http://localhost:3000/api/v1";
const GITEA_OWNER = process.env.GITEA_OWNER || "david.bocher";
const GITEA_REPO = process.env.GITEA_REPO || "assistant-refacto";
const GITEA_TOKEN = process.env.GITEA_TOKEN;

const headers = {
  'Authorization': `token ${GITEA_TOKEN}`,
  'Content-Type': 'application/json',
};

// Modifie l'étiquette (statut/colonne) d'un ticket
export async function updateIssueLabel(issueNumber: number, labelName: string) {
  if (!GITEA_TOKEN) return;
  try {
    console.log(`[GITEA API] Moving Issue #${issueNumber} to column: ${labelName}`);
    // 1. Fetch all labels to get the ID of the requested label
    const resLabels = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/labels`, { headers });
    const allLabels = await resLabels.json();
    const newStatusLabel = allLabels.find((l: any) => l.name === labelName);
    
    if (newStatusLabel) {
      // 2. Fetch current issue to keep non-status labels
      const issueRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${issueNumber}`, { headers });
      const issue = await issueRes.json();

      const currentLabelNames = issue.labels.map((l: any) => l.name).filter((n: string) => !n.startsWith('status: '));
      currentLabelNames.push(labelName);

      const newLabelIds = currentLabelNames
        .map((name: string) => allLabels.find((l: any) => l.name === name)?.id)
        .filter((id: number | undefined) => id !== undefined);

      await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${issueNumber}/labels`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ labels: newLabelIds })
      });
      
      // Ping the webhook to trigger SSE real-time update
      try {
        await fetch('http://localhost:3002/api/workflow/webhook/update', { method: 'POST' });
      } catch (e) {
        console.warn("[WEBHOOK] Failed to ping local dashboard update:", e);
      }
    } else {
      console.warn(`[GITEA API] Label not found: ${labelName}`);
    }
  } catch (error: any) {
    console.error("[GITEA API Error]", error.message);
  }
}

// Poste le compte-rendu de l'agent en commentaire
export async function createIssueComment(issueNumber: number, body: string) {
  if (!GITEA_TOKEN) return;
  try {
    console.log(`[GITEA API] Posting execution log to Issue #${issueNumber}`);
    await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body })
    });
  } catch (error: any) {
    console.error("[GITEA API Error]", error.message);
  }
}

export async function getIssueComments(issueNumber: number) {
  if (!GITEA_TOKEN) return [];
  try {
    const res = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${issueNumber}/comments`, { headers });
    return await res.json();
  } catch (error: any) {
    console.error("[GITEA API Error] getIssueComments:", error.message);
    return [];
  }
}

export async function getAllOpenIssues() {
  if (!GITEA_TOKEN) return [];
  try {
    const res = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues?state=open&limit=100`, { headers });
    return await res.json();
  } catch (error: any) {
    console.error("[GITEA API Error] getAllOpenIssues:", error.message);
    return [];
  }
}

export async function getMilestones() {
  if (!GITEA_TOKEN) return [];
  try {
    const res = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/milestones?state=all`, { headers });
    return await res.json();
  } catch (error: any) {
    console.error("[GITEA API Error] getMilestones:", error.message);
    return [];
  }
}

export const MAS_LABELS = [
  { name: 'user-story', color: '#10b981' },
  { name: 'status: 0-backlog', color: '#6b7280' },
  { name: 'status: 1-selected_for_dev', color: '#8b5cf6' },
  { name: 'status: 2-dev_front', color: '#f59e0b' },
  { name: 'status: 2-dev_back', color: '#f97316' },
  { name: 'status: 3-qa_testing', color: '#eab308' },
  { name: 'status: 4-human_review', color: '#ec4899' },
  { name: 'status: 5-done', color: '#22c55e' }
];

export async function ensureLabelsExist() {
  if (!GITEA_TOKEN) return [];
  const res = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/labels`, { headers });
  const existingLabels = await res.json();
  const createdLabels = [];

  for (const label of MAS_LABELS) {
    let existing = existingLabels.find((l: any) => l.name === label.name);
    if (!existing) {
      console.log(`[GITEA API] Creating label ${label.name}...`);
      const createRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: label.name, color: label.color })
      });
      existing = await createRes.json();
    }
    createdLabels.push(existing);
  }
  return createdLabels;
}

export async function upsertIssue(title: string, body: string, labelIds: number[], milestoneId?: number) {
  if (!GITEA_TOKEN) return;
  
  // Cherche si l'issue existe déjà
  const searchRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues?state=all&q=${encodeURIComponent(title)}`, { headers });
  const issues = await searchRes.json();
  
  const existing = issues.find((i: any) => i.title.trim() === title.trim());
  
  if (existing) {
    console.log(`[GITEA API] Updating existing Issue #${existing.number} - ${title}`);
    await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${existing.number}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body, milestone: milestoneId }) // Update body and milestone
    });
    // Met à jour les labels
    await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${existing.number}/labels`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ labels: labelIds })
    });
    return existing;
  } else {
    console.log(`[GITEA API] Creating new Issue - ${title}`);
    const createRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body, labels: labelIds, milestone: milestoneId })
    });
    return await createRes.json();
  }
}

export async function upsertMilestone(title: string, description: string) {
  if (!GITEA_TOKEN) return;
  const searchRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/milestones?state=all`, { headers });
  const milestones = await searchRes.json();
  
  const existing = milestones.find((m: any) => m.title.trim() === title.trim());
  
  if (existing) {
    console.log(`[GITEA API] Updating Milestone - ${title}`);
    await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/milestones/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ description })
    });
    return existing;
  } else {
    console.log(`[GITEA API] Creating Milestone - ${title}`);
    const createRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/milestones`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, description, state: 'open' })
    });
    return await createRes.json();
  }
}
