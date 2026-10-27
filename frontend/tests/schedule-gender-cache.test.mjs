import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('gender editing invalidates member schedule cache only after successful save', async()=>{
  const code=ts.transpileModule(readFileSync('src/lib/api-client.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports={};let invalidations=0;let status=204;
  vm.runInNewContext(code,{exports,fetch:async()=>({ok:status<400,status,json:async()=>({error:{message:'競合'}})}),
    require(name){assert.equal(name,'@/lib/member-cache');return{invalidateMemberHomes:()=>invalidations++};},
  });
  await exports.apiClient.get('/v1/practices/p/genders');assert.equal(invalidations,0);
  await exports.apiClient.put('/v1/practices/p/genders',{});assert.equal(invalidations,1);
  status=409;await assert.rejects(exports.apiClient.put('/v1/practices/p/genders',{}));
  assert.equal(invalidations,1);
});
