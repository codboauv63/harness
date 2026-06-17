import * as fs from 'fs';
import * as path from 'path';
import { ensureLabelsExist, upsertIssue, upsertMilestone } from './giteaApi';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findMarkdownFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findMarkdownFiles(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

async function main() {
  console.log("=== Début de la synchronisation MAS vers Gitea ===");
  
  // 1. S'assurer que tous les labels MAS existent dans Gitea et récupérer leurs IDs
  console.log("Synchronisation des étiquettes (labels)...");
  const labels = await ensureLabelsExist();
  if (labels.length === 0) {
    console.error("Impossible de récupérer les labels (Token manquant ou erreur API).");
    return;
  }

  const usLabelId = labels.find((l: any) => l.name === 'user-story')?.id;
  const backlogLabelId = labels.find((l: any) => l.name === 'status: 0-backlog')?.id;

  // 2. Parcourir les fichiers Markdown
  const roadmapDir = '/workspace/.mas/roadmap';
  console.log(`Recherche de fichiers dans ${roadmapDir}...`);
  const allFiles = findMarkdownFiles(roadmapDir);
  
  const targetFiles = allFiles.filter((f: string) => {
    const name = path.basename(f);
    return name.startsWith('EPIC-') || name.startsWith('US-');
  });

  console.log(`${targetFiles.length} fichiers (Epics/US) trouvés.`);

  // 3. Parser et injecter chaque fichier
  const epicMapping: Record<string, number> = {};

  // First pass: Epics -> Milestones
  console.log("Création des Jalons (Epics)...");
  for (const filePath of targetFiles.filter(f => path.basename(f).startsWith('EPIC-'))) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let titleLineIndex = lines.findIndex((l: string) => l.trim().startsWith('# '));
    let title = path.basename(filePath, '.md');
    let body = content;

    if (titleLineIndex !== -1) {
      title = lines[titleLineIndex].replace('# ', '').trim();
      body = lines.slice(titleLineIndex + 1).join('\n').trim();
    }
    
    try {
      const ms = await upsertMilestone(title, body);
      if (ms && ms.id) {
        const epicCodeMatch = title.match(/^(EPIC-\d+)/);
        const epicCode = epicCodeMatch ? epicCodeMatch[0] : title;
        epicMapping[epicCode] = ms.id;
      }
      await delay(200);
    } catch (e: any) {
      console.error(`Erreur création Jalon: ${path.basename(filePath)}`, e.message);
    }
  }

  // Second pass: US -> Issues
  console.log("Création des Tickets (User Stories)...");
  for (const filePath of targetFiles.filter(f => path.basename(f).startsWith('US-'))) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let titleLineIndex = lines.findIndex((l: string) => l.trim().startsWith('# '));
    let title = path.basename(filePath, '.md');
    let body = content;

    if (titleLineIndex !== -1) {
      title = lines[titleLineIndex].replace('# ', '').trim();
      body = lines.slice(titleLineIndex + 1).join('\n').trim();
    }

    const issueLabels = [backlogLabelId, usLabelId].filter(Boolean) as number[];

    // Find if body contains any known epic code
    let milestoneId: number | undefined;
    for (const epicCode in epicMapping) {
      if (body.includes(epicCode)) {
        milestoneId = epicMapping[epicCode];
        break;
      }
    }

    try {
      await upsertIssue(title, body, issueLabels, milestoneId);
      await delay(200);
    } catch (e: any) {
      console.error(`Erreur lors de la synchro de ${path.basename(filePath)} :`, e.message);
    }
  }

  console.log("=== Synchronisation terminée avec succès ! ===");
}

main().catch(console.error);
