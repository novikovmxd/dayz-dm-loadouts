// Round-trip test: parse profiles/DMMode/loadouts.json, re-serialize, diff.
import { readFileSync } from 'node:fs';

// Duplicate the serializer from app.js (keep in sync)
function ind(n) { return '    '.repeat(n); }
function formatFloat(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isNaN(n)) return '0.0';
    const s = String(n);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
}
function formatInt(v) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return String(Number.isFinite(n) ? Math.trunc(n) : 0);
}
function formatArray(arr, depth) {
    if (!arr || !arr.length) return '[]';
    const pad = ind(depth);
    const inner = arr.map(it => ind(depth + 1) + formatItem(it, depth + 1)).join(',\n');
    return `[\n${inner}\n${pad}]`;
}
function formatItem(item, depth) {
    const pad = ind(depth);
    const pad1 = ind(depth + 1);
    const parts = [
        `${pad1}"type": ${JSON.stringify(item.type ?? '')}`,
        `${pad1}"chance": ${formatInt(item.chance ?? 100)}`,
        `${pad1}"health": ${formatFloat(item.health ?? -1)}`,
        `${pad1}"quantity": ${formatFloat(item.quantity ?? -1)}`,
        `${pad1}"ammoCount": ${formatInt(item.ammoCount ?? -1)}`,
        `${pad1}"choices": ${formatArray(item.choices || [], depth + 1)}`,
        `${pad1}"attachments": ${formatArray(item.attachments || [], depth + 1)}`,
        `${pad1}"cargo": ${formatArray(item.cargo || [], depth + 1)}`
    ];
    return `{\n${parts.join(',\n')}\n${pad}}`;
}
function formatSet(s, depth) {
    const pad = ind(depth);
    const pad1 = ind(depth + 1);
    const parts = [
        `${pad1}"Name": ${JSON.stringify(s.Name ?? '')}`,
        `${pad1}"chance": ${formatInt(s.chance ?? 100)}`,
        `${pad1}"items": ${formatArray(s.items || [], depth + 1)}`
    ];
    return `${pad}{\n${parts.join(',\n')}\n${pad}}`;
}
function serialize(data) {
    const sets = (data.Sets || []).map(s => formatSet(s, 2)).join(',\n');
    return `{\n${ind(1)}"Sets": [\n${sets}\n${ind(1)}]\n}\n`;
}

const original = readFileSync('../../profiles/DMMode/loadouts.json', 'utf-8');
const parsed = JSON.parse(original);
const reserialized = serialize(parsed);

// Normalize trailing whitespace and trailing newline for comparison
const norm = s => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
const a = norm(original);
const b = norm(reserialized);

// Structural equality check — content identical regardless of whitespace
const origParsed = JSON.parse(a);
const ourParsed = JSON.parse(b);
const origStr = JSON.stringify(origParsed);
const ourStr = JSON.stringify(ourParsed);

if (origStr === ourStr) {
    console.log('✓ semantic round-trip OK (content identical)');
    if (a === b) {
        console.log('✓ byte-identical too (' + a.length + ' bytes)');
    } else {
        console.log(`  (whitespace differs: original ${a.length}b, ours ${b.length}b — original has indent inconsistencies, ours normalizes)`);
        // Count line-level diffs
        const la = a.split('\n'), lb = b.split('\n');
        let diffs = 0;
        for (let i = 0; i < Math.max(la.length, lb.length); i++) {
            if (la[i] !== lb[i]) diffs++;
        }
        console.log(`  ${diffs} lines differ in whitespace only`);
    }
} else {
    console.log('✗ semantic round-trip FAILED — content differs!');
    console.log('  original chars:', origStr.length);
    console.log('  ours chars:', ourStr.length);
    process.exit(1);
}
