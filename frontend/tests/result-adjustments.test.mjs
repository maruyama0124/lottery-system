import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 追加のテスト依存を入れず、実装のTypeScriptを直接検証する。
const source = await readFile(new URL("../src/lib/result-adjustments.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { ResultAdjustments, normalizeResults } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const clone = (value) => structuredClone(value);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const waitForRefresh = () => new Promise((resolve) => setTimeout(resolve, 30));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const member = (id = "u1", manager = false) => ({
  user_id: id, name: id, grade: 3, is_manager: manager, votes_count: 2,
  wins_count: 0, prev_votes_count: 2, prev_wins_count: 1,
  practice_ids: [], voted_practice_ids: ["p1", "p2"],
});
const participant = (state = "published", userId = "u1") => ({
  assignment_id: `a-${userId}`, user_id: userId, name: userId, grade: 3,
  is_manager: false, assigned_via: "grade3", publish_state: state,
});
function results(initialParticipant) {
  return {
    by_practice: ["p1", "p2"].map((id, i) => ({
      practice: { id, capacity: 1, practice_date: `2026-10-${10 + i}` },
      participants: i === 0 && initialParticipant ? [initialParticipant] : [],
    })),
    by_member: [member(), member("u2"), member("manager", true)],
  };
}
async function setup(t, initial = results()) {
  const reads = [], writes = [];
  const api = {
    get(path) {
      const job = deferred();
      reads.push({ ...job, path });
      if (reads.length === 1) job.resolve(clone(initial));
      return job.promise;
    },
    post(path, body) {
      const job = deferred(); writes.push({ ...job, path, body }); return job.promise;
    },
    delete(path) {
      const job = deferred(); writes.push({ ...job, path }); return job.promise;
    },
  };
  const store = new ResultAdjustments("month", api, 20);
  t.after(() => store.stop());
  store.start();
  await flush();
  return { store, reads, writes };
}
const row = (store, id = "p1") => store.getSnapshot().results.by_practice.find((p) => p.practice.id === id);
const wins = (store, id = "u1") => store.getSnapshot().results.by_member.find((m) => m.user_id === id).wins_count;
const changes = (store) => store.getSnapshot().results.by_practice.reduce(
  (count, p) => count + p.participants.filter((a) => a.publish_state !== "published").length, 0,
);
const succeed = (job, id = "saved") => job.resolve({ assignment_id: id, capacity_exceeded: false });

test("server removing rows are retained but excluded from effective win counts", () => {
  const input = results(participant("removing"));
  input.by_member[0].wins_count = 1;
  input.by_member[0].practice_ids = ["p1"];
  const normalized = normalizeResults(input);
  assert.equal(normalized.by_member[0].wins_count, 0);
  assert.deepEqual(normalized.by_member[0].practice_ids, []);
  assert.equal(normalized.by_practice[0].participants[0].publish_state, "removing");
  assert.equal(input.by_member[0].wins_count, 1);
});

test("add is immediate, locks only the cell, and confirms the API assignment ID", async (t) => {
  const { store, writes, reads } = await setup(t);
  const save = store.add("p1", member());
  assert.equal(row(store).participants.length, 1);
  assert.equal(wins(store), 1);
  assert.equal(changes(store), 1);
  assert.equal(store.isCellBusy("p1", "u1"), true);
  assert.equal(store.isCellBusy("p2", "u1"), false);
  assert.equal(store.beginPublish(), false);
  succeed(writes[0], "real-id");
  assert.equal(await save, true);
  assert.equal(row(store).participants[0].assignment_id, "real-id");
  assert.equal(reads.length, 1);
  await waitForRefresh();
  assert.equal(reads.length, 2);
  assert.equal(store.getSnapshot().syncing, true);
  reads[1].resolve(clone(store.getSnapshot().results));
  await flush();
  assert.equal(store.getSnapshot().needsSync, false);
  assert.equal(store.beginPublish(), true);
  assert.equal(store.isCellBusy("p2", "u2"), true);
  store.endPublish();
});

test("same cell double clicks do not create duplicate requests", async (t) => {
  const { store, writes } = await setup(t);
  const save = store.add("p1", member());
  assert.equal(await store.add("p1", member()), false);
  assert.equal(writes.length, 1);
  succeed(writes[0]); await save;
});

test("concurrent different cells roll back only the failed operation", async (t) => {
  const { store, writes, reads } = await setup(t);
  const first = store.add("p1", member());
  const second = store.add("p2", member());
  assert.equal(wins(store), 2);
  succeed(writes[1], "p2-saved"); await second;
  await waitForRefresh();
  assert.equal(reads.length, 1, "no refresh while another save is pending");
  writes[0].reject(new Error("first failed"));
  assert.equal(await first, false);
  assert.equal(row(store).participants.length, 0);
  assert.equal(row(store, "p2").participants[0].assignment_id, "p2-saved");
  assert.equal(wins(store), 1);
  assert.match(store.getSnapshot().actionError, /first failed/);
  await waitForRefresh();
  assert.equal(reads.length, 2, "one combined refresh");
});

test("different members on the same practice retain independent state and counts", async (t) => {
  const { store, writes } = await setup(t);
  const first = store.add("p1", member());
  const second = store.add("p1", member("u2"));
  assert.equal(row(store).participants.length, 2);
  succeed(writes[0]); await first;
  writes[1].reject(new Error("second failed")); await second;
  assert.equal(row(store).participants.length, 1);
  assert.equal(wins(store), 1);
  assert.equal(wins(store, "u2"), 0);
});

test("published removal becomes removing; undo restores original via and returned ID", async (t) => {
  const { store, writes } = await setup(t, results(participant()));
  const removal = store.remove("a-u1", true);
  assert.equal(row(store).participants[0].publish_state, "removing");
  assert.equal(wins(store), 0);
  assert.equal(changes(store), 1);
  writes[0].resolve(); await removal;
  const undo = store.add("p1", member());
  assert.equal(row(store).participants[0].publish_state, "published");
  assert.equal(row(store).participants[0].assigned_via, "grade3");
  assert.equal(wins(store), 1);
  assert.equal(changes(store), 0);
  succeed(writes[1], "a-u1"); await undo;
});

for (const published of [false, true]) {
  test(`pending removal deletes the row (published month=${published})`, async (t) => {
    const { store, writes } = await setup(t, results(participant("pending")));
    const save = store.remove("a-u1", published);
    assert.equal(row(store).participants.length, 0);
    assert.equal(wins(store), 0);
    writes[0].resolve(); await save;
  });
}

test("failed removal restores only its row and does not undo a concurrent add", async (t) => {
  const { store, writes } = await setup(t, results(participant()));
  const removal = store.remove("a-u1", true);
  const addition = store.add("p2", member());
  succeed(writes[1], "new-id"); await addition;
  writes[0].reject(new Error("delete failed")); await removal;
  assert.equal(row(store).participants[0].publish_state, "published");
  assert.equal(row(store, "p2").participants[0].assignment_id, "new-id");
  assert.equal(wins(store), 2);
});

test("failed undo restores removing state and counts", async (t) => {
  const { store, writes } = await setup(t, results(participant("removing")));
  const undo = store.add("p1", member());
  writes[0].reject(new Error("undo failed")); await undo;
  assert.equal(row(store).participants[0].publish_state, "removing");
  assert.equal(wins(store), 0);
  assert.equal(changes(store), 1);
});

test("a refresh response cannot overwrite edits started during the request", async (t) => {
  const { store, reads, writes } = await setup(t);
  const oldResponse = clone(store.getSnapshot().results);
  const refresh = store.refresh();
  assert.equal(store.getSnapshot().syncing, true);
  const addition = store.add("p1", member());
  assert.equal(row(store).participants.length, 1);
  reads[1].resolve(oldResponse); await refresh;
  assert.equal(row(store).participants.length, 1);
  assert.equal(store.getSnapshot().needsSync, true);
  assert.equal(store.beginPublish(), false);
  succeed(writes[0]); await addition;
  await waitForRefresh();
  assert.equal(reads.length, 3);
  reads[2].resolve(clone(store.getSnapshot().results)); await flush();
  assert.equal(wins(store), 1);
  assert.equal(store.getSnapshot().needsSync, false);
});

test("refresh failure preserves results, blocks publish, and supports retry", async (t) => {
  const { store, reads } = await setup(t, results(participant("pending")));
  const refresh = store.refresh();
  reads[1].reject(new Error("offline")); await refresh;
  assert.equal(row(store).participants.length, 1);
  assert.equal(store.getSnapshot().syncError, "offline");
  assert.equal(store.getSnapshot().syncing, false);
  assert.equal(store.beginPublish(), false);
  await waitForRefresh();
  assert.equal(reads.length, 2, "no infinite automatic retries");
  const retry = store.refresh();
  reads[2].resolve(results(participant("published"))); await retry;
  assert.equal(store.getSnapshot().syncError, null);
  assert.equal(changes(store), 0);
  assert.equal(store.beginPublish(), true);
});

test("failed initial load supports retry without losing the month", async (t) => {
  const api = { get: async () => { throw new Error("load failed"); } };
  const store = new ResultAdjustments("month", api, 20);
  t.after(() => store.stop()); store.start(); await flush();
  assert.equal(store.getSnapshot().loadError, "load failed");
  assert.equal(store.getSnapshot().results, undefined);
  api.get = async () => results();
  assert.equal(await store.refresh(), true);
  assert.equal(store.getSnapshot().loadError, null);
});

test("unmount removes debounce; late saves do not refresh another month", async (t) => {
  const { store, writes, reads } = await setup(t);
  const save = store.add("p1", member());
  store.stop(); succeed(writes[0]); await save;
  await waitForRefresh();
  assert.equal(reads.length, 1);
});

test("Strict Mode start-stop-start keeps initial request and resumes synchronization", async (t) => {
  const initial = deferred();
  let calls = 0;
  const api = { get: () => { calls++; return initial.promise; } };
  const store = new ResultAdjustments("month", api, 20);
  t.after(() => store.stop());
  store.start(); store.stop(); store.start();
  initial.resolve(results()); await flush();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().results.by_practice.length, 2);
});
