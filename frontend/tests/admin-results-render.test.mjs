import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/app/(admin)/admin/results/page.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
});
const practice = {
  id: "p1", practice_date: "2026-10-13", starts_at: "18:00", ends_at: "20:00",
  location: "体育館", capacity: 2, allowed_grades: null, note: null, vote_count: 2,
};
const members = ["会員A", "会員B"].map((name, i) => ({
  user_id: `u${i + 1}`, name, grade: 3, is_manager: false,
  wins_count: i === 0 ? 1 : 0, votes_count: 1, prev_votes_count: 0,
  prev_wins_count: 0, practice_ids: i === 0 ? ["p1"] : [], voted_practice_ids: ["p1"],
}));
const initial = {
  results: {
    by_practice: [{ practice, participants: [{
      assignment_id: "a1", user_id: "u1", name: "会員A", grade: 3,
      is_manager: false, assigned_via: "manual", publish_state: "pending",
    }] }],
    by_member: members,
  },
  saving: false, syncing: false, publishing: false, needsSync: false,
  dirtyChanges: 0, savedChanges: 1, saveError: null,
  syncError: null, loadError: null,
};

function render(patch = {}, monthAvailable = true) {
  const state = { ...initial, ...patch };
  const pm = {
    id: "month", year_month: "2026-10", gender: "male", status: "published",
    practices: [practice], vote_ends_at: "2026-10-01T00:00:00Z",
  };
  state.store = {
    isCellBusy: () => state.publishing || state.saving || state.syncing || state.needsSync || !!state.syncError,
    refresh: async () => true,
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "@/hooks/use-result-adjustments") return { useResultAdjustments: () => state };
      if (name === "@/hooks/use-auth") return { useRequireRepresentative: () => ({ user: { role: "representative" }, isLoading: false }) };
      if (name === "@/hooks/use-api") return { useApi: (path) => ({
        data: path === "/v1/practice-months" ? [pm]
          : path?.includes("/users?") ? { items: [] } : monthAvailable ? pm : undefined,
        mutate: async () => {},
      }) };
      if (name === "@/lib/api-client") return { apiClient: {}, ApiClientError: class extends Error {} };
      if (name === "@/components/admin/header") return { AdminHeader: () => React.createElement("header", null, "結果・微調整") };
      if (name === "@/components/ui/error-message") return { ErrorMessage: ({ message, onRetry }) =>
        React.createElement("div", null, message, onRetry && React.createElement("button", null, "再試行")) };
      if (name === "@/components/ui/loading") return { Loading: () => React.createElement("div", null, "loading") };
      if (name === "@/components/ui/icons") return new Proxy({}, { get: () => () => null });
      return require(name);
    },
  };
  vm.runInNewContext(outputText, context);
  return renderToStaticMarkup(React.createElement(context.exports.default));
}
const buttons = (html) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const cell = (html, name) => buttons(html).find((b) => b.includes(`aria-label="${name} `));
const footer = (html) => html.slice(html.indexOf('class="fixed bottom-14'));

test("saving disables all matrix cells and save/publication buttons", () => {
  const html = render({ saving: true, dirtyChanges: 1 });
  assert.match(cell(html, "会員A"), /disabled=""/);
  assert.match(cell(html, "会員A"), /aria-busy="true"/);
  assert.match(cell(html, "会員B"), /disabled=""/);
  assert.match(footer(html), /保存中…/);
  assert.match(footer(html), /disabled=""/);
});

test("refresh shows spinner in footer and disables all editing", () => {
  const html = render({ syncing: true, needsSync: true });
  assert.match(footer(html), /role="status"/);
  assert.match(footer(html), /animate-spin/);
  assert.match(footer(html), /最新の状態を確認中…/);
  assert.doesNotMatch(footer(html), /<button/);
  assert.match(cell(html, "会員B"), /disabled=""/);
});

test("refresh failure replaces publish with an error and retry", () => {
  const html = render({ syncError: "通信失敗", needsSync: true });
  assert.match(footer(html), /通信失敗/);
  assert.match(footer(html), /再試行/);
  assert.doesNotMatch(footer(html), /変更を再公開/);
});

test("after confirmation publish label follows latest pending changes", () => {
  assert.match(footer(render()), /変更を再公開する（1件）/);
  const confirmed = structuredClone(initial.results);
  confirmed.by_practice[0].participants[0].publish_state = "published";
  const html = render({ results: confirmed, savedChanges: 0 });
  assert.match(footer(html), /公開済み/);
  assert.match(footer(html), /disabled=""/);
});

test("removing stays visible but is excluded from daily participation and wins", () => {
  const changed = structuredClone(initial.results);
  changed.by_practice[0].participants[0].publish_state = "removing";
  changed.by_member[0].wins_count = 0;
  changed.by_member[0].practice_ids = [];
  const html = render({ results: changed });
  assert.match(cell(html, "会員A"), /×/);
  assert.match(html, /0\/2/);
  assert.match(html, /0\/1/);
  assert.match(footer(html), /変更を再公開する（1件）/);
});

test("cells cannot be edited before month status is available", () => {
  const html = render({}, false);
  assert.match(cell(html, "会員A"), /disabled=""/);
  assert.match(cell(html, "会員B"), /disabled=""/);
});

test("unsaved count and saved count are separate; unsaved editing keeps cells enabled", () => {
  const html = render({ dirtyChanges: 2, savedChanges: 1 });
  assert.match(footer(html), /未保存の変更：2件/);
  assert.match(footer(html), /保存済み・公開待ち：1件/);
  const save = buttons(footer(html)).find((b) => b.includes("変更を保存"));
  const publish = buttons(footer(html)).find((b) => b.includes("再公開する"));
  assert.doesNotMatch(save, /disabled=""/); assert.match(publish, /disabled=""/);
  assert.doesNotMatch(cell(html, "会員B"), /disabled=""/);
});
test("save failure offers save retry; refresh failure states save already completed", () => {
  assert.match(footer(render({ dirtyChanges: 1, saveError: "保存失敗" })), /再試行/);
  assert.match(footer(render({ needsSync: true, syncError: "取得失敗" })), /保存は完了しています/);
});
