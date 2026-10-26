'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const modulePromise = import('../desktop/extensions/desktop-writing/inline-diff.mjs');
function originals(parts) { return [parts.filter(p => p.type !== 'insert').map(p => p.text).join(''), parts.filter(p => p.type !== 'delete').map(p => p.text).join('')]; }
test('inline diff preserves exact text, graphemes, whitespace and markup without interpreting it', async () => {
    const { inlineDiff } = await modulePromise;
    for (const [before, after] of [['', ''], ['', '新增'], ['删除', ''], ['风吹过城门。', '雨吹过旧城门。'], ['👩‍💻在\r\n城门', '👩‍💻在\n旧城门'], ['<img src=x onerror=alert(1)>', '<script>正文</script>']]) {
        const diff = inlineDiff(before, after); assert.deepEqual(originals(diff.parts), [before, after]); assert.equal(diff.simplified, false);
    }
    assert.deepEqual(inlineDiff('女药师抬头。', '女药师低头。').parts, [{ type: 'equal', text: '女药师' }, { type: 'delete', text: '抬' }, { type: 'insert', text: '低' }, { type: 'equal', text: '头。' }]);
});
test('inline diff finds minimal edits across repeated Chinese characters', async () => {
    const { inlineDiff } = await modulePromise;
    const words = ['', '甲', '乙', '甲甲', '甲乙', '乙甲', '甲乙甲', '乙甲乙', '乙乙甲乙'];
    for (const a of words) for (const b of words) {
        const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
        for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        const { parts } = inlineDiff(a, b); assert.deepEqual(originals(parts), [a, b]);
        assert.equal(parts.filter(p => p.type !== 'equal').reduce((n, p) => n + p.text.length, 0), a.length + b.length - 2 * dp[a.length][b.length]);
    }
});
test('large unrelated edits fall back without losing text or surrounding context', async () => {
    const { inlineDiff } = await modulePromise;
    const before = '前文。' + '甲'.repeat(120000) + '后文。', after = '前文。' + '乙'.repeat(120000) + '后文。';
    const diff = inlineDiff(before, after); assert.equal(diff.simplified, true); assert.deepEqual(originals(diff.parts), [before, after]);
    assert.deepEqual(diff.parts[0], { type: 'equal', text: '前文。' }); assert.deepEqual(diff.parts.at(-1), { type: 'equal', text: '后文。' });
});
