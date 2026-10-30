import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('src/components/admin/gender-scope.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;

function setup(initialUser){
  let user=initialUser,index=0,scope;
  const states=[],exports={};
  vm.runInNewContext(code,{exports,Set,require(name){
    if(name==='@/lib/auth-context')return{useAuth:()=>({user})};
    if(name==='react')return{...React,
      useState(initial){const slot=index++;if(!(slot in states))states[slot]=initial;return[states[slot],v=>{states[slot]=typeof v==='function'?v(states[slot]):v;}];},
      useMemo:fn=>fn(),useCallback:fn=>fn,useContext:()=>scope,
    };
    return require(name);
  }});
  function render(){index=0;const tree=exports.AdminGenderProvider({children:React.createElement('p',null,'editor')});scope=tree.props.value;return tree.props.children;}
  return{render,scope:()=>scope,setUser:value=>{user=value;},selector:()=>exports.AdminGenderSelector()};
}

test('pending authentication renders safely and account changes cannot inherit target selection',()=>{
  const app=setup(null);app.render();assert.equal(app.scope().gender,'male');
  app.setUser({id:'female-rep',gender:'female'});app.render();assert.equal(app.scope().gender,'female');
  app.scope().setGender('male');app.render();assert.equal(app.scope().gender,'male');
  app.setUser({id:'another-rep',gender:'female'});app.render();assert.equal(app.scope().gender,'female');
});

test('gender change remounts editing scope and stable renders preserve its key',()=>{
  const app=setup({id:'rep',gender:'male'});
  const original=app.render().key;assert.equal(app.render().key,original);
  app.scope().setGender('female');assert.notEqual(app.render().key,original);
  assert.equal(app.scope().gender,'female');
  assert.match(renderToStaticMarkup(app.selector()),/女子を管理/);
});

test('multiple in-flight operations lock switching until all have finished',()=>{
  const app=setup({id:'rep',gender:'male'});app.render();
  app.scope().setLock('save',true);app.scope().setLock('refresh',true);app.render();
  assert.equal(app.scope().busy,true);
  assert.equal((renderToStaticMarkup(app.selector()).match(/disabled=""/g)??[]).length,2);
  app.scope().setLock('save',false);app.render();assert.equal(app.scope().busy,true);
  app.scope().setLock('refresh',false);app.render();assert.equal(app.scope().busy,false);
});

test('every management read and setting write explicitly uses selected gender',()=>{
  for(const file of ['page.tsx','lottery/page.tsx','results/page.tsx','schedule/page.tsx']){
    const source=readFileSync(`src/app/(admin)/admin/${file}`,'utf8');
    assert.ok(source.includes('/v1/practice-months?gender=${gender}'),file);
  }
  const settings=readFileSync('src/app/(admin)/admin/settings/page.tsx','utf8');
  assert.equal((settings.match(/\/v1\/settings\?gender=\$\{gender\}/g)??[]).length,2);
  assert.doesNotMatch(settings,/members\.filter\(\(u\) => u\.gender === user\.gender\)/);
});
