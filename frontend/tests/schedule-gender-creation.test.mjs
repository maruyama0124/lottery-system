import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('src/app/(admin)/admin/schedule/page.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText+'\nexports.NewMonthForm=NewMonthForm;exports.PracticeCard=PracticeCard;';
const male={id:'pm-male',gender:'male',year_month:'2026-08',status:'draft',vote_starts_at:'2026-07-01T00:00:00Z',vote_ends_at:'2026-07-30T00:00:00Z',practices:[]};
const female={...male,id:'pm-female',gender:'female'};
const practice={id:'p-edit',practice_date:'2026-08-24',starts_at:'18:00',ends_at:'21:30',location:'体育館',capacity:30,allowed_grades:null,note:null,vote_count:0};
class ApiError extends Error {constructor(message){super(message);this.error={message};}}
function setup(component='NewMonthForm',{otherExists=true,fail=false,editorGenders=['male','female'],saveFail=false,loadFail=false}={}){
  let index=0;const states=[],calls=[],created=[];
  const exports={};
  vm.runInNewContext(code,{exports,Date,Number,Set,Map,require(name){
    if(name==='react')return{...React,useState(initial){const slot=index++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;return[states[slot],value=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];}};
    if(name==='@/hooks/use-auth')return{useRequireRepresentative:()=>({user:{id:'rep',name:'代表',role:'representative',gender:'male'},isLoading:false})};
    if(name==='@/hooks/use-api')return{useApi:path=>({data:path?.includes('gender=male')?[male]:path?.includes('gender=female')?(otherExists?[female]:[]):path?.includes('pm-male')?male:path?.includes('pm-female')?female:[],mutate:async()=>{},isLoading:false})};
    if(name==='@/lib/api-client')return{ApiClientError:ApiError,apiClient:{
      post:async(path,body)=>{calls.push(JSON.parse(JSON.stringify({path,body})));if(fail)throw new ApiError('同じ月が既に存在します');return[male,female];},
      get:async(path)=>{calls.push({path,method:'GET'});if(loadFail)throw new ApiError('編集情報を取得できません');return{practice,genders:editorGenders,available_genders:otherExists?['male','female']:['male'],versions:Object.fromEntries(editorGenders.map(g=>[g,{id:g==='male'?practice.id:'p-female',updated_at:'2026-08-01T00:00:00Z'}]))};},
      put:async(path,body)=>{calls.push(JSON.parse(JSON.stringify({path,body,method:'PUT'})));if(saveFail)throw new ApiError('投票があるため削除できません');},
    }};
    if(name==='@/components/admin/header')return{AdminHeader:()=>null};
    if(name==='@/components/ui/icons')return new Proxy({},{get:()=>()=>null});
    if(name==='@/components/ui/loading')return{Loading:()=>null};
    if(name==='@/components/ui/error-message')return{ErrorMessage:({message})=>React.createElement('p',null,message)};
    return require(name);
  }});
  const tree=()=>{index=0;return component==='PracticeCard'?exports.PracticeCard({practice,yearMonth:'2026-08',readOnly:true,onUpdated:()=>created.push('updated')}):component==='NewMonthForm'?exports.NewMonthForm({defaultGender:'male',onCreated:value=>created.push(value),onCancel:()=>{}}):exports.default();};
  const nodes=element=>!element||typeof element!=='object'?[]:Array.isArray(element)?element.flatMap(nodes):typeof element.type==='function'?nodes(element.type(element.props)):[element,...nodes(element.props?.children)];
  const text=e=>typeof e==='string'?e:Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):'';
  const button=(label,occurrence=0)=>nodes(tree()).filter(n=>n.type==='button'&&text(n).trim()===label)[occurrence];
  const ariaButton=label=>nodes(tree()).find(n=>n.type==='button'&&n.props['aria-label']===label);
  const set=(predicate,value)=>{const node=nodes(tree()).find(n=>n.type==='input'&&predicate(n.props));assert.ok(node);node.props.onChange({target:{value}});};
  const html=()=>renderToStaticMarkup(tree());
  return{calls,created,button,ariaButton,set,html,states};
}

for(const [label,genders] of [['男子',['male']],['女子',['female']],['両方',['male','female']]]){
  test(`new month ${label} uses one batch request and confirms targets`,async()=>{
    const ui=setup();ui.set(p=>p.type==='month','2026-08');ui.button('＋ 練習日を追加').props.onClick();ui.button(label).props.onClick();
    ui.set(p=>p.type==='date'&&p.min,'2026-08-24');
    ui.set(p=>p.placeholder==='1830','1800');ui.set(p=>p.placeholder==='2130','2130');ui.set(p=>p.placeholder==='第一体育館','テスト体育館');
    ui.set(p=>p.type==='month','2026-08');
    ui.set(p=>p.type==='date'&&p.value==='','2026-07-01');
    ui.set(p=>p.type==='date'&&p.value==='','2026-07-30');
    assert.equal(ui.button('入力内容を確認').props.disabled,false);
    ui.button('入力内容を確認').props.onClick();
    assert.match(ui.html(),/登録対象/);
    assert.match(ui.html(),/同じ日付があれば入力内容に更新/);
    await ui.button('保存する').props.onClick();
    assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/v1/practice-months/batch');
    assert.deepEqual(ui.calls[0].body.genders,[...genders].sort());assert.equal(ui.created.length,1);
    assert.deepEqual(ui.calls[0].body.practices[0].genders,genders);
    assert.equal(Object.hasOwn(ui.calls[0].body.practices[0],'capacity'),false);
  });
}
test('failed creation retains confirmation and target for retry',async()=>{
  const ui=setup('NewMonthForm',{fail:true});ui.set(p=>p.type==='month','2026-08');ui.button('＋ 練習日を追加').props.onClick();ui.button('両方').props.onClick();
  ui.set(p=>p.type==='date'&&p.min,'2026-08-24');ui.set(p=>p.placeholder==='1830','1800');ui.set(p=>p.placeholder==='2130','2130');ui.set(p=>p.placeholder==='第一体育館','テスト体育館');
  ui.set(p=>p.type==='month','2026-08');ui.set(p=>p.type==='date'&&p.value==='','2026-07-01');ui.set(p=>p.type==='date'&&p.value==='','2026-07-30');
  ui.button('入力内容を確認').props.onClick();await ui.button('保存する').props.onClick();
  assert.match(ui.html(),/同じ月が既に存在します/);assert.match(ui.html(),/男子・女子の両方/);assert.equal(ui.created.length,0);
  await ui.button('保存する').props.onClick();assert.equal(ui.calls.length,2);assert.deepEqual(ui.calls[0].body,ui.calls[1].body);
});
test('mixed daily targets and duplication retain independent selections',async()=>{
  const ui=setup();ui.set(p=>p.type==='month','2026-08');ui.set(p=>p.type==='date'&&p.value==='','2026-07-01');ui.set(p=>p.type==='date'&&p.value==='','2026-07-30');
  ui.button('＋ 練習日を追加').props.onClick();ui.button('女子').props.onClick();
  ui.set(p=>p.type==='date'&&p.min,'2026-08-24');ui.set(p=>p.placeholder==='1830','1800');ui.set(p=>p.placeholder==='2130','2130');ui.set(p=>p.placeholder==='第一体育館','テスト体育館');
  ui.button('同じ内容で別日を追加').props.onClick();ui.set(p=>p.type==='date'&&p.value==='','2026-08-25');
  ui.button('両方',1).props.onClick();
  ui.button('入力内容を確認').props.onClick();await ui.button('保存する').props.onClick();
  assert.deepEqual(ui.calls[0].body.genders,['female','male']);
  assert.deepEqual(ui.calls[0].body.practices.map(p=>p.genders),[['female'],['male','female']]);
});
test('existing month day addition can target both in one request',async()=>{
  const ui=setup('page');ui.button('＋ 練習日を追加').props.onClick();ui.button('両方').props.onClick();
  ui.set(p=>p.type==='date'&&!p.id,'2026-08-24');ui.set(p=>p.placeholder==='1830','1800');ui.set(p=>p.placeholder==='2130','2130');ui.set(p=>p.placeholder==='第一体育館','テスト体育館');
  assert.equal(ui.button('追加・更新する').props.disabled,false);await ui.button('追加・更新する').props.onClick();
  assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/v1/practices/batch');assert.deepEqual(ui.calls[0].body.genders,['male','female']);assert.equal(ui.calls[0].body.practice.practice_date,'2026-08-24');
});
test('both addition is disabled when opposite-gender month does not exist',()=>{
  const ui=setup('page',{otherExists:false});ui.button('＋ 練習日を追加').props.onClick();ui.button('両方').props.onClick();
  ui.set(p=>p.type==='date'&&!p.id,'2026-08-24');ui.set(p=>p.placeholder==='第一体育館','テスト体育館');
  assert.equal(ui.button('追加・更新する').props.disabled,true);assert.match(ui.html(),/先にその月を作成してください/);
});
test('opposite-gender viewing offers schedule editing, not vote-period editing',()=>{
  const ui=setup('page');ui.button('女子の日程').props.onClick();
  assert.ok(ui.button('＋ 練習日を追加'));assert.equal(ui.button('投票期間を保存'),undefined);
  assert.match(ui.html(),/抽選は、担当の代表が行います/);
});

test('existing editor fetches both genders and saves selection with versions in one PUT',async()=>{
  const ui=setup('PracticeCard');assert.equal(ui.ariaButton('削除'),undefined);
  await ui.ariaButton('編集').props.onClick();
  assert.equal(ui.button('両方').props['aria-pressed'],true);
  ui.button('女子').props.onClick();await ui.button('保存する').props.onClick();
  assert.equal(ui.calls.length,2);assert.equal(ui.calls[1].method,'PUT');
  assert.equal(ui.calls[1].path,'/v1/practices/p-edit/genders');
  assert.deepEqual(ui.calls[1].body.genders,['female']);
  assert.equal(Object.hasOwn(ui.calls[1].body.practice,'capacity'),false);
  assert.deepEqual(Object.keys(ui.calls[1].body.expected_versions),['male','female']);
  assert.equal(ui.created.length,1);assert.ok(ui.ariaButton('編集'));
});
test('schedule forms have no capacity input and unset capacities are labelled',async()=>{
  const ui=setup();ui.button('＋ 練習日を追加').props.onClick();
  assert.doesNotMatch(ui.html(),/>定員<\/label>/);
  const card=setup('PracticeCard');await card.ariaButton('編集').props.onClick();
  assert.doesNotMatch(card.html(),/>定員<\/label>/);
});
test('blocked removal preserves editing values and supports retry',async()=>{
  const ui=setup('PracticeCard',{saveFail:true});await ui.ariaButton('編集').props.onClick();
  ui.button('男子').props.onClick();ui.set(p=>p.placeholder==='第一体育館','修正内容');
  await ui.button('保存する').props.onClick();assert.match(ui.html(),/投票があるため削除できません/);
  assert.match(ui.html(),/修正内容/);assert.equal(ui.button('男子').props['aria-pressed'],true);
  await ui.button('保存する').props.onClick();assert.deepEqual(ui.calls[1].body,ui.calls[2].body);
  assert.equal(ui.created.length,0);
});
test('missing target month disables save and loading failure never opens editable form',async()=>{
  const ui=setup('PracticeCard',{otherExists:false,editorGenders:['male']});await ui.ariaButton('編集').props.onClick();
  ui.button('両方').props.onClick();assert.equal(ui.button('保存する').props.disabled,true);
  assert.match(ui.html(),/先にその月を作成してください/);
  const failed=setup('PracticeCard',{loadFail:true});await failed.ariaButton('編集').props.onClick();
  assert.equal(failed.button('保存する'),undefined);assert.match(failed.html(),/編集情報を取得できません/);
});
