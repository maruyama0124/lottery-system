// 既存のSVGコンポーネントをそのまま書き出す。AIによる描き直しやスクリーンショットの拡大はしない。
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import sharp from 'sharp';

const app=new URL('../src/app/',import.meta.url);

export async function createAppIconAssets(){
  const source=await readFile(new URL('../src/components/quasar.tsx',import.meta.url),'utf8');
  const exports={};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:createRequire(import.meta.url)});
  const mascot=renderToStaticMarkup(React.createElement(exports.Quasar,{mood:'normal',size:448}));
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f0fbf8"/><g transform="translate(32 32)">${mascot}</g></svg>`);
  const png=async(size,rgba=false)=>{
    const image=sharp(svg).resize(size,size).flatten({background:'#f0fbf8'});
    return (rgba?image.ensureAlpha():image.removeAlpha()).png().toBuffer();
  };
  const sizes=[16,32,48];
  // Next.jsのICOデコーダーは埋め込みPNGにRGBAを要求する。アルファ値は全画素255。
  const images=await Promise.all(sizes.map(size=>png(size,true)));
  const header=Buffer.alloc(6+16*images.length);
  header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
  let offset=header.length;
  images.forEach((image,i)=>{
    const entry=6+i*16;
    header[entry]=sizes[i];header[entry+1]=sizes[i];
    header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
    header.writeUInt32LE(image.length,entry+8);header.writeUInt32LE(offset,entry+12);
    offset+=image.length;
  });
  return {
    'icon.png':await png(512),
    'apple-icon.png':await png(180),
    'favicon.ico':Buffer.concat([header,...images]),
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  for(const [name,image] of Object.entries(await createAppIconAssets())){
    await writeFile(new URL(name,app),image);
    console.log(`Generated ${name} from Quasar(normal)`);
  }
}
