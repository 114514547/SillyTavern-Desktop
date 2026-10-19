'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
const base=path.resolve(__dirname,'../test-results/fixtures');
async function fixture(name='中文 空格'){
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,name+'-'));
  for(const dir of ['src','public','default','node_modules/express','data/default-user/characters','data/second-user/worlds','plugins/example','public/scripts/extensions/third-party/example'])await fs.mkdir(path.join(root,dir),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'sillytavern',version:'1.19.0',type:'module'}));
  await fs.copyFile(path.join(__dirname,'fixtures/server.mjs'),path.join(root,'server.js'));
  await fs.writeFile(path.join(root,'src/command-line.js'),['configPath','dataRoot','browserLaunchEnabled','listen','enableIPv4','enableIPv6','disableCsrf','ssl','port'].map(x=>`.option('${x}',{})`).join('\n'));
  await fs.writeFile(path.join(root,'public/index.html'),'<h1>fixture</h1>');
  await fs.writeFile(path.join(root,'default/config.yaml'),'dataRoot: ./data\nport: 8000\n');
  await fs.copyFile(path.join(root,'default/config.yaml'),path.join(root,'config.yaml'));
  await fs.writeFile(path.join(root,'node_modules/express/package.json'),'{}');
  await fs.writeFile(path.join(root,'data/default-user/characters/角色.png'),'TEST CARD');
  await fs.writeFile(path.join(root,'data/second-user/worlds/世界书.json'),'{}');
  await fs.writeFile(path.join(root,'data/second-user/secrets.json'),'TEST-SECRET-DO-NOT-LOG');
  await fs.writeFile(path.join(root,'plugins/example/index.js'),'// test plugin');
  await fs.writeFile(path.join(root,'public/scripts/extensions/third-party/example/index.js'),'// test extension');
  return root;
}
module.exports={fixture,base};
