// ローカル専用。起動済みNext.js/APIを使い、独立したChromeで表示設定だけを変更する。
// frontendで node tests/check-member-row-order-browser.mjs
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const origin='http://localhost:3000';
const token=execFileSync('docker',['compose','-f','../backend/docker-compose.yaml','exec','-T','api','python','-c',`from sqlalchemy import select
from src.db.session import SessionLocal,engine
from src.db.models import User
from src.core.security import create_access_token
assert engine.url.host=='postgres' and engine.url.database=='lottery_db'
with SessionLocal() as db:
 u=db.scalar(select(User).where(User.gender=='female',User.role=='representative',User.is_observer.is_(False),User.is_deleted.is_(False)))
 assert u
 print(create_access_token(u.id,u.role,u.gender))`],{encoding:'utf8'}).trim();
const profile=await mkdtemp(join(tmpdir(),'lottery-row-order-browser-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','about:blank',
],{stdio:['ignore','ignore','pipe']});
let ws;
try {
  const endpoint=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),15000);
    chrome.stderr.on('data',chunk=>{log+=chunk;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    chrome.on('error',reject);
  });
  ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let sequence=0;const pending=new Map(),writes=[],exceptions=[];
  ws.addEventListener('message',({data})=>{
    const m=JSON.parse(data);
    if(m.id){const task=pending.get(m.id);pending.delete(m.id);if(m.error)task.reject(Error(JSON.stringify(m.error)));else task.resolve(m.result);}
    if(m.method==='Network.requestWillBeSent'&&m.params.request.url.startsWith(origin+'/api/')&&['PUT','POST','DELETE','PATCH'].includes(m.params.request.method))writes.push(m.params.request.url);
    if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const{targetId}=await call('Target.createTarget',{url:'about:blank'});
  const{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>call(method,params,sessionId);
  const evaluate=async(expression)=>{
    const value=await page('Runtime.evaluate',{expression,returnByValue:true});
    if(value.exceptionDetails)throw Error(value.exceptionDetails.text);
    return value.result.value;
  };
  const tick=()=>new Promise(r=>setTimeout(r,100));
  const wait=async(expression)=>{for(let i=0;i<200;i++){if(await evaluate(`Boolean(${expression})`))return;await tick();}throw Error(`Timed out: ${expression}`);};
  const rows=()=>evaluate(`[...document.querySelectorAll('[data-row-order-zone="matrix"]')].map(e=>({id:e.dataset.rowOrderId,group:e.dataset.rowOrderGroup,manager:e.dataset.rowOrderManager==='true'}))`);
  const saved=()=>evaluate(`JSON.stringify(Object.entries(localStorage).filter(([k])=>k.startsWith('lottery:member-row-order:')))`);
  const clickText=async(text)=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)})?.click()`);
  const handlePoint=async(id)=>evaluate(`(()=>{const row=[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(id)});row.scrollIntoView({block:'center'});const r=row.querySelector('button[aria-label$="の行を並べ替え"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page('Network.enable');await page('Runtime.enable');
  await page('Network.setCookie',{name:'access_token',value:token,url:origin+'/',httpOnly:true,secure:false,sameSite:'Lax'});
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await page('Page.navigate',{url:origin+'/admin/results'});
  await wait(`document.querySelectorAll('[data-row-order-zone="matrix"]').length>10`);
  await tick();
  const original=await rows(),group3=original.filter(r=>r.group==='3:all');
  assert.ok(group3.length>=2);
  const manager=group3.find(r=>r.manager);assert.ok(manager);
  const managerIndex=group3.indexOf(manager),direction=managerIndex===group3.length-1?-1:1;
  const source=manager.id,target=group3[managerIndex+direction].id;
  assert.equal(await evaluate(`[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(source)}).querySelector('button[aria-label$="の行を並べ替え"]').disabled`),false);
  const expected=original.map(r=>r.id),fromIndex=expected.indexOf(source),toIndex=expected.indexOf(target);
  expected.splice(fromIndex,1);expected.splice(toIndex,0,source);
  await evaluate(`[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(source)}).querySelector('button[aria-label$="の行を並べ替え"]').focus()`);
  const arrow=direction===1?'ArrowDown':'ArrowUp';
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:arrow,code:arrow});
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:arrow,code:arrow});
  const expectedExpression=`JSON.stringify([...document.querySelectorAll('[data-row-order-zone="matrix"]')].map(r=>r.dataset.rowOrderId))===${JSON.stringify(JSON.stringify(expected))}`;
  await wait(expectedExpression);
  const keyboardOrder=await rows();assert.notDeepEqual(keyboardOrder,original);
  assert.ok((await saved()).includes(source));
  await page('Page.reload');await wait(expectedExpression);
  assert.deepEqual(await rows(),keyboardOrder);

  // モバイルの実タッチイベント。スクロールの端から離れた2年生2人を移動する。
  const group2=(await rows()).filter(r=>r.group==='2:all');assert.ok(group2.length>=2);
  const touchSource=group2[0].id,touchTarget=group2[1].id;
  const beforeTouch=await saved();
  const to=await handlePoint(touchTarget);
  const from=await evaluate(`(()=>{const r=[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(touchSource)}).querySelector('button[aria-label$="の行を並べ替え"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
  await page('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...to,id:1}]});await tick();
  const animation=await evaluate(`(()=>{const overlay=document.querySelector('[data-row-order-overlay]');const floating=overlay?.firstElementChild;const displaced=document.querySelector('[data-row-order-displaced="true"]');return{floating:!!floating,shadow:!!floating&&getComputedStyle(floating).boxShadow!=='none',following:!!floating&&Math.abs(new DOMMatrix(getComputedStyle(floating).transform).m42)>1,sourceHidden:[...document.querySelectorAll('[data-row-order-dragging="true"]')].some(r=>getComputedStyle(r).opacity==='0'),neighborsMoving:!!displaced&&getComputedStyle(displaced).transitionProperty.includes('transform')}})()`);
  assert.deepEqual(animation,{floating:true,shadow:true,following:true,sourceHidden:true,neighborsMoving:true});
  if(process.env.ROW_ORDER_SCREENSHOT){
    const screenshot=await page('Page.captureScreenshot',{format:'png'});
    await writeFile(process.env.ROW_ORDER_SCREENSHOT,Buffer.from(screenshot.data,'base64'));
  }
  assert.equal(await saved(),beforeTouch); // プレビュー中は保存しない
  await page('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await wait(`document.querySelector('[data-row-order-group="2:all"]').dataset.rowOrderId===${JSON.stringify(touchTarget)}`);
  const touchOrder=await rows();

  // Escapeによるキャンセルは、移動プレビューと浮遊行を戻して保存しない。
  const beforeCancel=await saved();
  const cancelTo=await handlePoint(touchSource);
  const cancelFrom=await evaluate(`(()=>{const r=[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(touchTarget)}).querySelector('button[aria-label$="の行を並べ替え"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page('Input.dispatchMouseEvent',{type:'mousePressed',...cancelFrom,button:'left',buttons:1,clickCount:1});
  await page('Input.dispatchMouseEvent',{type:'mouseMoved',...cancelTo,buttons:1});
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',...cancelTo,button:'left',buttons:0,clickCount:1});
  await wait(`!document.querySelector('[data-row-order-overlay]')`);
  assert.equal(await saved(),beforeCancel);assert.deepEqual(await rows(),touchOrder);

  // 他学年へのマウスドロップは保存されない。
  const beforeInvalid=await saved();
  const invalidFrom=await handlePoint(touchTarget);
  await page('Input.dispatchMouseEvent',{type:'mousePressed',...invalidFrom,button:'left',buttons:1,clickCount:1});
  const invalidTo=await handlePoint(target);
  await page('Input.dispatchMouseEvent',{type:'mouseMoved',...invalidTo,buttons:1});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',...invalidTo,button:'left',buttons:0,clickCount:1});
  await wait(`!document.querySelector('[data-row-order-overlay]')`);
  assert.equal(await saved(),beforeInvalid);assert.deepEqual(await rows(),touchOrder);

  // 動きの低減では変形を即時反映し、タッチキャンセルは保存しない。
  await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reducedTo=await handlePoint(touchSource);
  const reducedFrom=await evaluate(`(()=>{const r=[...document.querySelectorAll('[data-row-order-zone="matrix"]')].find(r=>r.dataset.rowOrderId===${JSON.stringify(touchTarget)}).querySelector('button[aria-label$="の行を並べ替え"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...reducedFrom,id:2}]});
  await page('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...reducedTo,id:2}]});
  assert.equal(await evaluate(`(()=>{const shifted=document.querySelector('[data-row-order-displaced="true"]');const floating=document.querySelector('[data-row-order-overlay]')?.firstElementChild;return !!shifted&&getComputedStyle(shifted).transitionDuration==='0s'&&floating?.style.scale==='1'})()`),true);
  await page('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await wait(`!document.querySelector('[data-row-order-overlay]')`);
  assert.equal(await saved(),beforeInvalid);assert.deepEqual(await rows(),touchOrder);
  assert.equal(await evaluate(`document.querySelectorAll('[data-row-order-displaced],[data-row-order-dragging]').length`),0);
  await page('Emulation.setEmulatedMedia',{features:[]});

  // 混在一覧だけの保存なので、メンバー別・参加表の順序は変更しない。
  await clickText('メンバー別');
  await wait(`document.querySelector('[data-row-order-zone="members"]')`);
  const memberOrder=await evaluate(`[...document.querySelectorAll('[data-row-order-zone="members"]')].map(e=>({id:e.dataset.rowOrderId,group:e.dataset.rowOrderGroup}))`);
  assert.deepEqual(memberOrder.map(r=>r.id),original.map(r=>r.id));
  await page('Page.navigate',{url:origin+'/'});
  await wait(`[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='練習参加表')`);
  await clickText('練習参加表');
  await wait(`document.querySelector('[data-row-order-id]')`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.replace(/\s/g,'').startsWith('2年'))?.click()`);
  await wait(`document.querySelector('[data-row-order-zone="participation:2"]')`);
  const tableOrder=await evaluate(`[...document.querySelectorAll('[data-row-order-zone="participation:2"]')].map(e=>e.dataset.rowOrderId)`);
  assert.deepEqual(tableOrder,original.filter(r=>r.group==='2:all'&&!r.manager).map(r=>r.id));
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  assert.deepEqual(writes,[]);assert.deepEqual(exceptions,[]);
  console.log(JSON.stringify({passed:true,managerMovesWithPlayers:true,keyboard:true,touch:true,reload:true,floatingRow:true,animatedNeighbors:true,cancelRestores:true,reducedMotion:true,touchCancelRestores:true,crossGradeBlocked:true,otherViewsUnchanged:true,apiWrites:writes.length,mobileWidth:390}));
}finally{ws?.close();chrome.kill();}
