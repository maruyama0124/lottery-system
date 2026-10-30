import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(file,mocks={}){
  const exports={};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,Set,require:name=>mocks[name]??require(name)});
  return exports;
}
const {createHomeGuidePreference,HOME_GUIDE_HIDDEN_KEY}=load('src/lib/home-guide-preference.ts');

test('dismissal survives a new store and notifies mounted consumers',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const store=createHomeGuidePreference(()=>storage);let calls=0;
  const stop=store.subscribe(()=>calls++);
  assert.equal(store.getSnapshot(),false);store.dismiss();
  assert.equal(calls,1);assert.equal(store.getSnapshot(),true);
  assert.equal(data.get(HOME_GUIDE_HIDDEN_KEY),'1');
  assert.equal(createHomeGuidePreference(()=>storage).getSnapshot(),true);
  stop();store.notify();assert.equal(calls,1);
});

test('unavailable storage and quota failure still hide the guide for this session',()=>{
  for(const storage of [()=>{throw Error('blocked');},()=>({getItem:()=>null,setItem:()=>{throw Error('quota');}})]){
    const store=createHomeGuidePreference(storage);
    assert.equal(store.getSnapshot(),false);store.dismiss();assert.equal(store.getSnapshot(),true);
  }
});

test('checkbox is outside the link and immediately hides the guide without navigation',()=>{
  const store=createHomeGuidePreference(()=>({getItem:()=>null,setItem:()=>{}}));
  const {HomeScreenGuide}=load('src/components/member/home-screen-guide.tsx',{
    '@/lib/home-guide-preference':{createHomeGuidePreference:()=>store,HOME_GUIDE_HIDDEN_KEY},
    react:{...React,useSyncExternalStore:(_subscribe,get)=>get()},
    'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  });
  const tree=HomeScreenGuide();
  const html=renderToStaticMarkup(tree);
  assert.match(html,/href="\/help\/home-screen"/);
  assert.match(html,/<\/a><label/);
  assert.match(html,/今後表示しない（このブラウザ）/);
  const checkbox=tree.props.children[1].props.children[0];
  checkbox.props.onChange({target:{checked:true}});
  assert.equal(HomeScreenGuide(),null);
});

test('server rendering defers the guide until browser preference is known',()=>{
  const {HomeScreenGuide}=load('src/components/member/home-screen-guide.tsx',{
    '@/lib/home-guide-preference':{createHomeGuidePreference:()=>({getSnapshot:()=>false}),HOME_GUIDE_HIDDEN_KEY},
    react:{...React,useSyncExternalStore:(_subscribe,_get,getServer)=>getServer()},
    'next/link':{default:()=>null},
  });
  assert.equal(HomeScreenGuide(),null);
});
