import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url),exports={};
const source=readFileSync('src/app/layout.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,require(name){
  if(name==='next/font/google')return{Noto_Sans_JP:()=>({variable:'test-font'})};
  if(name==='@/lib/auth-context')return{AuthProvider:()=>null};
  if(name.endsWith('.css'))return{};
  return require(name);
}});
test('browser and home-screen suggested app name is クエーさん',()=>{
  assert.equal(exports.metadata.title,'クエーさん');
  assert.equal(exports.metadata.applicationName,'クエーさん');
  assert.equal(exports.metadata.appleWebApp.title,'クエーさん');
  assert.equal(exports.metadata.appleWebApp.capable,false);
});
