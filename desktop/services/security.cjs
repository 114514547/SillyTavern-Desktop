'use strict';
function localURL(value,origin){try{const url=new URL(value);return !!origin && url.origin===origin && !url.username && !url.password && url.protocol==='http:';}catch{return false;}}
function httpsURL(value){try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && url.hostname.includes('.') && value.length<4096;}catch{return false;}}
function trustedSender(event,window,launcher){return event.sender===window?.webContents && event.senderFrame===window.webContents.mainFrame && event.senderFrame.url===launcher;}
module.exports={localURL,httpsURL,trustedSender};
