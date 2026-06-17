import fs from "fs";
import path from "path";

const PRD_PATH = path.resolve(__dirname, "../../../.mas/roadmap/prd.md");
const ARCHITECTURE_PATH = path.resolve(__dirname, "../../../.mas/roadmap/architecture.md");

export function getProjectContext(): string {
  try {
    if (fs.existsSync(PRD_PATH)) {
      return fs.readFileSync(PRD_PATH, 'utf-8');
    }
    return "Aucun document PRD n'a été rédigé pour le moment.";
  } catch (err) {
    console.error("[CONTEXT] Erreur de lecture du PRD:", err);
    return "Erreur lors de la lecture du contexte.";
  }
}

export function saveProjectContext(content: string): void {
  try {
    fs.mkdirSync(path.dirname(PRD_PATH), { recursive: true });
    fs.writeFileSync(PRD_PATH, content, 'utf-8');
  } catch (err) {
    console.error("[CONTEXT] Erreur d'écriture du PRD:", err);
    throw err;
  }
}

export function getArchitectureContext(): string {
  try {
    if (fs.existsSync(ARCHITECTURE_PATH)) {
      return fs.readFileSync(ARCHITECTURE_PATH, 'utf-8');
    }
    return "Aucun document d'Architecture Globale n'a été rédigé pour le moment.";
  } catch (err) {
    console.error("[CONTEXT] Erreur de lecture de l'Architecture:", err);
    return "Erreur lors de la lecture du contexte d'architecture.";
  }
}

export function saveArchitectureContext(content: string): void {
  try {
    fs.mkdirSync(path.dirname(ARCHITECTURE_PATH), { recursive: true });
    fs.writeFileSync(ARCHITECTURE_PATH, content, 'utf-8');
  } catch (err) {
    console.error("[CONTEXT] Erreur d'écriture de l'Architecture:", err);
    throw err;
  }
}
