import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/app/(member)/page.tsx', 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function setup({ editable = true, open = true, observer = false, own = true } = {}) {
  const user = { id:'u1', name:'テスト会員', gender:'female', role:'member', grade:2, is_manager:false, is_observer:observer };
  const practices = ['fixed','open','other'].map((id,i) => ({
    id, practice_date:`2026-08-${10+i}`, starts_at:'18:00', ends_at:'21:00', location:`体育館${i}`,
    capacity:28, allowed_grades:[1,2], note:null,
  }));
  const detail = { id:'m1', gender:own?'female':'male', year_month:'2026-08', status:'published', practices,
    vote_starts_at:'2000-01-01T00:00:00Z', vote_ends_at:open?'2099-01-01T00:00:00Z':'2001-01-01T00:00:00Z',
  };
  const home = { data:{ user, months:[detail], detail,
    voteStatus:{ practice_month_id:'m1', voted_practice_ids:['fixed','open'], locked_practice_ids:['fixed'], editable },
    myResults:{ assignments:[{practice:practices[0]}] }, participation:null,
  }, stale:false, refreshing:false, error:null, refresh:async()=>{} };
  const calls = [], states = [];
  let index;
  const exports = {};
  vm.runInNewContext(output, { exports, Date, setInterval, clearInterval, require(name) {
    if (name === 'react') return { ...React, useEffect:()=>{}, useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      if (slot === 1 && !own) states[slot] = 'male';
      return [states[slot], (value) => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
    } };
    if (name === '@/hooks/use-auth') return { useRequireAuth:()=>({user,isLoading:false}) };
    if (name === '@/hooks/use-member-home') return { useMemberHome:()=>home };
    if (name === '@/lib/api-client') return { apiClient:{put:async(path,body)=>calls.push({path,body})}, ApiClientError:class extends Error {} };
    if (name === 'next/link') return { default:({children,...props})=>React.createElement('a',props,children), __esModule:true };
    if (name === '@/components/quasar') return {Quasar:()=>null};
    if (name === '@/components/member/participation-table') return {ParticipationTable:()=>null};
    if (name === '@/components/ui/loading') return {Loading:()=>null};
    if (name === '@/components/ui/error-message') return {ErrorMessage:({message})=>React.createElement('p',null,message)};
    return require(name);
  } });
  const tree = () => { index=0; return exports.default(); };
  const html = () => renderToStaticMarkup(tree());
  const nodes = (element) => {
    if (!element || typeof element !== 'object') return [];
    if (Array.isArray(element)) return element.flatMap(nodes);
    return [element,...nodes(element.props?.children)];
  };
  const buttons = () => nodes(tree()).filter(n=>n.type==='button');
  const text = (element) => typeof element === 'string' ? element : Array.isArray(element)
    ? element.map(text).join('') : element?.props ? text(element.props.children) : '';
  const day = (date) => buttons().find(b=>text(b).includes(date));
  const submit = () => buttons().find(b=>text(b).includes('送信'));
  return {home,calls,html,day,submit,tree};
}

test('partial publication renders public result and editable remaining votes', () => {
  const ui=setup();
  assert.match(ui.html(),/参加する練習 1日/);
  assert.match(ui.html(),/参加できる日を選択してください/);
  assert.match(ui.html(),/確定済み（変更不可）/);
  assert.equal(ui.day('8/10').props.disabled,true);
  assert.equal(ui.day('8/11').props.disabled,false);
  assert.match(ui.html(),/1日を送信/); // 固定日の1票を含めない
});

test('saving remaining selection retains fixed vote and fixed button cannot toggle', async () => {
  const ui=setup();
  ui.day('8/10').props.onClick(); // disabledに加えてイベント側でも保護
  ui.day('8/11').props.onClick();
  ui.day('8/12').props.onClick();
  await ui.submit().props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[0].body.practice_ids)).sort(),['fixed','other']);
  assert.match(ui.html(),/投票を保存しました/);
});

test('refresh preserves dirty remaining votes but adopts newly locked server votes', async () => {
  const ui=setup();
  ui.day('8/12').props.onClick();
  ui.home.data = { ...ui.home.data, voteStatus:{...ui.home.data.voteStatus,
    locked_practice_ids:['fixed','open'], voted_practice_ids:['fixed'],
  } };
  assert.equal(ui.day('8/11').props.disabled,true);
  await ui.submit().props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls[0].body.practice_ids)).sort(),['fixed','other']);
});

test('closed, server-denied, observer and opposite-gender views cannot submit', () => {
  for (const option of [{open:false},{editable:false},{observer:true},{own:false}]) {
    const ui=setup(option);
    assert.equal(ui.submit(),undefined);
    assert.doesNotMatch(ui.html(),/参加できる日を選択してください/);
  }
});

test('cached data without live vote state never enables published voting', () => {
  const ui=setup(); ui.home.data.voteStatus=null; ui.home.stale=true;
  assert.equal(ui.submit(),undefined);
  assert.match(ui.html(),/参加する練習 1日/);
});
