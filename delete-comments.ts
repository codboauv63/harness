import * as fs from 'fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

try {
  const envFile = fs.readFileSync('/workspace/.mas/harness/.env', 'utf-8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
} catch (e) {}

const GITEA_URL = process.env.GITEA_API_URL || "http://localhost:3000/api/v1";
const GITEA_OWNER = process.env.GITEA_OWNER || "david.bocher";
const GITEA_REPO = process.env.GITEA_REPO || "assistant-refacto";
const GITEA_TOKEN = process.env.GITEA_TOKEN;

const headers = {
  'Authorization': `token ${GITEA_TOKEN}`,
  'Content-Type': 'application/json',
};

async function deleteComments(issueNumber: number) {
  if (!GITEA_TOKEN) {
    console.error("No token");
    return;
  }
  try {
    const res = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/${issueNumber}/comments`, { headers });
    const comments = await res.json();
    
    console.log(`Found ${comments.length} comments. Deleting...`);
    
    for (const comment of comments) {
      const delRes = await fetch(`${GITEA_URL}/repos/${GITEA_OWNER}/${GITEA_REPO}/issues/comments/${comment.id}`, {
        method: 'DELETE',
        headers
      });
      if (delRes.ok) {
        console.log(`Deleted comment ${comment.id}`);
      } else {
        console.error(`Failed to delete comment ${comment.id}`);
      }
    }
    console.log("Done.");
  } catch (e) {
    console.error(e);
  }
}

deleteComments(3);
