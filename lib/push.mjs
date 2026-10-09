import { readFileSync, statSync, appendFileSync } from "node:fs";
import { basename } from "node:path";

const env = process.env;
const input = (name) => (env[name] || "").trim();

const path = input("RP_PATH");
const title = input("RP_TITLE");
const apiKey = input("RP_API_KEY") || input("ROWS_API_KEY");
const key = input("RP_KEY");
const idColumn = input("RP_ID_COLUMN");
const datasetToken = input("RP_DATASET_TOKEN");

const BASE_URL = "https://rows.page";
const MAX_BYTES = 100 * 1024 * 1024;
const ATTEMPTS = 4;

const fail = (message) => {
  console.log(`::error::${message}`);
  process.exit(1);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const appendTo = (file, text) => {
  if (env[file]) appendFileSync(env[file], text);
  else process.stdout.write(text);
};

// Multi-line values need the heredoc form of GITHUB_OUTPUT
const output = (values) => {
  const lines = Object.entries(values).map(([name, value]) => {
    const text = String(value ?? "");
    return text.includes("\n") ? `${name}<<__RP__\n${text}\n__RP__` : `${name}=${text}`;
  });
  appendTo("GITHUB_OUTPUT", lines.join("\n") + "\n");
};

const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const formatCount = (n) => n.toLocaleString("en-US");

// Check the inputs before touching the network
if (!path) fail("the 'path' input is required");

let size;
try {
  const stat = statSync(path);
  if (!stat.isFile()) fail(`'${path}' is not a file`);
  size = stat.size;
} catch (err) {
  if (err.code === "ENOENT") fail(`'${path}' does not exist`);
  throw err;
}

if (size > MAX_BYTES) fail(`'${path}' is ${formatBytes(size)}, rows.page takes up to 100 MB per request`);
if (key && !apiKey) fail("'key' needs the 'api-key' input: keyed pushes go to an account");
if (key && !/^[A-Za-z0-9._-]{1,100}$/.test(key)) fail(`invalid key '${key}': use 1-100 characters of A-Z a-z 0-9 . _ -`);

// The run and commit show up as provenance on the page
const query = new URLSearchParams({ name: basename(path) });
if (title) query.set("title", title);
if (key) query.set("key", key);
if (idColumn) query.set("id_column", idColumn);
if (input("RP_RUN")) query.set("run", input("RP_RUN"));
if (input("RP_COMMIT")) query.set("commit", input("RP_COMMIT"));

const headers = { "content-type": "application/octet-stream", "user-agent": "rows-page-action" };
const bearer = apiKey || datasetToken;
if (bearer) headers.authorization = `Bearer ${bearer}`;

// 429 and 5xx get a few retries honouring Retry-After, anything else fails with the body
async function push(url, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body });
    } catch (err) {
      const reason = err.cause?.message || err.message;
      if (attempt === ATTEMPTS) fail(`could not reach rows.page: ${reason}`);
      console.log(`::warning::rows.page unreachable (${reason}), retrying in ${5 * attempt}s`);
      await sleep(5000 * attempt);
      continue;
    }

    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < ATTEMPTS) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 10 * attempt, 90);
      console.log(`::warning::rows.page answered HTTP ${res.status}, retrying in ${wait}s (attempt ${attempt} of ${ATTEMPTS - 1})`);
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) {
      const excerpt = text.replace(/\s+/g, " ").slice(0, 400);
      const hint = res.status === 429
        ? " Anonymous pushes are limited per IP and GitHub-hosted runners share IPs; an api-key gets per-account limits."
        : "";
      fail(`rows.page push failed (HTTP ${res.status}): ${excerpt}${hint}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      fail(`rows.page answered HTTP ${res.status} with something that is not JSON: ${text.slice(0, 200)}`);
    }
  }
}

const res = await push(`${BASE_URL}/api/v1/push?${query}`, readFileSync(path));

// The token and the owner link open the dataset with owner controls, so they never reach the log
if (res.token) console.log(`::add-mask::${res.token}`);
if (res.owner_url) console.log(`::add-mask::${res.owner_url}`);

const changes = res.changes;
const label = title || basename(path);
const facts = [
  res.rows == null ? null : `${res.rows_exact ? "" : "~"}${formatCount(res.rows)} rows`,
  res.format,
  formatBytes(res.bytes),
].filter(Boolean).join(", ");

const lines = [`**[${label}](${res.url})**`, "", `v${res.version}: ${facts}`];

if (res.unchanged) lines.push("", `Same file as v${res.version}, no new version added.`);

if (changes) {
  const delta = changes.rows_delta;
  const details = [
    delta == null ? null : delta === 0 ? "same row count" : `${delta > 0 ? "+" : "-"}${formatCount(Math.abs(delta))} rows`,
    changes.columns_added?.length ? `columns added: ${changes.columns_added.join(", ")}` : null,
    changes.columns_removed?.length ? `columns removed: ${changes.columns_removed.join(", ")}` : null,
  ].filter(Boolean);
  const detail = details.length ? `${details.join(", ")}. ` : "";
  lines.push("", `vs v${changes.previous_version}: ${detail}[What changed](${changes.diff_url})`);
}

if (res.expires_at) lines.push("", `Expires ${res.expires_at.slice(0, 10)}.`);

const summary = lines.join("\n");

// The key or the path identifies the PR comment, so a re-run edits it instead of adding one
const marker = `<!-- rows-page-action ${(key || path).replace(/-{2,}/g, "-")} -->`;

output({
  url: res.url,
  id: res.id,
  version: res.version,
  unchanged: res.unchanged ? "true" : "false",
  rows: res.rows ?? "",
  "rows-delta": changes?.rows_delta ?? "",
  "diff-url": changes?.diff_url ?? "",
  "expires-at": res.expires_at ?? "",
  "owner-url": res.owner_url ?? "",
  token: res.token ?? "",
  summary,
  marker,
});

appendTo("GITHUB_STEP_SUMMARY", `### rows.page\n\n${summary}\n\n`);
console.log(`${res.unchanged ? "Unchanged" : "Pushed"}: ${res.url} (v${res.version}: ${facts})`);
