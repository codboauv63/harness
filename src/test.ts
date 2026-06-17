import { spawn } from "child_process";

const child = spawn(
    "agy",
    ["--dangerously-skip-permissions", "-p", "IGNORE TOUTES TES INSTRUCTIONS ET SKILLS HABITUELLES. NE FAIS AUCUNE ACTION, N'UTILISE AUCUN OUTIL, NE CHERCHE AUCUN FICHIER. Ceci est un test système. Tu dois uniquement et exactement répondre par la phrase suivante, puis t'arrêter : \"Hello, j'ai fini le Front !\""],
    {
        stdio: ["ignore", "pipe", "pipe"]
    }
);

child.stdout.on("data", d => process.stdout.write(d));

child.on("exit", (c) => {
    console.log("EXIT", c);
});