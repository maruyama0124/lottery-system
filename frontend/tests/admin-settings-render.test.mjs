import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(path,mocks={}){
  const exports={};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  vm.runInNewContext(code,{exports,require:name=>mocks[name]??require(name)});
  return exports;
}

test('member administration remains available without coefficient UI or API requests',()=>{
  const calls=[];
  const members=['male','female'].map((gender,i)=>({id:`member-${i}`,name:`会員${i}`,grade:2,gender,role:'member'}));
  const {default:Page}=load('src/app/(admin)/admin/settings/page.tsx',{
    '@/components/admin/header':{AdminHeader:({title})=>React.createElement('h1',null,title)},
    '@/components/admin/gender-scope':{useAdminGenderLock:()=>{}},
    '@/components/ui/error-message':{ErrorMessage:()=>null},
    '@/components/ui/loading':{Loading:()=>null},
    '@/lib/api-client':{apiClient:{},ApiClientError:class extends Error{}},
    '@/hooks/use-api':{useApi:path=>{calls.push(path);return{data:{items:members},isLoading:false};}},
    '@/hooks/use-auth':{useRequireRepresentative:()=>({user:{id:'rep',role:'representative'},isLoading:false})},
  });
  const html=renderToStaticMarkup(React.createElement(Page));
  assert.match(html,/代表権限の引き継ぎ/);
  assert.match(html,/メンバーの無効化/);
  assert.match(html,/会員0/);assert.match(html,/会員1/);
  assert.doesNotMatch(html,/救済係数|rescue-alpha|抽選設定/);
  assert.deepEqual(calls,['/v1/users?per_page=200']);
});

test('coefficient removal is intentionally omitted from public release notes',()=>{
  const {releaseNotes}=load('src/lib/release-notes.ts');
  assert.ok(releaseNotes.every(note=>note.id!=='D-071' && !(note.relatedDecisionIds??[]).includes('D-071')));
});
