// Bounded Myers diff. Preview only: adoption and revision checks stay in the caller.
export function inlineDiff(before, after, { maxDistance = 256, maxWork = 300000 } = {}) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
    const split = text => Array.from(segmenter.segment(text), x => x.segment);
    const a = split(before), b = split(after);
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
    const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end);
    const parts = [];
    const append = (type, text) => { if (!text) return; const last = parts.at(-1); if (last?.type === type) last.text += text; else parts.push({ type, text }); };
    append('equal', a.slice(0, start).join(''));
    let simplified = false;
    if (!left.length || !right.length) {
        append('delete', left.join('')); append('insert', right.join(''));
    } else {
        const frontier = new Map([[1, 0]]), trace = [];
        let work = 0, found = false;
        search: for (let distance = 0; distance <= Math.min(maxDistance, left.length + right.length); distance++) {
            trace.push(new Map(frontier));
            for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
                if (++work > maxWork) break search;
                const down = frontier.get(diagonal + 1) ?? -Infinity, across = frontier.get(diagonal - 1) ?? -Infinity;
                let x = diagonal === -distance || (diagonal !== distance && across < down) ? down : across + 1;
                let y = x - diagonal;
                while (x < left.length && y < right.length && left[x] === right[y]) { x++; y++; if (++work > maxWork) break search; }
                frontier.set(diagonal, x);
                if (x >= left.length && y >= right.length) { found = true; break search; }
            }
        }
        if (found) {
            let x = left.length, y = right.length;
            const edits = [];
            for (let distance = trace.length - 1; distance >= 0; distance--) {
                const previous = trace[distance], diagonal = x - y;
                const previousDiagonal = diagonal === -distance || (diagonal !== distance && (previous.get(diagonal - 1) ?? -Infinity) < (previous.get(diagonal + 1) ?? -Infinity)) ? diagonal + 1 : diagonal - 1;
                const previousX = previous.get(previousDiagonal) ?? 0, previousY = previousX - previousDiagonal;
                while (x > previousX && y > previousY) { edits.push({ type: 'equal', text: left[--x] }); y--; }
                if (distance === 0) break;
                if (x === previousX) edits.push({ type: 'insert', text: right[--y] });
                else edits.push({ type: 'delete', text: left[--x] });
            }
            for (const edit of edits.reverse()) append(edit.type, edit.text);
        } else {
            simplified = true; append('delete', left.join('')); append('insert', right.join(''));
        }
    }
    append('equal', end ? a.slice(-end).join('') : '');
    return { parts, simplified };
}
