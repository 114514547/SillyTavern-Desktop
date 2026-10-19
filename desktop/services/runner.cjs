'use strict';
// Runs only in the bundled, separate Node runtime. No Electron APIs here.
const { pathToFileURL } = require('node:url');
let closing=false;
function shutdown(){
  if(closing) return; closing=true;
  // Windows process.kill(SIGTERM) is not graceful. Deliver to upstream JS handlers.
  const handled=process.emit('SIGTERM');
  if(!handled) process.exit(0);
  setTimeout(()=>process.exit(1),7000).unref();
}
process.on('message',m=>{if(m?.type==='shutdown')shutdown();});
process.on('disconnect',shutdown);
const target=process.argv[2];
process.argv=[process.execPath,...process.argv.slice(2)];
if(!target) process.exit(2);
import(pathToFileURL(target).href).catch(error=>{
  const codes={ERR_MODULE_NOT_FOUND:'missing-dependency',MODULE_NOT_FOUND:'missing-dependency',EACCES:'permission-denied',ENOSPC:'disk-full'};
  if(codes[error.code])process.send?.({type:'diagnostic',code:codes[error.code]});
  process.send?.({type:'failed'},()=>process.exit(1));
  setTimeout(()=>process.exit(1),200).unref();
});
