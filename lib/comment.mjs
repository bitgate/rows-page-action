const env = process.env;

const pr = (env.PR_NUMBER || "").trim();
const token = (env.GH_TOKEN || "").trim();
const marker = (env.MARKER || "").trim();
const summary = env.SUMMARY || "";

const skip = (message) => {
  console.log(message);
  process.exit(0);
};

const fail = (message) => {
  console.log(`::error::${message}`);
  process.exit(1);
};

if (!pr) skip("Not a pull request, so no PR comment");
if (!token) skip("::warning::No github-token, so no PR comment");
if (!marker) fail("missing the comment marker from the push step");

const api = env.GITHUB_API_URL || "https://api.github.com";
const repo = env.GITHUB_REPOSITORY;
const headers = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "rows-page-action",
};

// A token that cannot comment (forks, missing permission) is not worth failing the job over
async function github(method, path, payload) {
  const res = await fetch(`${api}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  if ([401, 403, 404].includes(res.status)) {
    skip(`::warning::GitHub API ${method} ${path} answered HTTP ${res.status}, so no PR comment. The job needs 'pull-requests: write' (pull requests from forks get a read-only token).`);
  }
  if (!res.ok) fail(`GitHub API ${method} ${path} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const body = `${marker}\n### 📊 rows.page\n\n${summary}`;

// Reuse our earlier comment on this PR when there is one
let existing;
for (let page = 1; page <= 5 && !existing; page++) {
  const comments = await github("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
  existing = comments.find((comment) => typeof comment.body === "string" && comment.body.startsWith(marker));
  if (comments.length < 100) break;
}

if (existing) {
  await github("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
  console.log(`Updated PR comment ${existing.html_url}`);
} else {
  const created = await github("POST", `/repos/${repo}/issues/${pr}/comments`, { body });
  console.log(`Posted PR comment ${created.html_url}`);
}
