import { spawn } from "child_process";

export async function runAgyCommand(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`\n\x1b[36m========== 📩 PROMPT ENVOYÉ À L'AGENT ==========\x1b[0m`);
    console.log(`\x1b[90m${prompt}\x1b[0m`);
    console.log(`\x1b[36m================================================\x1b[0m\n`);

    console.log(`\n\x1b[32m========== 🤖 RÉPONSE DE L'AGENT EN DIRECT ==========\x1b[0m`);

    const cleanEnv: any = {};
    for (const key in process.env) {
      if (!key.startsWith("npm_") && key !== "INIT_CWD" && key !== "PWD") {
        cleanEnv[key] = process.env[key];
      }
    }
    cleanEnv.PYTHONUNBUFFERED = "1";
    cleanEnv.FORCE_COLOR = "1";

    const child = spawn("agy", ["--dangerously-skip-permissions", "-p", prompt], {
      shell: false,
      env: cleanEnv,
      cwd: "/workspace", // Définit le workspace root pour que l'IA ne pointe pas sur /root/.gemini
      stdio: ["ignore", "pipe", "pipe"]
    });

    let fullStdout = "";
    let fullStderr = "";

    child.stdout.on("data", (data: any) => {
      const text = data.toString();
      fullStdout += text;
      process.stdout.write(`\x1b[37m${text}\x1b[0m`);
    });

    child.stderr.on("data", (data: any) => {
      const text = data.toString();
      fullStderr += text;
      process.stderr.write(`\x1b[33m${text}\x1b[0m`);
    });

    child.on("close", (code: number) => {
      console.log(`\n\x1b[32m=====================================================\x1b[0m\n`);
      if (code !== 0) {
        console.warn("[AGY STDERR]:", fullStderr);
        reject(new Error(`L'agent a terminé avec le code d'erreur ${code}`));
      } else {
        resolve(fullStdout);
      }
    });

    child.on("error", (err: any) => {
      console.error("[AGY ERROR]:", err.message);
      reject(err);
    });
  });
}
