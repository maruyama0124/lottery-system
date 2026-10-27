import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import {createAppIconAssets} from '../scripts/generate-app-icons.mjs';

test('app icons reuse the existing mascot and generated assets are current',async()=>{
  const assets=await createAppIconAssets();
  for(const [name,expected] of Object.entries(assets)){
    assert.deepEqual(await readFile(new URL(`../src/app/${name}`,import.meta.url)),expected,`${name}: run npm run icons:generate`);
  }
  for(const [name,size] of [['icon.png',512],['apple-icon.png',180]]){
    const meta=await sharp(assets[name]).metadata();
    assert.equal(meta.width,size);assert.equal(meta.height,size);assert.equal(meta.hasAlpha,false);
  }
  const ico=assets['favicon.ico'];assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
  for(let i=0;i<3;i++){
    const entry=6+i*16,length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
    const meta=await sharp(ico.subarray(offset,offset+length)).metadata();
    assert.equal(meta.width,[16,32,48][i]);assert.equal(meta.height,meta.width);
    assert.equal(meta.channels,4); // Next.jsのICO画像デコーダーとの互換性
  }
});
