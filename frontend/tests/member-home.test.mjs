import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const modules = new Map();
function load(path) {
  path = resolve(path);
  if (modules.has(path)) return modules.get(path);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date, Error, URLSearchParams, setTimeout, console, require: (name) => name.startsWith(".") ? load(resolve(dirname(path), name + ".ts")) : require(name) });
  modules.set(path, exports);
  return exports;
}
const { loadMemberHome, userScope } = load("src/lib/member-home.ts");
const { MemberHomeStore } = load("src/lib/member-cache.ts");
const user = { id: "u1", gender: "male", role: "member", grade: 3, is_manager: false, is_observer: false, name: "private profile" };
function home(published = true) {
  const detail = { id: "m1", gender: "male", status: published ? "published" : "voting", practices: [] };
  return { user, months: [detail], detail,
    voteStatus: { practice_month_id: "m1", voted_practice_ids: ["p1"], editable: true },
    myResults: published ? { practice_month_id: "m1", assignments: [] } : null,
    participation: published ? { practice_month_id: "m1", practices: [], grades: [] } : null,
  };
}
class Storage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = value; }
  removeItem(key) { delete this[key]; }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(fetcher = async () => home(), storage = new Storage(), profile = user, gender = "male", month = null) {
  return { store: new MemberHomeStore(userScope(profile), gender, month, fetcher, storage), storage };
}

test("home aggregation starts auth/list together, then all needed reads together", async () => {
  const calls = [];
  const tasks = [];
  const promise = loadMemberHome((path) => { calls.push(path); const task = deferred(); tasks.push(task); return task.promise; }, "male", null);
  assert.deepEqual([...calls], ["/v1/users/me", "/v1/practice-months?gender=male"]);
  tasks[0].resolve(user); tasks[1].resolve(home().months);
  await tick();
  assert.equal(calls.length, 5);
  assert.ok(calls.includes("/v1/practice-months/m1/participation"));
  assert.ok(!calls.includes("/v1/practice-months/m1/results"));
  [home().detail, home().myResults, home().participation].forEach((value, i) => tasks[i + 2].resolve(value));
  assert.equal((await promise).detail.id, "m1");
});
test("unpublished home does not request results; observer/opposite view does not request own votes", async () => {
  for (const profile of [user, { ...user, is_observer: true }, { ...user, gender: "female" }]) {
    const calls = [];
    const data = await loadMemberHome(async (path) => {
      calls.push(path);
      if (path.endsWith("users/me")) return profile;
      if (path.includes("?")) return home(false).months;
      return path.endsWith("votes/me") ? home(false).voteStatus : home(false).detail;
    }, "male", null);
    assert.equal(data.myResults, null);
    assert.equal(data.participation, null);
    assert.equal(calls.some((path) => path.endsWith("votes/me")), profile === user);
    assert.equal(calls.some((path) => path.includes("results") || path.includes("participation")), false);
  }
});
test("unknown month is not silently replaced by another month", async () => {
  const result = await loadMemberHome(async (path) => path.endsWith("users/me") ? user : home().months, "male", "missing");
  assert.equal(result.detail, null);
});
test("publication changes during loading do not mix unpublished and public data", async () => {
  const unpublished = home(false), published = home();
  for (const becamePublished of [true, false]) {
    const result = await loadMemberHome(async (path) => {
      if (path.endsWith("users/me")) return user;
      if (path.includes("?")) return (becamePublished ? unpublished : published).months;
      if (path.endsWith("votes/me")) return unpublished.voteStatus;
      if (path.endsWith("results/me")) return published.myResults;
      if (path.endsWith("participation")) return published.participation;
      return (becamePublished ? published : unpublished).detail;
    }, "male", null);
    assert.equal(result.detail.status, becamePublished ? "published" : "voting");
    assert.equal(result.myResults !== null, becamePublished);
    assert.equal(result.participation !== null, becamePublished);
  }
});
test("published open-window home fetches votes and public results together", async () => {
  const data = home();
  Object.assign(data.detail, { vote_starts_at: '2000-01-01T00:00:00Z', vote_ends_at: '2099-01-01T00:00:00Z' });
  data.voteStatus.locked_practice_ids = ['fixed'];
  const calls = [];
  const result = await loadMemberHome(async (path) => {
    calls.push(path);
    if (path.endsWith('users/me')) return user;
    if (path.includes('?')) return data.months;
    if (path.endsWith('votes/me')) return data.voteStatus;
    if (path.endsWith('results/me')) return data.myResults;
    if (path.endsWith('participation')) return data.participation;
    return data.detail;
  }, 'male', null);
  assert.equal(calls.length, 6);
  assert.ok(calls.includes('/v1/practice-months/m1/votes/me'));
  assert.equal(result.voteStatus.editable, true);
  assert.equal(result.voteStatus.locked_practice_ids[0], 'fixed');
  assert.ok(result.myResults && result.participation);
});
test("published month whose window reopens during loading still gets current votes", async () => {
  const data = home();
  const month = { ...data.detail, vote_starts_at: '2000-01-01T00:00:00Z', vote_ends_at: '2001-01-01T00:00:00Z' };
  const detail = { ...month, vote_ends_at: '2099-01-01T00:00:00Z' };
  const result = await loadMemberHome(async (path) => {
    if (path.endsWith('users/me')) return user;
    if (path.includes('?')) return [month];
    if (path.endsWith('votes/me')) return data.voteStatus;
    if (path.endsWith('results/me')) return data.myResults;
    if (path.endsWith('participation')) return data.participation;
    return detail;
  }, 'male', null);
  assert.equal(result.voteStatus.editable, true);
});
test("blocked or full browser storage still allows fresh data to display", async () => {
  const { store } = setup(async () => home(), { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); } });
  await store.refresh();
  assert.equal(store.getSnapshot().data.detail.id, "m1");
  assert.equal(store.getSnapshot().error, null);
});
test("persisted schedule/results render before network, but votes/profile are not persisted", async () => {
  const { store, storage } = setup();
  await store.refresh();
  const persisted = storage.getItem(store.key);
  assert.equal(JSON.parse(persisted).data.voteStatus, null);
  assert.ok(!persisted.includes("private profile"));
  const { store: next } = setup(() => new Promise(() => {}), storage);
  assert.equal(next.getSnapshot().data.detail.id, "m1");
  assert.equal(next.getSnapshot().stale, true);
  void next.refresh();
  assert.equal(next.getSnapshot().refreshing, true);
});
test("identity/role/gender/month separate caches", async () => {
  const { store, storage } = setup(); await store.refresh();
  for (const [profile, gender, month] of [[{ ...user, id: "u2" }, "male", null], [{ ...user, role: "representative" }, "male", null], [user, "female", null], [user, "male", "m2"]]) {
    assert.equal(setup(async () => home(), storage, profile, gender, month).store.getSnapshot().data, undefined);
  }
});
test("expired and malformed storage do not break startup", async () => {
  const { store, storage } = setup(); await store.refresh();
  storage.setItem(store.key, JSON.stringify({ data: home(), updatedAt: 0 }));
  assert.equal(setup(undefined, storage).store.getSnapshot().data, undefined);
  storage.setItem(store.key, "not json");
  assert.equal(setup(undefined, storage).store.getSnapshot().data, undefined);
});
test("duplicate refreshes share one request", async () => {
  const task = deferred(); let calls = 0;
  const { store } = setup(() => { calls++; return task.promise; });
  const a = store.refresh(), b = store.refresh();
  assert.equal(a, b); assert.equal(calls, 1);
  task.resolve(home()); await a;
});
test("mutation invalidation discards in-flight response and refreshes again", async () => {
  const tasks = [];
  const { store } = setup(() => { const task = deferred(); tasks.push(task); return task.promise; });
  const unsubscribe = store.subscribe(() => {});
  const first = store.refresh();
  store.invalidate();
  tasks[0].resolve(home()); await first;
  assert.equal(store.getSnapshot().data, undefined);
  assert.equal(tasks.length, 2);
  const latest = home(); latest.detail.practices = [{ id: "new" }];
  tasks[1].resolve(latest); await tick();
  assert.equal(store.getSnapshot().data.detail.practices[0].id, "new");
  unsubscribe();
});
test("refresh failure retains stale snapshot with error and retry succeeds", async () => {
  let fail = false;
  const { store } = setup(async () => { if (fail) throw new Error("offline"); return home(); });
  await store.refresh(); fail = true; await store.refresh();
  assert.equal(store.getSnapshot().data.detail.id, "m1");
  assert.equal(store.getSnapshot().stale, true);
  assert.equal(store.getSnapshot().error, "offline");
  fail = false; await store.refresh();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().stale, false);
});
for (const status of [401, 403, 404]) test(`${status} removes stale sensitive data and persisted copy`, async () => {
  let fail = false;
  const { store, storage } = setup(async () => { if (fail) throw Object.assign(new Error("rejected"), { status }); return home(); });
  await store.refresh(); fail = true; await store.refresh();
  assert.equal(store.getSnapshot().data, undefined);
  assert.equal(storage.getItem(store.key), null);
});
test("changed account response or unpublished payload cannot enter cache", async () => {
  for (const value of [{ ...home(), user: { ...user, id: "other" } }, { ...home(), detail: home(false).detail }]) {
    const { store, storage } = setup(async () => value);
    await store.refresh();
    assert.equal(store.getSnapshot().data, undefined);
    assert.equal(storage.getItem(store.key), null);
  }
});
test("logout disposal prevents late response persistence or further fetch", async () => {
  const task = deferred(); let calls = 0;
  const { store, storage } = setup(() => { calls++; return task.promise; });
  store.subscribe(() => {});
  const pending = store.refresh(); store.dispose();
  task.resolve(home()); await pending; await store.refresh();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().data, undefined);
  assert.equal(storage.getItem(store.key), null);
});
