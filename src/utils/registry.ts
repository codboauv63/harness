import * as fs from 'fs';
import * as path from 'path';
import { getAllOpenIssues, getMilestones } from '../giteaApi';

export interface RegistryItem {
  id: string; // e.g. US-001, EPIC-001, ADR-0001
  type: 'epic' | 'us' | 'document';
  title: string;
  issueId?: number; // Linked Gitea Issue/Milestone number where it is stored
}

interface RegistryData {
  items: RegistryItem[];
}

const REGISTRY_PATH = path.join(process.cwd(), '../.mas/knowledge/registry.json');

export function getRegistry(): RegistryData {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const data = fs.readFileSync(REGISTRY_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Erreur lecture registry:", e);
  }
  return { items: [] };
}

function saveRegistry(data: RegistryData) {
  try {
    const dir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Erreur sauvegarde registry:", e);
  }
}

export function registerItem(item: RegistryItem) {
  const data = getRegistry();
  const index = data.items.findIndex(i => i.id === item.id);
  if (index >= 0) {
    data.items[index] = item; // Update existing
  } else {
    data.items.push(item);
  }
  saveRegistry(data);
}

export function getNextDocumentId(docTypePrefix: string): string {
  const data = getRegistry();
  let maxId = 0;
  for (const item of data.items) {
    if (item.type === 'document' && item.id.startsWith(docTypePrefix + '-')) {
      const numStr = item.id.split('-')[1];
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxId) {
        maxId = num;
      }
    }
  }
  const nextNum = maxId + 1;
  return `${docTypePrefix}-${nextNum.toString().padStart(4, '0')}`;
}

export async function getRegistrySummary(): Promise<string> {
  const data = getRegistry();
  
  const milestones = await getMilestones();
  const issues = await getAllOpenIssues();
  
  const epics = milestones.map((m: any) => `- EPIC-${m.id}: ${m.title}`);
  const us = issues.filter((i: any) => i.title.startsWith('US-')).map((i: any) => `- ${i.title.split(' ')[0]}: ${i.title}`);
  const docs = data.items.filter(i => i.type === 'document').map(i => `- ${i.id}: ${i.title}`);

  return `=== REGISTRE DES ÉLÉMENTS DU PROJET ===

Epics Existantes :
${epics.length > 0 ? epics.join('\n') : 'Aucune'}

User Stories Existantes :
${us.length > 0 ? us.join('\n') : 'Aucune'}

Documents Techniques (ADR, API, DDD, etc.) :
${docs.length > 0 ? docs.join('\n') : 'Aucun'}
`;
}

export function getDocumentContent(docId: string): string | null {
  if (docId === 'PRD') {
    const prdPath = path.join(process.cwd(), '../.mas/context.md');
    return fs.existsSync(prdPath) ? fs.readFileSync(prdPath, 'utf-8') : null;
  }
  if (docId === 'ARCHITECTURE') {
    const archPath = path.join(process.cwd(), '../.mas/architecture.md');
    return fs.existsSync(archPath) ? fs.readFileSync(archPath, 'utf-8') : null;
  }

  const data = getRegistry();
  const doc = data.items.find(i => i.id === docId && i.type === 'document');
  if (!doc) return null;
  
  if (doc.issueId) {
    // It's a file path stored in 'title' if we decide to save to disk, 
    // or we can fetch the Gitea issue comment if issueId is the comment ID.
    // For now, let's look for physical files in `.mas/knowledge/`
  }
  
  // If we saved it physically in `.mas/knowledge/docs/`
  const potentialPath = path.join(process.cwd(), '../.mas/knowledge/docs', `${docId}.md`);
  if (fs.existsSync(potentialPath)) {
    return fs.readFileSync(potentialPath, 'utf-8');
  }
  
  return null;
}
