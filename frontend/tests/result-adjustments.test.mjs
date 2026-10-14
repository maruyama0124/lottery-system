import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/result-adjustments.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { ResultAdjustments, normalizeResults } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const member = (id = "u1") => ({ user_id: id, name: id, grade: 3, is_manager: false, wins_count: 0, practice_ids: [], voted_practice_ids: ["p1", "p2"] });
const participant = (state = "published") => ({ assignment_id: "a1", user_id: "u1", name: "u1", grade: 3, is_manager: false, assigned_via: "grade3", publish_state: state });
const results = (person) => ({ by_practice: ["p1", "p2"].map((id, i) => ({ practice: { id, capacity: 1 }, participants: i === 0 && person ? [person] : [] })), by_member: [member(), member("u2")] });
const month = { id: "month", status: "published", published_at: "2026-10-14T00:00:00Z" };
async function setup(t, initial = results()) {
  const reads = [], writes = [];
  const api = { get(path) { const task = deferred(); reads.push({ ...task, path }); if (reads.length === 1) task.resolve(structuredClone(initial)); return task.promise; },
    put(path, body) { const task = deferred(); writes.push({ ...task, path, body }); return task.promise; } };
  const store = new ResultAdjustments("month", api);
  t.after(() => store.stop()); store.start(); await flush(); return { store, reads, writes, api };
}
const row = (store, pid = "p1") => store.getSnapshot().results.by_practice.find((r) => r.practice.id === pid);
const wins = (store) => store.getSnapshot().results.by_member[0].wins_count;
test("normalization excludes removing but retains the undo row", () => {
  const value = normalizeResults(results(participant("removing")));
  assert.equal(value.by_member[0].wins_count, 0); assert.equal(value.by_practice[0].participants.length, 1);
});
test("clicks update counts without API calls and reversal removes the delta", async (t) => {
  const { store, writes, reads } = await setup(t);
  store.add("p1", member()); store.add("p2", member());
  assert.equal(wins(store), 2); assert.equal(store.getSnapshot().dirtyChanges, 2);
  assert.equal(store.getSnapshot().savedChanges, 0); assert.equal(store.beginPublish(), false);
  store.remove(row(store).participants[0].assignment_id, true);
  store.remove(row(store, "p2").participants[0].assignment_id, true);
  assert.equal(store.getSnapshot().dirtyChanges, 0); assert.equal(writes.length, 0); assert.equal(reads.length, 1);
});
for (const state of ["published", "pending", "removing"]) test(`round trip restores original ${state} ID/state/reason`, async (t) => {
  const original = participant(state); const { store } = await setup(t, results(original));
  if (state === "removing") { store.add("p1", member()); store.remove("a1", true); }
  else { store.remove("a1", true); store.add("p1", member()); }
  assert.deepEqual(row(store).participants[0], original); assert.equal(store.getSnapshot().dirtyChanges, 0);
});
test("one PUT saves all deltas, then exactly one GET; both phases lock all operations", async (t) => {
  const { store, writes, reads } = await setup(t, results(participant()));
  store.remove("a1", true); store.add("p2", member("u2")); const save = store.save(month);
  assert.equal(writes.length, 1); assert.equal(writes[0].body.changes.length, 2);
  assert.equal(writes[0].body.changes[0].expected_assignment_id, "a1");
  assert.equal(store.isCellBusy("p1", "u2"), true); assert.equal(store.add("p1", member("u2")), false);
  assert.equal(await store.save(month), false); assert.equal(store.beginPublish(), false);
  writes[0].resolve(); await flush();
  assert.equal(reads.length, 2); assert.equal(store.getSnapshot().syncing, true);
  assert.equal(store.getSnapshot().dirtyChanges, 0); assert.equal(store.getSnapshot().savedChanges, 2);
  assert.equal(store.remove("a1", true), false); assert.equal(store.beginPublish(), false);
  const confirmed = structuredClone(store.getSnapshot().results); confirmed.by_practice[1].participants[0].assignment_id = "server-id";
  reads[1].resolve(confirmed); assert.equal(await save, true);
  assert.equal(row(store, "p2").participants[0].assignment_id, "server-id"); assert.equal(store.beginPublish(), true);
});
test("failed PUT preserves draft and supports identical retry", async (t) => {
  const { store, reads, writes } = await setup(t); store.add("p1", member()); const first = store.save(month);
  writes[0].reject(new Error("保存失敗")); assert.equal(await first, false);
  assert.equal(store.getSnapshot().saveError, "保存失敗"); assert.equal(store.getSnapshot().dirtyChanges, 1);
  assert.equal(wins(store), 1); assert.equal(reads.length, 1);
  const retry = store.save(month); assert.deepEqual(writes[1].body, writes[0].body);
  writes[1].resolve(); await flush(); reads[1].resolve(store.getSnapshot().results); await retry;
});
test("successful PUT and failed GET retries only GET, retaining confirmed preview", async (t) => {
  const { store, reads, writes } = await setup(t); store.add("p1", member()); const save = store.save(month);
  writes[0].resolve(); await flush(); reads[1].reject(new Error("取得失敗")); assert.equal(await save, true);
  assert.equal(store.getSnapshot().saveError, null); assert.equal(store.getSnapshot().syncError, "取得失敗");
  assert.equal(store.getSnapshot().dirtyChanges, 0); assert.equal(store.beginPublish(), false);
  assert.equal(store.add("p2", member()), false); assert.equal(await store.save(month), false);
  const retry = store.refresh(); reads[2].resolve(store.getSnapshot().results); assert.equal(await retry, true);
  assert.equal(writes.length, 1); assert.equal(store.isCellBusy("", ""), false);
});
test("draft blocks manual refresh; changing month starts clean with no writes", async (t) => {
  const { store, reads, writes, api } = await setup(t); store.add("p1", member());
  assert.equal(await store.refresh(), false); store.stop();
  const next = new ResultAdjustments("another-month", api); next.start();
  assert.equal(next.getSnapshot().dirtyChanges, 0); assert.equal(writes.length, 0);
  reads[1].resolve(results()); await flush(); next.stop();
});
test("Strict Mode remount shares initial GET; GET errors support retry", async (t) => {
  const { store, reads } = await setup(t); store.stop(); store.start(); assert.equal(reads.length, 1);
  const refresh = store.refresh(); reads[1].reject(new Error("失敗")); assert.equal(await refresh, false);
  const retry = store.refresh(); reads[2].resolve(results()); assert.equal(await retry, true);
});
test("failed/uncertain save cannot be published after local reversal without verification", async (t) => {
  const { store, reads, writes } = await setup(t);
  store.add("p1", member()); const save = store.save(month); writes[0].reject(new Error("network failure")); await save;
  store.remove(row(store).participants[0].assignment_id, true);
  assert.equal(store.getSnapshot().dirtyChanges, 0); assert.equal(store.beginPublish(), false);
  const refresh = store.refresh(); reads[1].resolve(results()); await refresh;
  assert.equal(store.getSnapshot().saveError, null); assert.equal(store.beginPublish(), true);
});
