// _inspect_tablesdb.js — read-only inspector for the TablePlus JSON export.
// Prints per-file: row count, max id, max timestamp, and COLUMN NAMES only.
// Never prints cell values (tokens/secrets/password hashes stay unread).
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'C:/Users/user/Desktop/tables-db';
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();

const TS_COLS = ['created_at', 'date', 'updated_at', 'last_login', 'sent_at', 'used_at', 'expires_at', 'last_sync', 'last_sync_at'];

// Strip BOM, then extract every top-level JSON array (bracket/string aware) and
// concatenate their elements. Handles: single array, empty array, and the
// "[] [ ... ]" concatenated-export case seen in tenants.json.
function parseLoose(text) {
  text = text.replace(/^\uFEFF/, '');
  const arrays = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') { if (depth === 0) start = i; depth++; }
    else if (c === ']') { depth--; if (depth === 0 && start >= 0) { arrays.push(text.slice(start, i + 1)); start = -1; } }
  }
  let out = [];
  for (const a of arrays) {
    const parsed = JSON.parse(a);
    if (Array.isArray(parsed)) out = out.concat(parsed);
  }
  return out;
}

for (const f of files) {
  let arr;
  try {
    arr = parseLoose(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch (e) {
    console.log(f.padEnd(32) + '  PARSE ERROR: ' + e.message);
    continue;
  }
  const keys = arr.length ? Object.keys(arr[0]) : [];
  const maxId = keys.includes('id') ? arr.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) : null;
  const tcol = TS_COLS.find((c) => keys.includes(c));
  const maxT = tcol ? arr.reduce((m, r) => (r[tcol] && (!m || r[tcol] > m) ? r[tcol] : m), null) : null;

  console.log(
    f.padEnd(32) +
    String(arr.length).padStart(5) + ' rows  ' +
    'id≤' + String(maxId ?? '-').padEnd(6) + ' ' +
    (tcol ? `${tcol}≤${String(maxT).slice(0, 19)}` : '').padEnd(30) +
    '| ' + keys.join(',')
  );
}
