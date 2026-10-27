import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(path, mocks={}){
  const code=ts.transpileModule(readFileSync(path,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,require(name){return Object.hasOwn(mocks,name)?mocks[name]:require(name);}});
  return exports;
}
const {releaseNotes}=load('src/lib/release-notes.ts');
function renderPage(auth={user:{role:'representative'},isLoading:false}){
  const page=load('src/app/(admin)/admin/updates/page.tsx',{
    '@/hooks/use-auth':{useRequireRepresentative:()=>auth},
    '@/lib/release-notes':{releaseNotes},
    '@/components/admin/header':{AdminHeader:({title})=>React.createElement('h1',null,title)},
    '@/components/ui/loading':{Loading:()=>React.createElement('div',null,'loading')},
  });
  return renderToStaticMarkup(React.createElement(page.default));
}

test('history covers the fixed-practice release onward, newest first, without invented dates',()=>{
  const ids=Array.from(releaseNotes,n=>Number(n.id.slice(2)));
  assert.ok(ids.every((n,i)=>Number.isInteger(n)&&n>=53&&(i===0||ids[i-1]>n)));
  const covered=Array.from(releaseNotes,n=>[n.id,...(n.relatedDecisionIds??[])]).flat();
  assert.deepEqual(covered.map(id=>Number(id.slice(2))).filter(n=>n<=66).sort((a,b)=>b-a),[66,64,63,62,61,60,55,54,53]);
  assert.equal(new Set(covered).size,covered.length);
  assert.equal(new Set(releaseNotes.map(n=>n.id)).size,releaseNotes.length);
  for(const note of releaseNotes){
    assert.ok(note.title&&note.changes.length&&note.changes.every(Boolean));
    assert.equal(note.changes.length,1);
    assert.equal((note.changes[0].match(/。/g)??[]).length,1);
    assert.ok(note.changes[0].length<=65,'update summary must stay concise');
    assert.equal('date' in note,false);
    if(note.highlight)assert.ok(note.changes.some(text=>text.includes(note.highlight)));
  }
  const html=renderPage();
  assert.equal((html.match(/<article\b/g)??[]).length,releaseNotes.length);
  assert.equal((html.match(/>最新<\/span>/g)??[]).length,1);
  assert.ok(html.indexOf('更新履歴を代表画面に追加')<html.indexOf('確定した練習日を抽選対象から除外'));
  assert.match(html,/管理者が確定済みの練習日を固定/);
  assert.match(html,/人数の設定を抽選準備に一本化/);
});

test('capacity change and LINE browser guidance are emphasized without changing the one-sentence copy',()=>{
  const html=renderPage();
  const bolds=Array.from(html.matchAll(/<strong class="font-bold text-brand-700">([^<]+)<\/strong>/g),m=>m[1]);
  assert.deepEqual(bolds,[
    '日程作成時の人数入力をなくし、抽選準備で学年別に決める',
    'LINE内では操作しづらい場合があるため、通常のブラウザやホーム画面からの利用を推奨',
  ]);
});

test('requested articles are omitted and drag guidance recommends external browser or home screen',()=>{
  assert.ok(releaseNotes.every(n=>!['D-065','D-059','D-058','D-057','D-056'].includes(n.id)));
  const drag=releaseNotes.find(n=>n.id==='D-055');
  assert.match(drag.changes[0],/LINE内では操作しづらい場合/);
  assert.match(drag.changes[0],/通常のブラウザやホーム画面からの利用を推奨/);
});

test('gender registration changes form one article while capacity remains separate',()=>{
  const notes=releaseNotes.filter(n=>[n.id,...(n.relatedDecisionIds??[])].some(id=>['D-060','D-061','D-062','D-063'].includes(id)));
  assert.equal(notes.length,1);
  const note=notes[0];
  assert.match(note.title,/男女の日程をまとめて登録・編集/);
  assert.match(note.changes.join(''),/練習日ごと/);
  assert.match(note.changes.join(''),/登録・編集/);
  assert.ok(releaseNotes.find(n=>n.id==='D-064'));
});

test('non-representatives and pending auth cannot render representative history',()=>{
  for(const auth of [{user:null,isLoading:false},{user:{role:'member'},isLoading:false},{user:{role:'representative'},isLoading:true}]){
    const html=renderPage(auth);
    assert.match(html,/loading/);assert.doesNotMatch(html,/<article|抽選除外/);
  }
});

test('bottom navigation adds updates after results and highlights only the current tab',()=>{
  const icons=new Proxy({},{get:()=>()=>React.createElement('svg',{'aria-hidden':true})});
  for(const path of ['/admin','/admin/schedule','/admin/lottery','/admin/results','/admin/updates']){
    const {AdminTabBar}=load('src/components/admin/tab-bar.tsx',{
      'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
      'next/navigation':{usePathname:()=>path},
      '@/components/ui/icons':icons,
    });
    const html=renderToStaticMarkup(React.createElement(AdminTabBar));
    const anchors=html.match(/<a\b[^>]*>.*?<\/a>/g)??[];
    assert.equal(anchors.length,5);
    assert.deepEqual(anchors.map(a=>a.match(/href="([^"]+)"/)[1]),['/admin','/admin/schedule','/admin/lottery','/admin/results','/admin/updates']);
    assert.equal(anchors.filter(a=>a.includes('aria-current="page"')).length,1);
    assert.ok(anchors.find(a=>a.includes('aria-current="page"')).includes(`href="${path}"`));
    assert.match(anchors[4],/>更新<\/span>/);
    assert.ok(anchors.every(a=>a.includes('min-w-0 flex-1')));
  }
});

test('maintainer rules keep release notes in sync with future user-facing changes',()=>{
  for(const file of ['../AGENTS.md','../CLAUDE.md']){
    assert.match(readFileSync(file,'utf8'),/利用者に影響する.*frontend\/src\/lib\/release-notes\.ts/);
  }
});
