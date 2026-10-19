'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {localURL,httpsURL,trustedSender}=require('../desktop/services/security.cjs');
const {safeError}=require('../desktop/services/files.cjs');
test('navigation and IPC origin boundaries exclude lookalike URLs and subframes',()=>{
  const origin='http://127.0.0.1:12345';assert.equal(localURL(origin+'/index',origin),true);
  for(const url of ['http://localhost:12345/','http://127.0.0.1:12346','http://127.0.0.1.evil:12345','file:///C:/secret','javascript:alert(1)','https://127.0.0.1:12345','http://u:p@127.0.0.1:12345'])assert.equal(localURL(url,origin),false);
  assert.equal(httpsURL('https://example.com/path'),true);for(const url of ['http://example.com','file:///tmp/a','https://u:p@example.com','ms-settings:appsfeatures'])assert.equal(httpsURL(url),false);
  const frame={url:'file:///launcher'};const webContents={mainFrame:frame};const window={webContents};
  assert.equal(trustedSender({sender:webContents,senderFrame:frame},window,frame.url),true);
  assert.equal(trustedSender({sender:webContents,senderFrame:{url:frame.url}},window,frame.url),false);
});
test('private values never escape arbitrary exceptions',()=>{
  assert.ok(!safeError(new Error('SECRET private chat')).includes('SECRET'));
  assert.equal(safeError({code:'ENOSPC'}),'磁盘空间不足，请腾出空间后重试。');
});
