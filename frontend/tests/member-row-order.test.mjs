import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/member-row-order.ts','utf8'), {
  compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
}).outputText, {exports});
const { MemberRowOrderStore,orderMembers,previewRowOffsets,ROW_ORDER_PREFIX }=exports;
const rows=[
  {user_id:'a',grade:3,is_manager:false}, {user_id:'b',grade:3,is_manager:false},
  {user_id:'c',grade:3,is_manager:false}, {user_id:'d',grade:2,is_manager:false},
  {user_id:'e',grade:2,is_manager:false}, {user_id:'m',grade:3,is_manager:true},
  {user_id:'n',grade:3,is_manager:true}, {user_id:'o',grade:2,is_manager:true},
];
const ids=(value)=>Array.from(value,r=>r.user_id);
class Storage {
  values=new Map();
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,value);}
}
const key=(user='u1',gender='female')=>ROW_ORDER_PREFIX+JSON.stringify([user,gender]);
const sorted=(store,data=rows)=>orderMembers(data,store.getSnapshot().orders);

test('same-grade reorder persists, restores, and never mutates API rows',()=>{
  const storage=new Storage(),store=new MemberRowOrderStore(key(),storage),before=JSON.stringify(rows);
  assert.equal(store.move('a','c',rows),true);
  assert.deepEqual(ids(sorted(store)),['b','c','a','d','e','m','n','o']);
  assert.equal(JSON.stringify(rows),before);
  assert.deepEqual(ids(sorted(new MemberRowOrderStore(key(),storage))),ids(sorted(store)));
  assert.equal(storage.getItem(key()).includes('name'),false);
});
test('cross-grade, player/manager, unknown and self moves do nothing',()=>{
  const storage=new Storage(),store=new MemberRowOrderStore(key(),storage);
  for(const [source,target] of [['a','d'],['m','o'],['a','m'],['missing','a'],['a','a']]){
    assert.equal(store.move(source,target,rows),false);
  }
  assert.equal(storage.values.size,0);
  assert.deepEqual(ids(sorted(store)),ids(rows));
});
test('same-grade managers can move within the manager section',()=>{
  const store=new MemberRowOrderStore(key(),new Storage());
  store.move('m','n',rows);
  assert.deepEqual(ids(sorted(store)),['a','b','c','d','e','n','m','o']);
});
test('admin matrix alone can mix managers and players within the same grade',()=>{
  const storage=new Storage(),matrixKey=key()+':admin-matrix';
  const separate=new MemberRowOrderStore(key(),storage);
  separate.move('a','c',rows);
  const before=storage.getItem(key());
  const mixed=new MemberRowOrderStore(matrixKey,storage,'mixed');
  assert.equal(mixed.move('m','a',rows),true);
  const ordered=orderMembers(rows,mixed.getSnapshot().orders,'mixed');
  assert.deepEqual(ids(ordered.filter(r=>r.grade===3)),['m','a','b','c','n']);
  assert.deepEqual(ordered.map(r=>r.grade),rows.map(r=>r.grade));
  assert.equal(mixed.move('m','d',rows),false);
  assert.equal(storage.getItem(key()),before);
  assert.deepEqual(ids(sorted(separate)).slice(0,3),['b','c','a']);
  const restored=new MemberRowOrderStore(matrixKey,storage,'mixed');
  assert.deepEqual(ids(orderMembers(rows,restored.getSnapshot().orders,'mixed')),ids(ordered));
});
test('filtered views share order and absent IDs are retained for other months',()=>{
  const storage=new Storage(),store=new MemberRowOrderStore(key(),storage);
  store.move('a','c',rows);
  assert.deepEqual(ids(sorted(store,[rows[0],rows[2]])),['c','a']);
  store.move('a','c',[rows[0],rows[2]]);
  assert.deepEqual(ids(sorted(store)),['b','a','c','d','e','m','n','o']);
  assert.ok(store.getSnapshot().orders['3:player'].includes('b'));
});
test('new IDs append; deleted IDs do not render; grade changes do not cross boundaries',()=>{
  const store=new MemberRowOrderStore(key(),new Storage());store.move('a','c',rows);
  const next=[{user_id:'new',grade:3,is_manager:false},...rows.filter(r=>r.user_id!=='b')];
  assert.deepEqual(ids(sorted(store,next)).slice(0,3),['c','a','new']);
  const changed=rows.map(r=>r.user_id==='a'?{...r,grade:2}:r);
  const actual=sorted(store,changed);
  assert.deepEqual(actual.map(r=>r.grade),changed.map(r=>r.grade));
});
test('account and gender storage are separate',()=>{
  const storage=new Storage(),store=new MemberRowOrderStore(key(),storage);store.move('a','c',rows);
  for(const other of [key('u2'),key('u1','male')])assert.deepEqual(ids(sorted(new MemberRowOrderStore(other,storage))),ids(rows));
});
test('malformed storage and invalid groups cannot break rendering',()=>{
  for(const raw of ['bad','null','[]','{"__proto__":["a"]}','{"3:player":[false]}']){
    const storage=new Storage();storage.setItem(key(),raw);
    assert.deepEqual(ids(sorted(new MemberRowOrderStore(key(),storage))),ids(rows));
  }
});
test('storage failure retains in-memory ordering and reports persistence failure',()=>{
  const store=new MemberRowOrderStore(key(),{getItem(){throw Error('blocked')},setItem(){throw Error('full')}});
  store.move('a','c',rows);
  assert.deepEqual(ids(sorted(store)).slice(0,3),['b','c','a']);
  assert.match(store.getSnapshot().error,/保存できません/);
});
test('shared subscriptions and external reload update mounted views',()=>{
  const storage=new Storage(),store=new MemberRowOrderStore(key(),storage);let changes=0;
  const off=store.subscribe(()=>changes++);
  store.move('a','c',rows);
  storage.setItem(key(),JSON.stringify({'3:player':['c','b','a']}));store.reload();
  assert.equal(changes,2);assert.deepEqual(ids(sorted(store)).slice(0,3),['c','b','a']);off();
});

test('animated preview opens exact space for unequal row heights',()=>{
  const boxes=[{id:'a',group:'3:player',top:0,height:20},
    {id:'b',group:'3:player',top:20,height:40},{id:'c',group:'3:player',top:60,height:30}];
  const before=JSON.stringify(boxes);
  assert.deepEqual(JSON.parse(JSON.stringify(previewRowOffsets(boxes,'a','c'))),{b:-20,c:-20,a:70});
  assert.deepEqual(JSON.parse(JSON.stringify(previewRowOffsets(boxes,'c','a'))),{c:-60,a:30,b:30});
  assert.equal(JSON.stringify(boxes),before);
});
test('animated preview preserves other-group slots and heading gaps',()=>{
  const boxes=[{id:'a',group:'3:player',top:10,height:20},
    {id:'manager',group:'3:manager',top:30,height:10},
    {id:'b',group:'3:player',top:40,height:40},
    {id:'d',group:'2:player',top:100,height:30}];
  const offsets=previewRowOffsets(boxes,'a','b');
  assert.equal(offsets.b,-30);assert.equal(offsets.manager,20);assert.equal(offsets.a,50);assert.equal(offsets.d,0);
  assert.equal(previewRowOffsets(boxes,'a','d'),null);
  assert.equal(previewRowOffsets(boxes,'a','manager'),null);
  assert.equal(previewRowOffsets(boxes,'missing','b'),null);
});
