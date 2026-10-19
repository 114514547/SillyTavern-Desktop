'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
let count=0;
for(const base of ['desktop','scripts','tests']){
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(cjs|js)$/.test(e.name)){execFileSync(process.execPath,['--check',p],{stdio:'inherit',windowsHide:true});count++;}}}
  walk(path.join(__dirname,'..',base));
}
console.log(`${count} JavaScript files passed syntax checks.`);
