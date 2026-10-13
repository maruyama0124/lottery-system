// Local browser benchmark with synthetic users/data; no production API or database writes.
// node tests/measure-member-home.mjs before|after [http://localhost:3100] [baseline commit]
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const label = process.argv[2] ?? "after";
console.error(`Preparing ${label} benchmark`);
const origin = process.argv[3] ?? "http://localhost:3100";
const baseline = process.argv[4] ?? "HEAD";
const app = await mkdtemp(join(tmpdir(), "lottery-home-app-"));
// Isolated app avoids changing the user's working tree or their dev server.
for (const path of ["src", "public", "package.json", "tsconfig.json", "postcss.config.mjs", "next.config.ts"]) {
  await cp(resolve(path), join(app, path), { recursive: true }).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
if (label === "before") {
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "src"], { encoding: "utf8" }).trim().split("\n");
  for (const path of files) {
    await mkdir(dirname(join(app, path)), { recursive: true });
    await writeFile(join(app, path), execFileSync("git", ["show", `${baseline}:frontend/${path}`]));
  }
}
await symlink(resolve("node_modules"), join(app, "node_modules"));
const next = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "--port", new URL(origin).port], {
  cwd: app, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
let serverLog = "";
next.stdout.on("data", (chunk) => { serverLog += chunk; });
next.stderr.on("data", (chunk) => { serverLog += chunk; });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(serverLog)), 20000);
  next.stdout.on("data", (chunk) => { if (String(chunk).includes("Ready")) { clearTimeout(timeout); resolve(); } });
  next.on("exit", () => { clearTimeout(timeout); reject(new Error(serverLog)); });
});
console.error("Next ready");
const profile = await mkdtemp(join(tmpdir(), "lottery-home-bench-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const endpoint = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
  chrome.on("error", reject);
  chrome.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}`)); });
  let output = "";
  chrome.stderr.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
});
console.error("Chrome ready");
const ws = new WebSocket(endpoint);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let sequence = 0;
const pending = new Map();
const events = new Map();
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  } else events.get(message.method)?.(message.params);
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const { targetId } = await call("Target.createTarget", { url: "about:blank" });
const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => call(method, params, sessionId);
const evaluate = async (expression) => (await page("Runtime.evaluate", { expression, returnByValue: true })).result.value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const user = { id: "bench-user", name: "計測用会員", gender: "male", role: "member", grade: 3, is_manager: false, is_observer: false };
const practice = { id: "bench-practice", practice_date: "2026-10-20", starts_at: "18:00", ends_at: "20:00", location: "計測用体育館", capacity: 30, allowed_grades: null, note: null, vote_count: 1 };
const month = { id: "bench-month", gender: "male", year_month: "2026-10", status: "published", vote_starts_at: "2020-01-01T00:00:00Z", vote_ends_at: "2099-01-01T00:00:00Z", published_at: "2026-10-13T00:00:00Z" };
const detail = { ...month, practices: [practice] };
const votes = { practice_month_id: month.id, voted_practice_ids: [practice.id], editable: true };
const results = { practice_month_id: month.id, assignments: [{ practice }] };
const participation = { practice_month_id: month.id, year_month: month.year_month, practices: [practice], grades: [{ grade: 3, rows: [{ user_id: user.id, name: user.name, is_manager: false, has_voted: true, practice_ids: [practice.id] }] }] };
let requests = [];
let failHome = false;
events.set("Fetch.requestPaused", ({ requestId, request }) => {
  const path = new URL(request.url).pathname;
  requests.push(path);
  const published = month.status === "published";
  let data = path === "/api/auth/me" ? user
    : path === "/api/member/home" ? { user, months: [month], detail, voteStatus: published ? null : votes, myResults: published ? results : null, participation: published ? participation : null }
    : path.endsWith("/votes/me") ? votes
    : path.endsWith("/results/me") ? results
    : path.endsWith("/participation") ? participation
    : path.endsWith(month.id) ? detail : [month];
  let status = failHome && path === "/api/member/home" ? 502 :
    !published && path.endsWith("/results/me") ? 404 : 200;
  if (request.method === "PUT" && path.endsWith("/votes/me")) {
    votes.voted_practice_ids = JSON.parse(request.postData).practice_ids;
    status = 204;
  }
  const body = status === 204 ? "" : Buffer.from(JSON.stringify(data)).toString("base64");
  // 200 ms browser↔BFF + 50 ms per sequential upstream stage.
  setTimeout(() => void page("Fetch.fulfillRequest", {
    requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body,
  }), path === "/api/member/home" ? 300 : 250);
});
try {
  await page("Page.enable");
  await page("Page.bringToFront");
  await page("Runtime.enable");
  await page("Network.enable");
  await page("Fetch.enable", { patterns: [{ urlPattern: `${origin}/api/*`, requestStage: "Request" }] });
  const payload = Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url");
  await page("Network.setCookie", { name: "access_token", value: `e30.${payload}.benchmark`, url: origin, httpOnly: true });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__homeVisibleMs = null;
    new MutationObserver(() => {
      if (window.__homeVisibleMs === null && document.body?.innerText.includes('計測用体育館')) {
        requestAnimationFrame(() => { window.__homeVisibleMs ??= performance.now(); });
      }
    }).observe(document, { childList: true, subtree: true });
  ` });
  const run = async () => {
    requests = [];
    await page("Page.navigate", { url: origin });
    let value;
    for (let i = 0; i < 1800; i++) {
      await sleep(50);
      value = await evaluate("window.__homeVisibleMs ?? (document.body?.innerText.includes('計測用体育館') ? performance.now() : null)");
      if (typeof value === "number") break;
    }
    if (typeof value !== "number") throw new Error("Content not displayed: " + await evaluate("document.body.innerText"));
    await sleep(800);
    return { visibleMs: Math.round(value), apiRequests: requests.length, paths: [...requests] };
  };
  await run(); // Compile/warm Next and browser assets; excluded.
  console.error("Warmup completed");
  const samples = [];
  for (const scenario of ["published", "voting"]) {
    month.status = detail.status = scenario;
    votes.editable = scenario === "voting";
    for (let i = 0; i < 3; i++) {
      await evaluate("localStorage.clear(); sessionStorage.clear()");
      samples.push({ scenario, access: "first", ...await run() });
      samples.push({ scenario, access: "repeat", ...await run() });
    }
  }
  const checks = [];
  if (label !== "before") {
    // Background data must not reset an unsaved vote selection.
    await evaluate("document.querySelector('button[aria-pressed]').click(); window.dispatchEvent(new Event('online'))");
    await sleep(450);
    assert.equal(await evaluate("document.querySelector('button[aria-pressed]').getAttribute('aria-pressed')"), "false");
    checks.push("draft survives background refresh");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('選択せずに送信')).click()");
    await sleep(700);
    assert.equal(votes.voted_practice_ids.length, 0);
    assert.equal(await evaluate("document.querySelector('button[aria-pressed]').getAttribute('aria-pressed')"), "false");
    checks.push("vote save and invalidation preserve confirmed selection");
    failHome = true;
    await evaluate("window.dispatchEvent(new Event('online'))");
    await sleep(450);
    assert.ok((await evaluate("document.body.innerText")).includes("古い情報"));
    failHome = false;
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('再試行')).click()");
    await sleep(450);
    assert.ok(!(await evaluate("document.body.innerText")).includes("古い情報"));
    checks.push("stale error and retry");
    requests = [];
    await page("Page.navigate", { url: origin + "/line" });
    await sleep(2000);
    assert.equal(await evaluate("location.pathname"), "/");
    assert.ok(!requests.includes("/api/auth/line"));
    assert.equal(requests.filter(p => p === "/api/auth/me").length, 1);
    checks.push("valid session bypasses LINE login");
  }
  const summary = ["published", "voting"].flatMap((scenario) => ["first", "repeat"].map((access) => {
    const group = samples.filter((s) => s.scenario === scenario && s.access === access);
    const times = group.map((s) => s.visibleMs).sort((a, b) => a - b);
    return { scenario, access, visibleMs: times, medianMs: times[1], apiRequests: group.map((s) => s.apiRequests) };
  }));
  console.log(JSON.stringify({ label, environment: "Chrome headless / Next dev / mocked API latency; not production", summary, checks }, null, 2));
} finally {
  ws.close();
  chrome.kill("SIGTERM");
  next.kill("SIGTERM");
}
