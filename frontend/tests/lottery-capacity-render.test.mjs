import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('src/app/(admin)/admin/lottery/page.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText+'\nexports.VoteBar=VoteBar;';
const exports={};
vm.runInNewContext(code,{exports,require(name){
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  return {};
}});
test('lottery distinguishes unset capacity and confirmed quota total',()=>{
  const practice={capacity:null,grades:[{grade:1,voters:3},{grade:2,voters:2},{grade:3,voters:1}]};
  assert.match(renderToStaticMarkup(React.createElement(exports.VoteBar,{practice})),/定員未設定/);
  assert.match(renderToStaticMarkup(React.createElement(exports.VoteBar,{practice:{...practice,capacity:6}})),/確定定員 6名/);
  assert.match(renderToStaticMarkup(React.createElement(exports.VoteBar,{practice:{...practice,capacity:0}})),/確定定員 0名/);
});
