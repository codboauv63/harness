import { GraphState } from "../state";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runSshCommand(ip: string, keyFile: string, command: string): Promise<{ stdout: string; stderr: string; error?: any }> {
  try {
    const { stdout, stderr } = await execAsync(
      `ssh -i ${keyFile} -o StrictHostKeyChecking=no appuser@${ip} "${command}"`
    );
    return { stdout, stderr };
  } catch (err: any) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", error: err };
  }
}

export async function testRunnerNode(state: typeof GraphState.State) {
  console.log("--- TEST RUNNER NODE ---");
  let testResults = "=== RÉSULTATS DES TESTS AUTOMATISÉS (EXÉCUTÉS PAR LE HARNAIS) ===\n\n";

  if (state.needsBack) {
    testResults += "## BACKEND\n";
    console.log("[TestRunner] Running Backend tests...");
    
    // Install
    let installRes = await runSshCommand("10.9.0.10", "/home/appuser/.ssh/id_mcp_backend", "npm install");
    if (installRes.error) {
      testResults += `⚠️ ERREUR npm install (Backend)\n\`\`\`text\n${installRes.stdout}\n${installRes.stderr}\n\`\`\`\n`;
    }

    // Test
    let testRes = await runSshCommand("10.9.0.10", "/home/appuser/.ssh/id_mcp_backend", "npm test");
    if (testRes.error) {
      testResults += `❌ ÉCHEC npm test (Backend)\n\`\`\`text\n${testRes.stdout}\n${testRes.stderr}\n\`\`\`\n`;
    } else {
      testResults += `✅ SUCCÈS npm test (Backend)\n\`\`\`text\n${testRes.stdout}\n\`\`\`\n`;
    }
  }

  if (state.needsFront) {
    testResults += "\n## FRONTEND\n";
    console.log("[TestRunner] Running Frontend tests...");

    // Install
    let installRes = await runSshCommand("10.9.0.20", "/home/appuser/.ssh/id_mcp_frontend", "npm install");
    if (installRes.error) {
      testResults += `⚠️ ERREUR npm install (Frontend)\n\`\`\`text\n${installRes.stdout}\n${installRes.stderr}\n\`\`\`\n`;
    }

    // Test
    let testRes = await runSshCommand("10.9.0.20", "/home/appuser/.ssh/id_mcp_frontend", "npm test");
    if (testRes.error) {
      testResults += `❌ ÉCHEC npm test (Frontend)\n\`\`\`text\n${testRes.stdout}\n${testRes.stderr}\n\`\`\`\n`;
    } else {
      testResults += `✅ SUCCÈS npm test (Frontend)\n\`\`\`text\n${testRes.stdout}\n\`\`\`\n`;
    }

    // E2E
    let e2eRes = await runSshCommand("10.9.0.20", "/home/appuser/.ssh/id_mcp_frontend", "npm run test:e2e");
    if (e2eRes.error) {
      testResults += `❌ ÉCHEC npm run test:e2e (Frontend)\n\`\`\`text\n${e2eRes.stdout}\n${e2eRes.stderr}\n\`\`\`\n`;
    } else {
      testResults += `✅ SUCCÈS npm run test:e2e (Frontend)\n\`\`\`text\n${e2eRes.stdout}\n\`\`\`\n`;
    }
  }

  return { testResults };
}
