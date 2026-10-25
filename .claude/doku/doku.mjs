#!/usr/bin/env node
// doku — Architektur-Doku als Markdown-Dateien. Null Abhängigkeiten, eine Datei.
// Wird von `doku init` in Projekte kopiert (.claude/doku/doku.mjs) und ist gleichzeitig
// die Bibliothek, die Portal-Server und Viewer-Build verwenden.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
export const SCHEMA = 1;
export const DEFAULT_DOC_DIR = 'docs/doku';

const COMPONENT_FIELDS = new Set(['id', 'name', 'type', 'layer', 'path', 'files', 'tech', 'tags', 'status', 'summary', 'uses', 'provides', 'owner', 'links', 'external', 'zone', 'exposure', 'security']);
const EXPOSURES = new Set(['public', 'internal', 'local', 'none']);
const FLOW_FIELDS = new Set(['id', 'name', 'summary', 'trigger', 'steps', 'actors', 'tags', 'status']);
const DECISION_FIELDS = new Set(['id', 'title', 'date', 'status', 'affects', 'tags', 'summary', 'supersedes']);
const PROJECT_FIELDS = new Set(['id', 'name', 'summary', 'repo', 'repoPath', 'branch', 'url', 'tech', 'status', 'owner', 'layers', 'zones', 'zone', 'security', 'protected', 'tags', 'ignore', 'links']);
const CHANGE_FIELDS = new Set(['id', 'title', 'status', 'date', 'affects', 'risk', 'requested', 'implemented', 'commits', 'tags', 'summary', 'kind']);
const CHANGE_STATUSES = new Set(['draft', 'proposed', 'approved', 'rejected', 'implemented', 'cancelled']);
const GUIDE_FIELDS = new Set(['id', 'title', 'order', 'audience', 'tags', 'summary']);
const STATUSES = new Set(['active', 'planned', 'experimental', 'deprecated', 'removed']);
const DECISION_STATUSES = new Set(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']);
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export const DEFAULT_IGNORE = [
  '**/*.md', '**/*.mdx', '**/*.txt', 'docs/**', '.claude/**', '.github/**', '.vscode/**', '.idea/**',
  '**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/__snapshots__/**',
  '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/*.lock', '**/.gitignore', '**/.gitattributes',
  '**/.editorconfig', '**/.prettierrc*', '**/.eslintrc*', 'LICENSE*', '**/.env.example', '**/*.svg', '**/*.png',
  '**/*.jpg', '**/*.ico', '**/vendor/**', '**/node_modules/**', '**/dist/**', '**/build/**',
];
const MANIFESTS = /(^|\/)(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|Dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/;

// ───────────────────────── Frontmatter (YAML-Teilmenge) ─────────────────────────

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") { if (i === 0 || /\s|\[|,/.test(s[i - 1])) q = c; }
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

export function unquote(s) {
  s = String(s).trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') return s.slice(1, -1).replace(/\\(["\\nt])/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitInlineList(s) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++i] ?? ''; } else if (c === q) q = null; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => unquote(x.trim())).filter((x) => x !== '');
}

/** Parst `---`-Frontmatter. Unterstützt: key: wert, key: [a, b], key: + "- item"-Listen, key: | Blocktext. */
export function parseFrontmatter(text) {
  text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { data: {}, body: text.trim(), errors: [], bodyLine: 1 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) { end = i; break; }
  if (end < 0) return { data: {}, body: '', errors: [{ line: 1, msg: 'Frontmatter wird nicht mit --- geschlossen' }], bodyLine: 1 };
  const { data, errors } = parseYamlSubset(lines.slice(1, end), 1);
  return { data, body: lines.slice(end + 1).join('\n').trim(), errors, bodyLine: end + 2 };
}

function parseYamlSubset(lines, offset = 0) {
  const data = {}; const errors = [];
  let i = 0;
  const lineNo = (k) => offset + k + 1;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) { i++; continue; }
    if (/^\s/.test(raw)) { errors.push({ line: lineNo(i), msg: `Unerwartete Einrückung: "${raw.trim()}"` }); i++; continue; }
    const m = raw.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (!m) { errors.push({ line: lineNo(i), msg: `Erwartet "schlüssel: wert", gefunden: "${raw.trim()}"` }); i++; continue; }
    const key = m[1];
    if (Object.hasOwn(data, key)) errors.push({ line: lineNo(i), msg: `Schlüssel "${key}" doppelt` });
    const rest = stripComment(m[2]).trim();
    if (/^[|>][-+]?$/.test(rest)) {
      const block = []; i++;
      while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) block.push(lines[i++]);
      while (block.length && !block.at(-1).trim()) block.pop();
      const ind = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), 1e9);
      const txt = block.map((l) => l.slice(Math.min(ind, l.length)));
      data[key] = rest[0] === '|' ? txt.join('\n') : txt.join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }
    if (rest === '') {
      const items = []; i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim() || l.trim().startsWith('#')) { i++; continue; }
        const lm = l.match(/^\s*-(?:\s+(.*))?$/);
        if (lm) { items.push(unquote(stripComment(lm[1] ?? '').trim())); i++; continue; }
        if (/^\s/.test(l)) {
          errors.push({ line: lineNo(i), msg: `Verschachtelte Strukturen werden nicht unterstützt (Schlüssel "${key}"). Nutze einzeilige Einträge wie "- ziel: protokoll beschreibung".` });
          i++; continue;
        }
        break;
      }
      data[key] = items.length ? items : '';
      continue;
    }
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) errors.push({ line: lineNo(i), msg: `Liste bei "${key}" nicht mit ] geschlossen` });
      data[key] = splitInlineList(rest.replace(/^\[/, '').replace(/\]$/, ''));
    } else data[key] = unquote(rest);
    i++;
  }
  return { data, errors };
}

const asList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v.map(String).filter(Boolean) : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const asItems = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v.map(String).filter(Boolean) : [String(v)]);
const asStr = (v) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));

// ───────────────────────── Einträge parsen ─────────────────────────

/** "ziel: protokoll beschreibung" | "projekt:ziel: protokoll ..." | "ziel" */
/** "[tls, auth=api-key, port=443, intern]" → { tls, auth, port, notes } */
export function parseSec(text) {
  const sec = { tls: undefined, auth: undefined, port: undefined, notes: [] };
  for (const raw of String(text).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^([\w-]+)\s*[=:]\s*(.+)$/);
    const k = (m ? m[1] : raw).toLowerCase(); const v = m ? unquote(m[2].trim()) : '';
    if (['tls', 'https', 'ssl', 'encrypted', 'verschluesselt', 'verschlüsselt'].includes(k)) sec.tls = v ? !/^(no|nein|false|0)$/i.test(v) : true;
    else if (k === 'mtls') { sec.tls = true; sec.auth = 'mTLS'; }
    else if (['plain', 'unencrypted', 'notls', 'unverschluesselt', 'unverschlüsselt', 'klartext'].includes(k)) sec.tls = false;
    else if (k === 'auth') sec.auth = v || 'ja';
    else if (k === 'noauth' || k === 'anonym' || k === 'public') sec.auth = 'none';
    else if (k === 'port') sec.port = v;
    else sec.notes.push(m ? `${m[1]}: ${v}` : raw);
  }
  if (sec.auth && /^(none|keine|nein|no|false)$/i.test(sec.auth)) sec.auth = 'none';
  return sec;
}

export function parseUse(str) {
  let s = String(str).trim();
  let sec = null;
  const sm = s.match(/\s\[([^\]]*)\]\s*$/);
  if (sm) { sec = parseSec(sm[1]); s = s.slice(0, sm.index).trim(); }
  const idx = s.search(/:\s/);
  let target; let rest = '';
  if (idx === -1) target = s.replace(/:$/, '');
  else { target = s.slice(0, idx).trim(); rest = s.slice(idx + 1).trim(); }
  let protocol = ''; let label = '';
  if (rest) { const m = rest.match(/^(\S+)\s*(.*)$/); protocol = m[1].toLowerCase(); label = unquote(m[2].trim()); }
  const ref = parseRef(target);
  return { target: ref.id, project: ref.project, protocol, label, raw: String(str).trim(), ...(sec ? { sec } : {}) };
}

/** "pfad: Erklärung" (Pfad relativ zum Repo oder zum Komponenten-Ordner) */
export function parseFileNote(str) {
  const s = String(str).trim();
  const i = s.search(/:(\s|$)/);
  return i < 0 ? { path: s, note: '' } : { path: s.slice(0, i).trim().replace(/^\.\//, ''), note: unquote(s.slice(i + 1).trim()) };
}

/** Sicherheitsmaßnahme "kategorie: text" (z. B. "auth: Passkey") */
export function parseMeasure(str) {
  const f = parseFileNote(str);
  return f.note ? { kind: f.path.toLowerCase(), text: f.note } : { kind: 'other', text: f.path };
}

export function parseRef(s) {
  s = String(s).trim();
  const ci = s.indexOf(':');
  return ci > 0 ? { project: s.slice(0, ci), id: s.slice(ci + 1) } : { project: null, id: s };
}

export function parseProvide(str) {
  const s = String(str).trim();
  const m = s.match(/^(\S+)\s+(.+)$/);
  return m && /^[a-z][\w.+-]*$/i.test(m[1]) && m[1].length <= 12 ? { kind: m[1].toLowerCase(), text: m[2], raw: s } : { kind: '', text: s, raw: s };
}

/** Flow-Schritt: "a -> b: text" (Aufruf), "a --> b: text" (Antwort), "a ->> b: text" (asynchron), "note a: text", sonst Abschnitt. */
export function parseStep(str) {
  const s = String(str).trim();
  const note = s.match(/^note\s+(.+?)\s*:(?:\s+(.*))?$/i);
  if (note) return { kind: 'note', over: note[1].split(',').map((x) => x.trim()).filter(Boolean), label: unquote(note[2] ?? '') };
  const m = s.match(/^(.+?)\s*(-->>|-->|->>|->)\s*(.+?)(?::(?:\s+(.*))?)?$/);
  if (m) {
    const kind = m[2] === '->' ? 'call' : m[2] === '-->' ? 'return' : 'async';
    return { kind, from: m[1].trim(), to: m[3].trim(), label: unquote(m[4] ?? '') };
  }
  return { kind: 'section', label: unquote(s.replace(/^=+\s*|\s*=+$/g, '')) };
}

function firstSentence(md) {
  const t = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/^#+\s.*$/gm, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/^\s*[>|-]\s*/gm, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const ABBR = /(?:^|[\s(])(?:z\.\s?B|d\.\s?h|u\.\s?a|bzw|ca|vgl|ggf|usw|etc|inkl|evtl|bspw|sog|Nr|Abs|max|min|ggü|e\.g|i\.e|vs|Dr|Hr|Fr|St)\.$/i;
  let s = t;
  const re = /[.!?](?=\s|$)/g; let mm;
  while ((mm = re.exec(t))) {
    const head = t.slice(0, mm.index + 1);
    if (mm[0] === '.' && (ABBR.test(head) || /(?:^|\s)\w\.$/.test(head) || /\d\.$/.test(head))) continue;
    s = head; break;
  }
  return s.length > 180 ? s.slice(0, 177).trimEnd() + '…' : s;
}

const slug = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
const titleCase = (id) => String(id).split(/[-_.]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// ───────────────────────── Dateien & Muster ─────────────────────────

function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

const fileListCache = new Map();
export function listFiles(root) {
  if (fileListCache.has(root)) return fileListCache.get(root);
  const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  let files = out != null ? out.split('\0').filter(Boolean) : walk(root);
  files = files.filter((f) => fs.existsSync(path.join(root, f)));
  fileListCache.set(root, files);
  return files;
}

export function compilePattern(p) {
  const pat = String(p).trim().replace(/^\.\//, '').replace(/^\//, '');
  if (/[*?]/.test(pat)) {
    let re = '';
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '*' && pat[i + 1] === '*') { if (pat[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; } }
      else if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    const rx = new RegExp(`^${re}$`);
    return { pattern: pat, weight: pat.replace(/[*?].*$/, '').length, test: (f) => rx.test(f) };
  }
  const dir = pat.replace(/\/+$/, '');
  if (dir === '' || dir === '.') return { pattern: pat, weight: 0, test: () => true };
  return { pattern: pat, weight: dir.length + 1, test: (f) => f === dir || f.startsWith(dir + '/') };
}

function matchesAny(file, patterns) { return patterns.some((p) => p.test(file)); }

// ───────────────────────── Projekt laden ─────────────────────────

/** Findet das Projekt-Root (Ordner mit docs/doku) ab `start` aufwärts. */
export function findRoot(start = process.cwd(), docDir = DEFAULT_DOC_DIR) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, docDir))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Liest docs/doku eines Projekts, validiert und liefert das Projektmodell (JSON-fähig). */
export function loadProject(root, opts = {}) {
  root = path.resolve(root);
  fileListCache.delete(root);
  const docDir = opts.docDir || DEFAULT_DOC_DIR;
  const abs = path.join(root, docDir);
  const issues = [];
  const issue = (level, file, msg, line, code = 'general') => issues.push({ level, file, line: line || undefined, msg, code });
  const docFiles = fs.existsSync(abs) ? walk(abs).filter((f) => f.endsWith('.md')).sort() : [];
  if (!fs.existsSync(abs)) issue('error', docDir, `Doku-Ordner ${docDir} fehlt (doku init ausführen)`, 0, 'no-docs');

  const read = (rel) => {
    const fileRel = `${docDir}/${rel}`;
    const fm = parseFrontmatter(fs.readFileSync(path.join(abs, rel), 'utf8'));
    for (const e of fm.errors) issue('error', fileRel, e.msg, e.line, 'parse');
    return { ...fm, file: fileRel };
  };
  const checkFields = (doc, known) => {
    for (const k of Object.keys(doc.data)) if (!known.has(k)) issue('warn', doc.file, `Unbekanntes Feld "${k}" (erlaubt: ${[...known].join(', ')})`, 0, 'unknown-field');
  };

  // Projekt
  let pdata = {}; let pbody = ''; let pfile = null;
  if (docFiles.includes('project.md')) {
    const d = read('project.md'); checkFields(d, PROJECT_FIELDS); pdata = d.data; pbody = d.body; pfile = d.file;
  } else if (docFiles.length) issue('warn', `${docDir}/project.md`, 'project.md fehlt (Projektname, Beschreibung, Repo)', 0, 'no-project');

  const layerKeys = []; const layerLabels = {};
  for (const l of asList(pdata.layers)) {
    const i = l.indexOf(':');
    const key = (i > 0 ? l.slice(0, i) : l).trim().toLowerCase();
    if (!key) continue;
    layerKeys.push(key);
    if (i > 0 && l.slice(i + 1).trim()) layerLabels[key] = unquote(l.slice(i + 1).trim());
  }
  const zoneKeys = []; const zoneLabels = {};
  for (const z of asList(pdata.zones)) {
    const i = z.indexOf(':');
    const key = (i > 0 ? z.slice(0, i) : z).trim().toLowerCase();
    if (!key) continue;
    zoneKeys.push(key);
    if (i > 0 && z.slice(i + 1).trim()) zoneLabels[key] = unquote(z.slice(i + 1).trim());
  }
  const gitInfo = opts.git === false ? null : readGitInfo(root);
  const id = slug(asStr(pdata.id) || path.basename(root));
  const project = {
    schema: SCHEMA, generator: `doku ${VERSION}`, generatedAt: new Date().toISOString(),
    id, name: asStr(pdata.name) || titleCase(id), summary: asStr(pdata.summary) || firstSentence(pbody), body: pbody,
    repo: normalizeRepo(asStr(pdata.repo)) || gitInfo?.repo || '', repoPath: asStr(pdata.repoPath) || gitInfo?.prefix || '',
    branch: asStr(pdata.branch) || gitInfo?.branch || '', url: asStr(pdata.url), tech: asList(pdata.tech),
    status: asStr(pdata.status) || 'active', owner: asStr(pdata.owner), layers: layerKeys, layerLabels, zones: zoneKeys, zoneLabels, zone: asStr(pdata.zone).toLowerCase(),
    security: asItems(pdata.security).map(parseMeasure), protected: asList(pdata.protected), tags: asList(pdata.tags),
    links: asItems(pdata.links), docDir, file: pfile, git: gitInfo ? { commit: gitInfo.commit, date: gitInfo.date, dirty: gitInfo.dirty } : null,
    components: [], flows: [], decisions: [], changes: [], guides: [], issues,
  };
  const ignoreExtra = asList(pdata.ignore);

  // Komponenten
  const seen = new Map();
  const claim = (kind, cid, file) => {
    const key = `${kind}:${cid.toLowerCase()}`;
    if (seen.has(key)) issue('error', file, `${kind}-ID "${cid}" doppelt (auch in ${seen.get(key)})`, 0, 'dup-id');
    else seen.set(key, file);
  };
  for (const rel of docFiles.filter((f) => f.startsWith('components/'))) {
    const d = read(rel); checkFields(d, COMPONENT_FIELDS);
    const parts = rel.split('/');
    const group = parts.slice(1, -1).join('/');
    const cid = asStr(d.data.id) || path.basename(rel, '.md');
    if (!ID_RE.test(cid)) issue('error', d.file, `Ungültige ID "${cid}" (erlaubt: a-z 0-9 . _ -)`, 0, 'bad-id');
    claim('Komponente', cid, d.file);
    const status = asStr(d.data.status) || 'active';
    if (!STATUSES.has(status)) issue('warn', d.file, `Status "${status}" unbekannt (${[...STATUSES].join(', ')})`, 0, 'bad-status');
    const comp = {
      id: cid, name: asStr(d.data.name) || titleCase(cid), type: (asStr(d.data.type) || 'module').toLowerCase(),
      layer: (asStr(d.data.layer) || parts[1 + (parts.length > 2 ? 0 : 99)] || 'other').toLowerCase(),
      group, path: asList(d.data.path), tech: asList(d.data.tech), tags: asList(d.data.tags), status,
      owner: asStr(d.data.owner), external: /^(true|yes|ja)$/i.test(asStr(d.data.external)) || asStr(d.data.type).toLowerCase() === 'external',
      summary: asStr(d.data.summary) || firstSentence(d.body), body: d.body,
      uses: asItems(d.data.uses).map(parseUse), provides: asItems(d.data.provides).map(parseProvide), links: asItems(d.data.links),
      files: asItems(d.data.files).map(parseFileNote),
      zone: asStr(d.data.zone).toLowerCase(), exposure: asStr(d.data.exposure).toLowerCase(),
      security: asItems(d.data.security).map(parseMeasure),
      file: d.file,
    };
    if (!d.data.layer && parts.length <= 2) comp.layer = comp.external ? 'external' : 'other';
    if (comp.exposure && !EXPOSURES.has(comp.exposure)) issue('warn', d.file, `exposure "${comp.exposure}" unbekannt (${[...EXPOSURES].join(', ')})`, 0, 'bad-exposure');
    if (!comp.summary) issue('warn', d.file, 'Keine Beschreibung (summary oder Text)', 0, 'no-summary');
    project.components.push(comp);
  }
  const compIds = new Map(project.components.map((c) => [c.id.toLowerCase(), c]));

  // Flows
  for (const rel of docFiles.filter((f) => f.startsWith('flows/'))) {
    const d = read(rel); checkFields(d, FLOW_FIELDS);
    const fid = asStr(d.data.id) || path.basename(rel, '.md');
    claim('Flow', fid, d.file);
    const steps = asItems(d.data.steps).map(parseStep);
    const participants = [];
    const add = (p) => { if (p && !participants.includes(p)) participants.push(p); };
    for (const s of steps) { if (s.from) { add(s.from); add(s.to); } if (s.over) s.over.forEach(add); }
    if (!steps.length && !/```mermaid/.test(d.body)) issue('warn', d.file, 'Flow ohne steps', 0, 'no-steps');
    for (const st of steps) if (st.kind === 'section' && /[-=]>|<-|->/.test(st.label)) issue('warn', d.file, `Schritt nicht erkannt: "${st.label}" (erlaubt: a -> b, a --> b, a ->> b, a -->> b, note a: text)`, 0, 'bad-step');
    project.flows.push({
      id: fid, name: asStr(d.data.name) || titleCase(fid), summary: asStr(d.data.summary) || firstSentence(d.body),
      trigger: asStr(d.data.trigger), tags: asList(d.data.tags), status: asStr(d.data.status) || 'active',
      steps, participants, actors: asList(d.data.actors), body: d.body, file: d.file,
    });
  }

  // Entscheidungen
  for (const rel of docFiles.filter((f) => f.startsWith('decisions/'))) {
    const d = read(rel); checkFields(d, DECISION_FIELDS);
    const did = asStr(d.data.id) || path.basename(rel, '.md');
    claim('Entscheidung', did, d.file);
    const status = asStr(d.data.status) || 'accepted';
    if (!DECISION_STATUSES.has(status)) issue('warn', d.file, `Status "${status}" unbekannt (${[...DECISION_STATUSES].join(', ')})`, 0, 'bad-status');
    const title = asStr(d.data.title) || (d.body.match(/^#\s+(.+)$/m)?.[1] ?? titleCase(did.replace(/^\d+-/, '')));
    project.decisions.push({
      id: did, title, date: asStr(d.data.date), status, affects: asList(d.data.affects).map((a) => a.trim()),
      tags: asList(d.data.tags), supersedes: asStr(d.data.supersedes), summary: asStr(d.data.summary) || firstSentence(d.body.replace(/^#\s+.+$/m, '')),
      body: d.body, file: d.file,
    });
  }
  // Änderungen (Anträge + Changelog)
  for (const rel of docFiles.filter((f) => f.startsWith('changes/'))) {
    const d = read(rel); checkFields(d, CHANGE_FIELDS);
    const cid = asStr(d.data.id) || path.basename(rel, '.md');
    claim('Änderung', cid, d.file);
    const status = asStr(d.data.status) || 'draft';
    if (!CHANGE_STATUSES.has(status)) issue('warn', d.file, `Status "${status}" unbekannt (${[...CHANGE_STATUSES].join(', ')})`, 0, 'bad-status');
    const title = asStr(d.data.title) || (d.body.match(/^#\s+(.+)$/m)?.[1] ?? titleCase(cid.replace(/^\d+-/, '')));
    const ch = { id: cid, title, status, kind: asStr(d.data.kind) || 'change', date: asStr(d.data.date), implemented: asStr(d.data.implemented), risk: asStr(d.data.risk),
      requested: asStr(d.data.requested), affects: asList(d.data.affects), commits: asList(d.data.commits), tags: asList(d.data.tags),
      summary: asStr(d.data.summary) || firstSentence(d.body.replace(/^#\s+.+$/m, '')), body: d.body, file: d.file };
    ch.hash = changeHash(ch);
    project.changes.push(ch);
  }
  // Anleitungen
  for (const rel of docFiles.filter((f) => f.startsWith('guides/'))) {
    const d = read(rel); checkFields(d, GUIDE_FIELDS);
    const gid = asStr(d.data.id) || path.basename(rel, '.md').replace(/^\d+-/, '');
    claim('Anleitung', gid, d.file);
    const title = asStr(d.data.title) || (d.body.match(/^#\s+(.+)$/m)?.[1] ?? titleCase(gid));
    project.guides.push({ id: gid, title, order: Number(asStr(d.data.order)) || 100, audience: asStr(d.data.audience), tags: asList(d.data.tags),
      summary: asStr(d.data.summary) || firstSentence(d.body.replace(/^#\s+.+$/m, '')), body: d.body, file: d.file });
  }
  project.guides.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'de'));
  project.changes.sort((a, b) => b.id.localeCompare(a.id));
  for (const rel of docFiles) {
    if (rel === 'project.md' || rel === 'README.md' || /^(components|flows|decisions|changes|guides)\//.test(rel)) continue;
    issue('warn', `${docDir}/${rel}`, 'Datei liegt außerhalb von components/, flows/, decisions/ und wird ignoriert', 0, 'stray');
  }

  // Referenzen prüfen
  const files = opts.checkPaths === false ? null : listFiles(root);
  for (const c of project.components) {
    for (const u of c.uses) {
      if (!u.target) issue('error', c.file, `uses: leerer Eintrag "${u.raw}"`, 0, 'bad-use');
      else if (!u.project || u.project === project.id) {
        u.project = null;
        if (!compIds.has(u.target.toLowerCase())) issue('error', c.file, `uses: Ziel "${u.target}" existiert nicht${suggest(u.target, compIds)}`, 0, 'unknown-target');
        else u.target = compIds.get(u.target.toLowerCase()).id;
      }
    }
    if (files) {
      for (const p of c.path) {
        const pat = compilePattern(p);
        if (!files.some(pat.test)) issue('error', c.file, `path "${p}" existiert nicht (mehr)`, 0, 'missing-path');
      }
    }
  }
  if (files) {
    const fileSet = new Set(files);
    const dirSet = new Set();
    for (const f of files) { let i = f.lastIndexOf('/'); while (i > 0) { dirSet.add(f.slice(0, i)); i = f.lastIndexOf('/', i - 1); } }
    for (const c of project.components) {
      const bases = c.path.map((p) => {
        const pat = String(p).replace(/^\.\//, '');
        if (/[*?]/.test(pat)) return pat.replace(/[*?].*$/, '').replace(/[^/]*$/, '');
        if (fileSet.has(pat)) return pat.includes('/') ? pat.replace(/[^/]*$/, '') : '';
        return pat.replace(/\/*$/, '/');
      });
      for (const fn of c.files) {
        const rel = fn.path.replace(/\/+$/, '');
        const hit = [rel, ...bases.map((b) => b + rel)].find((x) => fileSet.has(x) || dirSet.has(x));
        if (hit) { fn.path = hit; fn.dir = dirSet.has(hit) && !fileSet.has(hit); }
        else issue('warn', c.file, `files: "${fn.path}" existiert nicht`, 0, 'missing-file');
      }
    }
  }
  const anyIds = new Map([...compIds]);
  for (const f of project.flows) anyIds.set(f.id.toLowerCase(), f);
  for (const d of project.decisions) anyIds.set(d.id.toLowerCase(), d);
  for (const g of project.guides) anyIds.set(g.id.toLowerCase(), g);
  for (const ch of project.changes) anyIds.set(ch.id.toLowerCase(), ch);
  for (const ch of project.changes) for (const a of ch.affects) {
    if (/^(layer|zone):/.test(a) || /[/*]/.test(a)) continue;
    const r = parseRef(a);
    if ((!r.project || r.project === project.id) && !compIds.has(r.id.toLowerCase())) issue('error', ch.file, `affects: "${a}" ist keine Komponente${suggest(r.id, compIds)} (erlaubt: Komponenten-ID, layer:x, zone:x, Pfad)`, 0, 'unknown-affects');
  }
  for (const pr of project.protected) {
    if (/^(layer|zone):/.test(pr) || /[/*]/.test(pr)) continue;
    if (!compIds.has(pr.toLowerCase())) issue('error', pfile || docDir, `protected: "${pr}" ist keine Komponente${suggest(pr, compIds)}`, 0, 'unknown-protected');
  }
  for (const d of project.decisions) {
    d.affects = d.affects.map((a) => {
      const r = parseRef(a);
      if (r.project && r.project !== project.id) return a;
      const hit = anyIds.get(r.id.toLowerCase());
      if (!hit) issue('error', d.file, `affects: "${a}" existiert nicht${suggest(r.id, anyIds)}`, 0, 'unknown-affects');
      return hit ? hit.id : r.id;
    });
  }
  for (const f of project.flows) {
    for (const part of f.participants) {
      const r = parseRef(part);
      if (r.project && r.project !== project.id) continue;
      if (compIds.has(part.toLowerCase()) || f.actors.includes(part)) continue;
      if (/[-._]/.test(part)) issue('warn', f.file, `Teilnehmer "${part}" ist keine Komponente${suggest(part, compIds)} – wird als Akteur gezeigt (sonst in actors: aufnehmen)`, 0, 'unknown-participant');
    }
  }
  const allDocs = [{ body: project.body, file: pfile }, ...project.components, ...project.flows, ...project.decisions];
  for (const d of allDocs) {
    for (const m of String(d.body || '').replace(/```[\s\S]*?```|`[^`\n]*`/g, '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      const r = parseRef(m[1]);
      if ((!r.project || r.project === project.id) && !anyIds.has(r.id.trim().toLowerCase())) issue('warn', d.file, `Link [[${m[1]}]] zeigt ins Leere`, 0, 'dead-link');
    }
  }

  project.ignore = [...DEFAULT_IGNORE, ...ignoreExtra, `${docDir}/**`];
  if (opts.code) { project.code = analyzeCode(root, project); project.history = readHistory(root, project); }
  project.stats = {
    components: project.components.length, flows: project.flows.length, decisions: project.decisions.length, changes: project.changes.length, guides: project.guides.length,
    edges: project.components.reduce((n, c) => n + c.uses.length, 0),
    errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warn').length,
  };
  return project;
}

function suggest(id, map) {
  const lc = id.toLowerCase();
  let best = null; let bestD = 3;
  for (const k of map.keys()) { const d = lev(lc, k); if (d < bestD) { bestD = d; best = map.get(k).id; } }
  return best ? ` (meintest du "${best}"?)` : '';
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}

export function normalizeRepo(url) {
  if (!url) return '';
  let u = url.trim().replace(/\.git$/, '');
  const ssh = u.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol) || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(p.hostname)) return '';
    return `https://${p.host}${p.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

function readGitInfo(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top == null) return null;
  const commit = (git(root, ['rev-parse', 'HEAD']) || '').trim();
  return {
    commit: commit || null,
    branch: (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim().replace(/^HEAD$/, ''),
    date: commit ? (git(root, ['log', '-1', '--format=%cI']) || '').trim() : null,
    dirty: Boolean((git(root, ['status', '--porcelain', '--', '.']) || '').trim()),
    prefix: (git(root, ['rev-parse', '--show-prefix']) || '').trim(),
    repo: normalizeRepo((git(root, ['remote', 'get-url', 'origin']) || '').trim()),
  };
}

// ───────────────────────── Abdeckung & Änderungen ─────────────────────────

export function ownerOf(project, file) {
  let best = null; let bestW = -1;
  for (const c of project.components) {
    for (const p of c.path) {
      const pat = compilePattern(p);
      if (pat.test(file) && pat.weight > bestW) { best = c; bestW = pat.weight; }
    }
  }
  return best;
}

export function coverage(project, root) {
  const ign = project.ignore.map(compilePattern);
  const files = listFiles(root).filter((f) => !matchesAny(f, ign) && !MANIFESTS.test(f));
  const uncovered = files.filter((f) => !ownerOf(project, f));
  return { total: files.length, covered: files.length - uncovered.length, uncovered };
}

function statePath(root) {
  const gd = git(root, ['rev-parse', '--absolute-git-dir']);
  return gd ? path.join(gd.trim(), 'doku-state.json') : null;
}
function readState(root) {
  const p = statePath(root);
  try { return p ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}; } catch { return {}; }
}
function writeState(root, st) {
  const p = statePath(root);
  if (p) try { fs.writeFileSync(p, JSON.stringify(st)); } catch { /* egal */ }
}

/** Geänderte Dateien seit `base` (Commit) plus nicht committete. Pfade relativ zu root. */
export function changedFiles(root, base) {
  const prefix = (git(root, ['rev-parse', '--show-prefix']) || '').trim();
  const out = new Map();
  if (!base) {
    for (const ref of ['@{u}', 'origin/HEAD', 'origin/main', 'origin/master']) {
      const mb = git(root, ['merge-base', 'HEAD', ref]);
      if (mb) { base = mb.trim(); break; }
    }
  }
  if (base) {
    const d = git(root, ['diff', '--name-status', '--relative', '--no-renames', base, 'HEAD']);
    for (const l of (d || '').split('\n').filter(Boolean)) { const [st, f] = l.split('\t'); out.set(f, st[0]); }
  }
  const s = git(root, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames', '--', '.']) || '';
  for (const rec of s.split('\0').filter(Boolean)) {
    const st = rec.slice(0, 2); let f = rec.slice(3);
    if (prefix) { if (!f.startsWith(prefix)) continue; f = f.slice(prefix.length); }
    const code = st === '??' ? 'A' : st.includes('D') ? 'D' : st.includes('A') ? 'A' : 'M';
    if (!out.has(f) || out.get(f) === 'M') out.set(f, code);
  }
  return [...out].map(([file, status]) => ({ file, status }));
}

/** Ermittelt Doku-Lücken in den Änderungen: Strukturänderungen in Komponenten ohne Doku-Update, nicht abgedeckte neue Dateien. */
export function reviewChanges(project, root, base) {
  const changes = changedFiles(root, base);
  const ign = project.ignore.map(compilePattern);
  const docTouched = new Set(changes.filter((c) => c.file.startsWith(project.docDir + '/')).map((c) => c.file));
  const stale = new Map(); const uncovered = []; const touched = new Map();
  for (const { file, status } of changes) {
    if (file.startsWith(project.docDir + '/')) continue;
    const owner = ownerOf(project, file);
    if (owner) { if (!touched.has(owner.id)) touched.set(owner.id, []); touched.get(owner.id).push(file); }
    if (matchesAny(file, ign) && !MANIFESTS.test(file)) continue;
    const structural = status === 'A' || status === 'D' || MANIFESTS.test(file);
    if (!structural) continue;
    if (owner) {
      if (docTouched.has(owner.file)) continue;
      if (!stale.has(owner.id)) stale.set(owner.id, { comp: owner, files: [] });
      stale.get(owner.id).files.push((status === 'D' ? '-' : status === 'A' ? '+' : '~') + file);
    } else if (status === 'A' && !matchesAny(file, ign)) uncovered.push(file);
  }
  return { changes, stale: [...stale.values()], uncovered, touched, docTouched: [...docTouched] };
}

// ───────────────────────── Code-Analyse ─────────────────────────
// Liest Struktur aus dem Quellcode (ohne Parser-Bibliothek, per Muster): Importe zwischen Dateien,
// genutzte Bibliotheken, Funktionen/Klassen, HTTP-Routen und -Aufrufe, Datenbanktabellen, Umgebungsvariablen.

const LANG_BY_EXT = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  vue: 'Vue', svelte: 'Svelte', py: 'Python', go: 'Go', rb: 'Ruby', php: 'PHP', java: 'Java', kt: 'Kotlin', cs: 'C#', rs: 'Rust', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', sql: 'SQL', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  sh: 'Shell', bash: 'Shell', ps1: 'PowerShell', yml: 'YAML', yaml: 'YAML', json: 'JSON', toml: 'TOML', ini: 'Konfiguration', conf: 'Konfiguration',
  j2: 'Vorlage', jinja: 'Vorlage', hbs: 'Vorlage', ejs: 'Vorlage', njk: 'Vorlage', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protobuf', prisma: 'Prisma', tf: 'Terraform',
};
const JS_LIKE = new Set(['JavaScript', 'TypeScript', 'Vue', 'Svelte']);
const SQL_WORDS = new Set(['select', 'where', 'set', 'values', 'the', 'a', 'an', 'and', 'or', 'not', 'null', 'table', 'if', 'exists', 'as', 'on', 'only', 'lateral', 'unnest']);
const LIMIT = { files: 3000, bytes: 512 * 1024, list: 40 };

function langOf(file) {
  const base = file.split('/').pop();
  if (/^Dockerfile/i.test(base)) return 'Docker';
  if (/^Makefile$/i.test(base)) return 'Make';
  if (/^Caddyfile$/i.test(base)) return 'Konfiguration';
  const ext = (base.match(/\.([^.]+)$/) || [])[1];
  return ext ? LANG_BY_EXT[ext.toLowerCase()] || null : null;
}

const uniq = (arr, n = LIMIT.list) => [...new Set(arr.filter(Boolean))].slice(0, n);
const allMatches = (text, re, g = 1) => [...text.matchAll(re)].map((m) => m[g]);
const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

function analyzeText(file, text, lang) {
  const r = { imports: [], libs: [], symbols: [], routes: [], calls: [], tables: [], env: [], defines: [], mounts: [] };
  let code = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (JS_LIKE.has(lang) || lang === 'Go') code = code.replace(/(^|[^:'"`\\\w])\/\/[^\n]*/g, '$1');
  if (lang === 'Python' || lang === 'Shell' || lang === 'YAML' || lang === 'TOML') code = code.replace(/(^|\s)#[^\n]*/g, '$1');
  if (JS_LIKE.has(lang)) {
    const specs = [
      ...allMatches(code, /(?:^|[\n;])\s*import\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"\n]+)['"]/g),
      ...allMatches(code, /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g),
      ...allMatches(code, /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g),
      ...allMatches(code, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g),
    ];
    for (const sp of specs) (sp.startsWith('.') || sp.startsWith('/') ? r.imports : r.libs).push(sp.startsWith('.') || sp.startsWith('/') ? sp : pkgName(sp));
    const fn = (name, kind) => r.symbols.push({ name, kind });
    for (const m of code.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) fn(m[1], 'function');
    for (const m of code.matchAll(/\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) fn(m[1], 'class');
    for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\s*)?(\(|function|[A-Za-z_$][\w$]*\s*=>)?/g)) fn(m[1], m[3] ? 'function' : 'value');
    for (const m of code.matchAll(/\bexport\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) fn(m[1], 'type');
    for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from)/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) fn(n, 'value'); }
    for (const m of code.matchAll(/\bmodule\.exports\s*=\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(':')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) fn(n, 'value'); }
    for (const m of code.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) fn(m[1], 'value');
    if (!r.symbols.length) {
      for (const m of code.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) fn(m[1], 'function');
      for (const m of code.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) fn(m[1], 'class');
    }
    // Server-Routen: x.get('/pfad', …) — nur Pfade mit führendem /
    for (const m of code.matchAll(/\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`\n]*)['"`]\s*,/gi)) r.routes.push({ method: m[1].toUpperCase(), path: m[2] });
    // Router-Einhängepunkte: app.use('/orders', …, ordersRouter)
    for (const m of code.matchAll(/\.use\(\s*['"`](\/[^'"`\n]*)['"`]\s*,([^)]*)\)/g)) { const name = m[2].split(',').pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(name)) r.mounts.push({ prefix: m[1], name }); }
    // Ausgehende HTTP-Aufrufe: fetch('/x'), axios.get('/x'), request<T>('POST', '/x')
    for (const m of code.matchAll(/\b(?:fetch|axios(?:\.\w+)?|request|ky(?:\.\w+)?|\$fetch|useFetch|api\.(?:get|post|put|patch|delete)|http\.(?:get|post|put|patch|delete))(?:<[^>()]*>)?\(\s*(?:['"`](GET|POST|PUT|PATCH|DELETE)['"`]\s*,\s*)?['"`]([^'"`\n$]{1,200})/g)) {
      if (/^(\/|https?:)/.test(m[2])) r.calls.push((m[1] ? m[1] + ' ' : '') + m[2].replace(/\/$/, '/…'));
    }
    r.env.push(...allMatches(code, /\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g), ...allMatches(code, /\bprocess\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]/g), ...allMatches(code, /\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)/g));
  } else if (lang === 'Python') {
    for (const m of code.matchAll(/^\s*from\s+(\.+[\w.]*|[\w.]+)\s+import\s+\(?([\w*,\s]+)\)?/gm)) r.imports.push(`${m[1]}|${m[2].replace(/\s+/g, '')}`);
    for (const m of code.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const x of m[1].split(',')) r.imports.push(`${x.trim()}|`);
    for (const m of code.matchAll(/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm)) r.symbols.push({ name: m[1], kind: 'function' });
    for (const m of code.matchAll(/^class\s+([A-Za-z]\w*)/gm)) r.symbols.push({ name: m[1], kind: 'class' });
    for (const m of code.matchAll(/@\w+\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/g)) r.routes.push({ method: m[1] === 'route' ? 'ANY' : m[1].toUpperCase(), path: m[2] });
    for (const m of code.matchAll(/\b(?:requests|httpx|client|session)\.(get|post|put|patch|delete)\(\s*f?['"]([^'"\n]{1,200})['"]/g)) r.calls.push(m[2]);
    r.env.push(...allMatches(code, /\b(?:os\.environ|environ|env)(?:\.get)?\s*[[(]\s*['"]([A-Z_][A-Z0-9_]*)['"]/g), ...allMatches(code, /\bos\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g));
  } else if (lang === 'Go') {
    const block = code.match(/\bimport\s*\(([\s\S]*?)\)/);
    const specs = [...(block ? allMatches(block[1], /"([^"]+)"/g) : []), ...allMatches(code, /^import\s+(?:\w+\s+)?"([^"]+)"/gm)];
    r.libs.push(...specs);
    for (const m of code.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm)) r.symbols.push({ name: m[1], kind: 'function' });
    for (const m of code.matchAll(/^type\s+([A-Z]\w*)\s+(struct|interface)/gm)) r.symbols.push({ name: m[1], kind: m[2] === 'struct' ? 'class' : 'type' });
    for (const m of code.matchAll(/\.(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/g)) r.routes.push({ method: 'ANY', path: m[1] });
    r.env.push(...allMatches(code, /\bos\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g));
  } else if (lang === 'HTML' || lang === 'Vorlage') {
    for (const m of code.matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)=["']([^"'#?]+)["']/gi)) if (!/^(https?:|data:|\/\/|mailto:)/i.test(m[1])) r.imports.push(m[1]);
  } else if (/(^|\/)package\.json$/.test(file)) {
    try { const j = JSON.parse(text); r.libs.push(...Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies })); } catch { /* egal */ }
  } else if (/(^|\/)requirements[^/]*\.txt$/.test(file)) {
    r.libs.push(...allMatches(text, /^\s*([A-Za-z0-9_.-]+)/gm));
  } else if (/(^|\/)pyproject\.toml$/.test(file)) {
    const dep = text.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m);
    if (dep) r.libs.push(...allMatches(dep[1], /["']([A-Za-z0-9_.-]+)/g));
  } else if (/(^|\/)go\.mod$/.test(file)) {
    r.libs.push(...allMatches(text, /^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[^\s]+)\s+v/gm));
  }
  // Datenbanktabellen: Definitionen in SQL, Zugriffe in SQL-Strings (Schlüsselwörter in Großbuchstaben)
  if (lang === 'SQL') r.defines.push(...allMatches(code, /\bcreate\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?["`]?([A-Za-z_][\w.]*)/gi).map((t) => t.toLowerCase()));
  if (lang !== 'Python' || /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(code)) {
    r.tables.push(...allMatches(code, /\b(?:FROM|JOIN|INTO|UPDATE)\s+["`]?([a-z_][a-z0-9_]*)["`]?/g).filter((t) => !SQL_WORDS.has(t)));
  }
  r.libs = uniq(r.libs); r.env = uniq(r.env); r.tables = uniq(r.tables); r.defines = uniq(r.defines); r.calls = uniq(r.calls, 30);
  r.symbols = r.symbols.filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i).slice(0, LIMIT.list);
  r.routes = r.routes.filter((x, i, a) => a.findIndex((y) => y.method === x.method && y.path === x.path) === i).slice(0, LIMIT.list);
  return r;
}

function resolveImports(file, lang, raw, fileSet, pyIndex) {
  const out = [];
  const dir = file.includes('/') ? file.replace(/\/[^/]*$/, '') : '';
  const norm = (p) => { const parts = []; for (const x of p.split('/')) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); } return parts.join('/'); };
  for (const spec of raw) {
    if (lang === 'Python') {
      const [mod, names] = spec.split('|');
      let cands = [];
      if (mod.startsWith('.')) {
        const dots = mod.match(/^\.+/)[0].length;
        let base = dir; for (let i = 1; i < dots; i++) base = base.replace(/\/?[^/]*$/, '');
        const rest = mod.slice(dots).replace(/\./g, '/');
        const b = norm(`${base}/${rest}`);
        cands = [`${b}.py`, `${b}/__init__.py`, ...names.split(',').filter(Boolean).map((n) => `${norm(`${b}/${n}`)}.py`)];
        const hit = cands.find((c) => fileSet.has(c));
        if (hit) out.push(hit);
        continue;
      }
      const keys = [...names.split(',').filter((n) => n && n !== '*').map((n) => `${mod}.${n}`), mod];
      const hit = keys.map((k) => pyIndex.get(k)).find(Boolean);
      if (hit) out.push(hit);
      continue;
    }
    if (/^https?:/.test(spec)) continue;
    const base = spec.startsWith('/') ? norm(spec) : norm(`${dir}/${spec}`);
    const stem = base.replace(/\.(m?js|cjs|jsx)$/, '');
    const cands = [base, ...['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx', '.vue', '.svelte', '.json', '.css'].map((e) => stem + e), ...['ts', 'tsx', 'js', 'mjs', 'jsx'].map((e) => `${base}/index.${e}`)];
    const hit = cands.find((c) => fileSet.has(c));
    if (hit && hit !== file) out.push(hit);
  }
  return uniq(out, 200);
}

/** Analysiert alle Quelldateien eines Projekts. Ergebnis kommt ins Projektmodell (project.code). */
export function analyzeCode(root, project) {
  const ign = project.ignore.map(compilePattern);
  const own = project.ignore.slice(DEFAULT_IGNORE.length).map(compilePattern); // projekteigene Ausnahmen gelten auch für Manifeste
  let list = listFiles(root).filter((f) => !/\.min\.(js|css)$|\.map$|\.lock$/.test(f) && (!matchesAny(f, ign) || (MANIFESTS.test(f) && !matchesAny(f, own))) && langOf(f));
  const truncated = list.length > LIMIT.files;
  list = list.sort().slice(0, LIMIT.files);
  const fileSet = new Set(list);
  const pyIndex = new Map();
  for (const f of list) {
    if (!f.endsWith('.py')) continue;
    const parts = f.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/');
    for (let i = 0; i < parts.length; i++) { const k = parts.slice(i).join('.'); if (!pyIndex.has(k)) pyIndex.set(k, f); }
  }
  const notes = new Map(); const dirNotes = [];
  for (const c of project.components) for (const fn of c.files || []) { if (fn.dir) dirNotes.push({ path: fn.path, note: fn.note, component: c.id }); else notes.set(fn.path, fn.note); }
  const languages = {}; let totalLines = 0;
  const files = list.map((f) => {
    const lang = langOf(f);
    let text = '';
    try { const st = fs.statSync(path.join(root, f)); if (st.size <= LIMIT.bytes) text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { /* weg */ }
    if (text.includes('\u0000')) text = '';
    const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
    const a = text ? analyzeText(f, text, lang) : { imports: [], libs: [], symbols: [], routes: [], calls: [], tables: [], env: [], defines: [], mounts: [] };
    languages[lang] ||= { files: 0, lines: 0 }; languages[lang].files++; languages[lang].lines += lines; totalLines += lines;
    const owner = ownerOf(project, f);
    return { path: f, lang, lines, component: owner ? owner.id : null, note: notes.get(f) || '', ...a, imports: resolveImports(f, lang, a.imports, fileSet, pyIndex) };
  });
  // Routen-Präfixe aus app.use('/x', router) auf die Dateien übertragen, die den Router exportieren
  const mounts = new Map();
  for (const f of files) for (const m of f.mounts) mounts.set(m.name, m.prefix);
  for (const f of files) {
    const prefix = f.symbols.map((x) => mounts.get(x.name)).find(Boolean);
    if (prefix) f.routes = f.routes.map((r) => ({ ...r, path: (prefix.replace(/\/$/, '') + (r.path === '/' ? '' : r.path)) || '/' }));
    delete f.mounts;
  }
  return { files, dirs: dirNotes, languages, totalLines, totalFiles: files.length, truncated };
}

// ───────────────────────── Änderungen, Schutz, Verlauf ─────────────────────────

/** Fingerabdruck des Antrags: Titel, Bereiche und Text. Ändert sich der Plan nach der Genehmigung, ist sie ungültig. */
export function changeHash(ch) {
  const norm = [ch.title, [...ch.affects].sort().join(','), String(ch.body || '').replace(/\s+/g, ' ').trim()].join('\n');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/** Passt ein Bereichsausdruck (Komponenten-ID, layer:x, zone:x, Pfadmuster) auf eine Datei? */
export function areaMatches(project, expr, file) {
  const e = String(expr).trim();
  const owner = ownerOf(project, file);
  if (e.startsWith('layer:')) return Boolean(owner && owner.layer === e.slice(6).toLowerCase());
  if (e.startsWith('zone:')) return Boolean(owner && owner.zone === e.slice(5).toLowerCase());
  if (/[/*]/.test(e)) return compilePattern(e).test(file);
  return Boolean(owner && owner.id.toLowerCase() === e.toLowerCase());
}
export function protectedBy(project, file) {
  if (file.startsWith(project.docDir + '/') || file.startsWith('.claude/')) return [];
  return project.protected.filter((e) => areaMatches(project, e, file));
}
export function changesCovering(project, file, statuses = ['approved']) {
  return project.changes.filter((c) => statuses.includes(c.status) && c.affects.some((a) => areaMatches(project, a, file)));
}

function portalConfig(root) {
  let url = process.env.DOKU_URL || ''; let token = process.env.DOKU_TOKEN || '';
  try { const j = JSON.parse(fs.readFileSync(path.join(root, '.claude/doku/portal.json'), 'utf8')); url ||= j.url || ''; } catch { /* keine Datei */ }
  return { url: url.replace(/\/+$/, ''), token };
}
async function portal(root, method, p, body) {
  const cfg = portalConfig(root);
  if (!cfg.url || !cfg.token) throw new Error('Portal nicht konfiguriert: DOKU_URL und DOKU_TOKEN setzen (z. B. in .claude/settings.local.json unter "env").');
  const res = await fetch(cfg.url + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const txt = await res.text();
  let j = {}; try { j = JSON.parse(txt); } catch { /* Text */ }
  if (!res.ok) throw new Error(`Portal ${res.status}: ${j.error || txt.slice(0, 200)}`);
  return j;
}
/** Genehmigte Anträge laut Portal (nur dort können Menschen per Passkey genehmigen). */
async function approvedInPortal(root, project) {
  const j = await portal(root, 'GET', `/api/changes?project=${encodeURIComponent(project.id)}`);
  const ok = new Map();
  for (const c of j.changes || []) if (c.status === 'approved') ok.set(c.id, c.hash);
  return project.changes.filter((c) => ok.get(c.id) === c.hash);
}
/** Prüft Dateien gegen geschützte Bereiche. → [{file, areas, covered}] */
async function checkProtected(root, project, files) {
  const hits = files.map((f) => ({ file: f, areas: protectedBy(project, f) })).filter((x) => x.areas.length);
  if (!hits.length) return { hits: [], error: null };
  let approved = []; let error = null;
  try { approved = await approvedInPortal(root, project); } catch (e) { error = e.message; }
  for (const h of hits) h.covered = approved.filter((c) => c.affects.some((a) => areaMatches(project, a, h.file))).map((c) => c.id);
  return { hits, error };
}

function readHistory(root, project, n = 300) {
  const out = git(root, ['log', `-n${n}`, '--date=iso-strict', '--pretty=format:%x1e%H%x1f%an%x1f%ad%x1f%s', '--name-only', '--relative', '--', '.']);
  if (!out) return [];
  return out.split('\x1e').filter((x) => x.trim()).map((rec) => {
    const [head, ...rest] = rec.split('\n');
    const [commit, author, date, subject] = head.split('\x1f');
    const files = rest.map((x) => x.trim()).filter(Boolean);
    const comps = [...new Set(files.map((f) => ownerOf(project, f)?.id).filter(Boolean))];
    const docs = files.filter((f) => f.startsWith(project.docDir + '/')).length;
    const changeRefs = [...new Set([...String(subject).matchAll(/\b(\d{4})\b/g)].map((m) => m[1]).filter((n4) => project.changes.some((c) => c.id.startsWith(n4))))];
    return { commit, author, date, subject, files: files.slice(0, 50), fileCount: files.length, components: comps, docs, changes: changeRefs };
  });
}

// ───────────────────────── Bundle / Site ─────────────────────────

/** Prüft projektübergreifende Verweise (uses, affects, Flow-Teilnehmer) gegen andere geladene Projekte. */
export function crossCheck(projects) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out = [];
  const has = (pid, id) => byId.get(pid)?.components.some((c) => c.id === id) || byId.get(pid)?.flows.some((f) => f.id === id) || byId.get(pid)?.decisions.some((d) => d.id === id);
  for (const p of projects) {
    const refs = [];
    for (const c of p.components) for (const u of c.uses) if (u.project && u.project !== p.id) refs.push([c.file, u.project, u.target, 'uses']);
    for (const d of p.decisions) for (const a of d.affects) { const r = parseRef(a); if (r.project && r.project !== p.id) refs.push([d.file, r.project, r.id, 'affects']); }
    for (const f of p.flows) for (const x of f.participants) { const r = parseRef(x); if (r.project && r.project !== p.id) refs.push([f.file, r.project, r.id, 'Flow']); }
    for (const [file, rp, rid, what] of refs) {
      if (!byId.has(rp)) continue;
      if (!has(rp, rid)) {
        const ids = new Map(byId.get(rp).components.map((c) => [c.id.toLowerCase(), c]));
        out.push({ project: p.id, level: 'error', file, msg: `${what}: "${rp}:${rid}" existiert nicht${suggest(rid, ids)}`, code: 'unknown-cross' });
      }
    }
  }
  return out;
}

export function makeBundle(projects, meta = {}) {
  return { schema: SCHEMA, generatedAt: new Date().toISOString(), ...meta, projects };
}

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
export function viewerDir() {
  const cands = [process.env.DOKU_VIEWER_DIR, path.resolve(CLI_DIR, '../viewer')].filter(Boolean);
  return cands.find((d) => fs.existsSync(path.join(d, 'index.html'))) || null;
}

/** Baut eine statische Seite. single=true → eine einzige HTML-Datei mit allem inline. */
export function buildSite(bundle, { out, single = false, title } = {}) {
  const vd = viewerDir();
  if (!vd) throw new Error('Viewer nicht gefunden. "site" funktioniert nur aus dem dokusystem-Repo (oder DOKU_VIEWER_DIR setzen).');
  const needsMermaid = JSON.stringify(bundle).includes('```mermaid');
  let html = fs.readFileSync(path.join(vd, 'index.html'), 'utf8');
  const dataJson = JSON.stringify(bundle).replace(/</g, '\\u003c');
  if (title) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title.replace(/[<&]/g, '')}</title>`);
  if (single) {
    html = html.replace(/<link rel="stylesheet" href="((?!https?:)[^"]+)">/g, (_, href) => `<style>\n${fs.readFileSync(path.join(vd, href), 'utf8')}\n</style>`);
    html = html.replace(/<script src="([^"]+)"( data-optional)?><\/script>/g, (_, src) => {
      const code = fs.readFileSync(path.join(vd, src), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD');
      return `<script>\n${code}\n</script>`;
    });
    html = html.replace('<!--DOKU_DATA-->', () => `<script>window.DOKU_DATA=${dataJson};</script>` +
      (needsMermaid ? `\n<script>\n${fs.readFileSync(path.join(vd, 'vendor/mermaid.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/\uFFFD/g, '\\uFFFD')}\n</script>` : ''));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    return out;
  }
  fs.mkdirSync(out, { recursive: true });
  fs.cpSync(vd, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'data.js'), `window.DOKU_DATA=${dataJson};\n`);
  html = html.replace('<!--DOKU_DATA-->', '<script src="data.js"></script>');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  return out;
}

// ───────────────────────── Textausgaben (für Claude kompakt) ─────────────────────────

const secStr = (x) => (x ? ` [${[x.tls === true && 'tls', x.tls === false && 'plain', x.auth && 'auth=' + x.auth, x.port && 'port=' + x.port, ...x.notes].filter(Boolean).join(', ')}]` : '');
const useStr = (u) => `${u.project ? u.project + ':' : ''}${u.target}${u.protocol ? ':' + u.protocol : ''}${u.label ? ` "${u.label}"` : ''}${secStr(u.sec)}`;

export function incomingOf(project, id) {
  const out = [];
  for (const c of project.components) for (const u of c.uses) if (!u.project && u.target === id) out.push({ from: c, use: u });
  return out;
}

export function formatSummary(p, { brief = false } = {}) {
  const L = [];
  L.push(`# ${p.id} — ${p.name}${p.tech.length ? ` [${p.tech.join(', ')}]` : ''}`);
  if (p.summary) L.push(p.summary);
  const byLayer = new Map();
  for (const c of p.components) { if (!byLayer.has(c.layer)) byLayer.set(c.layer, []); byLayer.get(c.layer).push(c); }
  L.push(`Komponenten (${p.components.length}):`);
  for (const [layer, comps] of [...byLayer].sort((a, b) => layerRank(p, a[0]) - layerRank(p, b[0]))) {
    L.push(` [${layer}]`);
    for (const c of comps) {
      if (brief) { L.push(`  ${c.id} (${c.type})${c.uses.length ? ' -> ' + c.uses.map((u) => (u.project ? u.project + ':' : '') + u.target + (u.protocol ? ':' + u.protocol : '')).join(', ') : ''}`); continue; }
      L.push(`  ${c.id} (${c.type}${c.path.length ? ', ' + c.path.join(' ') : ''})${c.status !== 'active' ? ' {' + c.status + '}' : ''} — ${c.summary}`);
      if (c.uses.length) L.push(`    -> ${c.uses.map(useStr).join(', ')}`);
    }
  }
  if (p.flows.length) L.push(`Flows: ${p.flows.map((f) => `${f.id} (${f.steps.length})`).join(', ')}`);
  if (p.decisions.length) L.push(`Entscheidungen: ${p.decisions.map((d) => `${d.id} [${d.status}]`).join(', ')}`);
  L.push(`Doku: ${p.docDir}/  Prüfen: doku check`);
  return L.join('\n');
}
function layerRank(p, layer) {
  const order = p.layers.length ? p.layers : ['client', 'frontend', 'ui', 'web', 'edge', 'gateway', 'api', 'backend', 'service', 'services', 'core', 'domain', 'worker', 'jobs', 'tooling', 'data', 'storage', 'infra', 'external', 'other'];
  const i = order.indexOf(layer);
  return i < 0 ? 50 : i;
}

export function formatComponent(p, c, { full = true } = {}) {
  const L = [`## ${c.id} — ${c.name} (${c.type}, ${c.layer})${c.status !== 'active' ? ' {' + c.status + '}' : ''}`, `Doku: ${c.file}`];
  if (c.path.length) L.push(`Code: ${c.path.join(', ')}`);
  if (c.tech.length) L.push(`Tech: ${c.tech.join(', ')}`);
  if (c.summary) L.push(c.summary);
  if (c.files && c.files.length) L.push(`Dateien: ${c.files.map((f) => `${f.path}${f.note ? ' – ' + f.note : ''}`).join('; ')}`);
  if (c.zone || c.exposure || (c.security && c.security.length)) L.push(`Sicherheit: ${[c.zone && 'Zone ' + c.zone, c.exposure && 'erreichbar ' + c.exposure, ...(c.security || []).map((m) => `${m.kind}: ${m.text}`)].filter(Boolean).join('; ')}`);
  if (c.provides.length) L.push(`Bietet: ${c.provides.map((x) => x.raw).join('; ')}`);
  if (c.uses.length) L.push(`Nutzt: ${c.uses.map(useStr).join(', ')}`);
  const inc = incomingOf(p, c.id);
  if (inc.length) L.push(`Genutzt von: ${inc.map((i) => `${i.from.id}${i.use.protocol ? ':' + i.use.protocol : ''}`).join(', ')}`);
  const flows = p.flows.filter((f) => f.participants.includes(c.id));
  if (flows.length) L.push(`Flows: ${flows.map((f) => f.id).join(', ')}`);
  const decs = p.decisions.filter((d) => d.affects.includes(c.id));
  if (decs.length) L.push(`Entscheidungen: ${decs.map((d) => d.id).join(', ')}`);
  if (full && c.body && c.body !== c.summary) L.push('', c.body);
  return L.join('\n');
}

export function formatIssues(issues, { max = 50 } = {}) {
  const L = issues.slice(0, max).map((i) => `${i.level === 'error' ? 'FEHLER' : 'Hinweis'} ${i.file}${i.line ? ':' + i.line : ''}: ${i.msg}`);
  if (issues.length > max) L.push(`… und ${issues.length - max} weitere`);
  return L.join('\n');
}

// ───────────────────────── Vorlagen ─────────────────────────

export function componentTemplate({ id, type = 'module', layer, path: p, summary, uses = [], provides = [], tech = [] }) {
  const L = ['---'];
  if (type) L.push(`type: ${type}`);
  if (layer) L.push(`layer: ${layer}`);
  if (p) L.push(`path: ${p}`);
  if (tech.length) L.push(`tech: [${tech.join(', ')}]`);
  if (provides.length) { L.push('provides:'); provides.forEach((x) => L.push(`  - ${x}`)); }
  if (uses.length) { L.push('uses:'); uses.forEach((x) => L.push(`  - ${x}`)); }
  L.push('---', summary || `TODO: Was macht ${id}?`, '');
  return L.join('\n');
}

// ───────────────────────── CLI ─────────────────────────

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) (flags[k] = flags[k] ? [].concat(flags[k], v) : v);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { const val = argv[++i]; flags[k] = flags[k] ? [].concat(flags[k], val) : val; }
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `doku ${VERSION} — Architektur-Doku in docs/doku/

Lesen (kompakt, für Claude):
  doku summary [--brief]          Überblick: alle Komponenten, Abhängigkeiten, Flows
  doku show <id>                  Details inkl. "genutzt von", Flows, Entscheidungen
  doku context <datei…>|--changed Welche Komponente/Doku gehört zu diesen Dateien?
  doku coverage                   Quelldateien ohne zugeordnete Komponente

Schreiben:
  doku new component <id> [--type t] [--layer l] [--path p] [--uses "ziel: proto text"]…
  doku new flow <id>  |  doku new decision "<titel>"  |  doku new guide "<titel>"

Prüfen & Bauen:
  doku check [--changed] [--strict] [--with ../anderes-projekt]…  Validieren (Exit 1 bei Fehlern)
  doku build [--out datei.json] [--no-code]  Projektmodell als JSON (inkl. Code-Analyse)
  doku push [--url U] [--token T]   An Portal senden (oder DOKU_URL / DOKU_TOKEN)
  doku site [roots…] --out dir | --single datei.html   Statische Seite (nur im dokusystem-Repo)
  doku init [ziel] [--no-ci]        doku in ein Projekt installieren (nur im dokusystem-Repo)
  doku hook start|stop|pretool       Claude-Code-Hooks

Änderungsanträge (für geschützte Bereiche, project.md: protected: [...]):
  doku change new "<titel>" --affects a,b [--risk mittel]   Antrag anlegen
  doku change submit <id>        Ans Portal senden (Genehmigung per Passkey)
  doku change status [<id>]      Stand im Portal
  doku change done <id>          Als umgesetzt markieren (Changelog)
  doku change list | verify [--base <ref>]   Übersicht | CI-Prüfung
  doku protected [datei…]        Ist eine Datei geschützt, gibt es eine Genehmigung?

Optionen: --root <pfad>  --dir <doku-ordner> (Standard docs/doku)`;

function out(s) { process.stdout.write(s.endsWith('\n') ? s : s + '\n'); }

async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift() || 'help';
  const docDir = flags.dir || DEFAULT_DOC_DIR;
  const needRoot = () => {
    const r = flags.root ? path.resolve(flags.root) : findRoot(process.cwd(), docDir);
    if (!r) { console.error(`Kein ${docDir} gefunden. Erst "doku init" ausführen.`); process.exit(1); }
    return r;
  };
  switch (cmd) {
    case 'help': case '--help': case '-h': out(HELP); return 0;
    case 'version': case '--version': out(VERSION); return 0;

    case 'summary': { const root = needRoot(); const p = loadProject(root, { docDir, checkPaths: false }); out(formatSummary(p, { brief: Boolean(flags.brief) })); return 0; }

    case 'show': {
      const root = needRoot(); const p = loadProject(root, { docDir, checkPaths: false });
      if (!pos.length) { console.error('doku show <id>'); return 1; }
      for (const q of pos) {
        const lc = q.toLowerCase();
        const c = p.components.find((x) => x.id.toLowerCase() === lc);
        if (c) { out(formatComponent(p, c)); continue; }
        const f = p.flows.find((x) => x.id.toLowerCase() === lc);
        if (f) { out([`## Flow ${f.id} — ${f.name}`, `Doku: ${f.file}`, f.summary, ...f.steps.map((s) => `  ${s.kind === 'section' ? '== ' + s.label : s.kind === 'note' ? `note ${s.over.join(',')}: ${s.label}` : `${s.from} ${s.kind === 'call' ? '->' : s.kind === 'async' ? '->>' : '-->'} ${s.to}: ${s.label}`}`)].join('\n')); continue; }
        const d = p.decisions.find((x) => x.id.toLowerCase() === lc);
        if (d) { out([`## Entscheidung ${d.id} — ${d.title} [${d.status}${d.date ? ', ' + d.date : ''}]`, `Doku: ${d.file}`, d.affects.length ? `Betrifft: ${d.affects.join(', ')}` : '', '', d.body].filter((x) => x !== '').join('\n')); continue; }
        console.error(`"${q}" nicht gefunden.${suggest(q, new Map([...p.components, ...p.flows, ...p.decisions].map((x) => [x.id.toLowerCase(), x])))}`);
      }
      return 0;
    }

    case 'context': {
      const root = needRoot(); const p = loadProject(root, { docDir, checkPaths: false });
      let files = pos.map((f) => path.relative(root, path.resolve(f)).split(path.sep).join('/'));
      if (flags.changed) files = changedFiles(root).map((c) => c.file).filter((f) => !f.startsWith(docDir + '/'));
      if (!files.length) { out('Keine Dateien.'); return 0; }
      const comps = new Map(); const none = [];
      for (const f of files) { const o = ownerOf(p, f); if (o) { if (!comps.has(o.id)) comps.set(o.id, { c: o, files: [] }); comps.get(o.id).files.push(f); } else none.push(f); }
      for (const { c, files: fs2 } of comps.values()) out(formatComponent(p, c, { full: false }) + `\nDateien: ${fs2.join(', ')}\n`);
      if (none.length) out(`Keiner Komponente zugeordnet: ${none.join(', ')}`);
      return 0;
    }

    case 'coverage': {
      const root = needRoot(); const p = loadProject(root, { docDir, checkPaths: false });
      const cov = coverage(p, root);
      out(`Abgedeckt: ${cov.covered}/${cov.total} Quelldateien`);
      const byDir = new Map();
      for (const f of cov.uncovered) { const d = f.includes('/') ? f.split('/').slice(0, 2).join('/').replace(/\/[^/]*\.[^/]*$/, '') : '.'; byDir.set(d, (byDir.get(d) || 0) + 1); }
      for (const [d, n] of [...byDir].sort()) out(`  ${d}/ (${n})`);
      return 0;
    }

    case 'check': {
      const root = needRoot(); const p = loadProject(root, { docDir });
      if (flags.with) {
        const others = [].concat(flags.with).map((r) => loadProject(path.resolve(r), { docDir, checkPaths: false }));
        const extra = crossCheck([p, ...others]).filter((i) => i.project === p.id);
        p.issues.push(...extra); p.stats.errors += extra.length;
      }
      let issues = p.issues;
      if (!flags.warnings && !flags.strict) issues = issues.filter((i) => i.level === 'error' || flags.verbose);
      if (issues.length) out(formatIssues(issues));
      let gaps = 0;
      if (flags.changed) {
        const r = reviewChanges(p, root);
        for (const s of r.stale) { out(`Doku prüfen: ${s.comp.id} (${s.comp.file}) — ${s.files.join(' ')}`); gaps++; }
        if (r.uncovered.length) { out(`Keiner Komponente zugeordnet: ${r.uncovered.join(' ')}`); gaps++; }
      }
      const { errors, warnings } = p.stats;
      out(`${p.id}: ${p.stats.components} Komponenten, ${p.stats.flows} Flows, ${p.stats.decisions} Entscheidungen — ${errors} Fehler, ${warnings} Hinweise${!flags.warnings && warnings ? ' (--warnings zeigt sie)' : ''}`);
      return errors || (flags.strict && (warnings || gaps)) ? 1 : 0;
    }

    case 'build': {
      const root = needRoot(); const p = loadProject(root, { docDir, code: !flags['no-code'] });
      const json = JSON.stringify(p, null, flags.pretty ? 2 : 0);
      if (flags.out) { fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true }); fs.writeFileSync(flags.out, json); console.error(`→ ${flags.out} (${p.stats.errors} Fehler)`); }
      else out(json);
      return p.stats.errors && flags.strict ? 1 : 0;
    }

    case 'push': {
      const root = needRoot(); const p = loadProject(root, { docDir, code: !flags['no-code'] });
      const url = (flags.url || process.env.DOKU_URL || '').replace(/\/+$/, '');
      const token = flags.token || process.env.DOKU_TOKEN;
      if (!url || !token) { console.error('doku push braucht --url und --token (oder DOKU_URL / DOKU_TOKEN).'); return 1; }
      const res = await fetch(`${url}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(p) });
      const txt = await res.text();
      if (!res.ok) { console.error(`Push fehlgeschlagen (${res.status}): ${txt}`); return 1; }
      out(`Gesendet: ${p.id} → ${url} (${p.stats.components} Komponenten, ${p.stats.errors} Fehler)`);
      return 0;
    }

    case 'site': {
      const roots = pos.length ? pos.map((r) => path.resolve(r)) : [needRoot()];
      const projects = roots.map((r) => loadProject(r, { docDir, code: !flags['no-code'] }));
      const bundle = makeBundle(projects, { title: flags.title || undefined });
      const target = flags.single || flags.out || 'doku-site';
      buildSite(bundle, { out: typeof target === 'string' ? target : 'doku-site', single: Boolean(flags.single), title: flags.title });
      out(`Seite gebaut: ${target} (${projects.map((p) => p.id).join(', ')})`);
      return 0;
    }

    case 'new': {
      const root = needRoot(); const kind = pos.shift(); const name = pos.join(' ');
      if (!kind || !name) { console.error('doku new component|flow|decision <name>'); return 1; }
      const abs = path.join(root, docDir);
      let file; let content;
      if (kind === 'component') {
        const id = slug(name); const sub = flags.layer && flags.folder ? `${flags.layer}/` : '';
        file = path.join(abs, 'components', sub + id + '.md');
        content = componentTemplate({ id, type: flags.type, layer: flags.layer, path: flags.path, summary: flags.summary, uses: [].concat(flags.uses || []), provides: [].concat(flags.provides || []), tech: asList(flags.tech) });
      } else if (kind === 'flow') {
        const id = slug(name); file = path.join(abs, 'flows', id + '.md');
        content = `---\nname: ${titleCase(id)}\ntrigger: ${flags.trigger || 'TODO'}\nsteps:\n  - user -> TODO: Aktion\n  - TODO --> user: Antwort\n---\nTODO: Kurzbeschreibung.\n`;
      } else if (kind === 'guide') {
        const id = slug(name); file = path.join(abs, 'guides', id + '.md');
        content = `---\ntitle: ${name}\norder: ${flags.order || 50}\naudience: ${flags.audience || 'Betrieb'}\n---\nTODO: Schritt für Schritt, mit Befehlen in Codeblöcken.\n`;
      } else if (kind === 'decision') {
        const dir = path.join(abs, 'decisions'); fs.mkdirSync(dir, { recursive: true });
        const n = Math.max(0, ...fs.readdirSync(dir).map((f) => parseInt(f, 10)).filter((x) => !isNaN(x))) + 1;
        file = path.join(dir, `${String(n).padStart(4, '0')}-${slug(name)}.md`);
        content = `---\ntitle: ${name}\ndate: ${new Date().toISOString().slice(0, 10)}\nstatus: accepted\naffects: []\n---\n**Kontext:** TODO\n\n**Entscheidung:** TODO\n\n**Folgen:** TODO\n`;
      } else { console.error(`Unbekannt: ${kind}`); return 1; }
      if (fs.existsSync(file) && !flags.force) { console.error(`Existiert schon: ${path.relative(root, file)}`); return 1; }
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
      out(path.relative(process.cwd(), file));
      return 0;
    }

    case 'init': return init(pos[0] ? path.resolve(pos[0]) : process.cwd(), flags);
    case 'change': case 'changes': return changeCmd(needRoot(), pos, flags, docDir);
    case 'protected': {
      const root = needRoot(); const p = loadProject(root, { docDir, checkPaths: false });
      if (!p.protected.length) { out('Keine geschützten Bereiche (project.md: protected: [...]).'); return 0; }
      out(`Geschützt: ${p.protected.join(', ')}`);
      const files = pos.map((f) => path.relative(root, path.resolve(f)).split(path.sep).join('/'));
      if (files.length) {
        const r = await checkProtected(root, p, files);
        if (r.error) out(`Portal: ${r.error}`);
        for (const f of files) {
          const h = r.hits.find((x) => x.file === f);
          out(h ? `${f}: geschützt (${h.areas.join(', ')})${h.covered && h.covered.length ? ' – genehmigt durch ' + h.covered.join(', ') : ' – kein genehmigter Antrag'}` : `${f}: frei`);
        }
      }
      return 0;
    }
    case 'hook': return hook(pos[0], flags);
    default: console.error(`Unbekannter Befehl "${cmd}".\n\n${HELP}`); return 1;
  }
}

// ───────────────────────── Änderungsanträge ─────────────────────────

const STATUS_DE = { draft: 'Entwurf', proposed: 'beantragt', approved: 'genehmigt', rejected: 'abgelehnt', implemented: 'umgesetzt', cancelled: 'verworfen' };

function setFrontmatterField(file, key, value) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`Kein Frontmatter in ${file}`);
  const lines = m[1].split('\n');
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  if (i >= 0) lines[i] = `${key}: ${value}`; else lines.push(`${key}: ${value}`);
  fs.writeFileSync(file, text.replace(m[0], () => `---\n${lines.join('\n')}\n---`));
}

async function changeCmd(root, pos, flags, docDir) {
  const sub = pos.shift() || 'list';
  const p = loadProject(root, { docDir, checkPaths: false });
  const find = (q) => {
    const c = p.changes.find((x) => x.id === q || x.id.startsWith(String(q).padStart(4, '0') + '-') || x.id.startsWith(q));
    if (!c) throw new Error(`Antrag "${q}" nicht gefunden. Vorhanden: ${p.changes.map((x) => x.id).join(', ') || 'keine'}`);
    return c;
  };
  const payload = (c) => ({ project: p.id, id: c.id, title: c.title, affects: c.affects, risk: c.risk, summary: c.summary, body: c.body, hash: c.hash, status: c.status });
  switch (sub) {
    case 'new': {
      const title = pos.join(' ');
      if (!title) { console.error('doku change new "<titel>" --affects a,b'); return 1; }
      const dir = path.join(root, docDir, 'changes'); fs.mkdirSync(dir, { recursive: true });
      const n = Math.max(0, ...fs.readdirSync(dir).map((f) => parseInt(f, 10)).filter((x) => !isNaN(x))) + 1;
      const id = `${String(n).padStart(4, '0')}-${slug(title)}`;
      const affects = asList(flags.affects);
      const file = path.join(dir, `${id}.md`);
      fs.writeFileSync(file, `---\ntitle: ${title}\nstatus: proposed\ndate: ${new Date().toISOString().slice(0, 10)}\naffects: [${affects.join(', ')}]\nrisk: ${flags.risk || 'mittel'}\n---\n**Warum:** TODO\n\n**Was ändert sich:** TODO (Dateien, Schnittstellen, Daten)\n\n**Risiko und Rückweg:** TODO\n\n**Test:** TODO\n`);
      out(`${path.relative(process.cwd(), file)}\nText ausfüllen, dann: doku change submit ${id.slice(0, 4)}`);
      return 0;
    }
    case 'list': {
      if (!p.changes.length) { out('Keine Änderungen in changes/.'); return 0; }
      for (const c of p.changes) out(`${c.id} [${STATUS_DE[c.status] || c.status}] ${c.title}${c.affects.length ? ' → ' + c.affects.join(', ') : ''}`);
      return 0;
    }
    case 'submit': {
      const c = find(pos[0]);
      if (c.status === 'draft') { setFrontmatterField(path.join(root, c.file), 'status', 'proposed'); c.status = 'proposed'; }
      const r = await portal(root, 'POST', '/api/changes', payload(c));
      out(`Antrag ${c.id} gesendet – Status im Portal: ${STATUS_DE[r.status] || r.status}. Genehmigung erfolgt dort durch einen Menschen (Passkey).`);
      return 0;
    }
    case 'status': {
      const j = await portal(root, 'GET', `/api/changes?project=${encodeURIComponent(p.id)}`);
      const list = pos[0] ? j.changes.filter((x) => x.id === find(pos[0]).id) : j.changes;
      if (!list.length) out('Im Portal liegen keine Anträge für dieses Projekt.');
      for (const x of list) {
        const local = p.changes.find((c) => c.id === x.id);
        const drift = local && local.hash !== x.hash ? ' (lokaler Text weicht ab – erneut senden, Genehmigung gilt nicht mehr)' : '';
        out(`${x.id} [${STATUS_DE[x.status] || x.status}] ${x.title}${x.decidedBy ? ` – ${x.decidedBy}` : ''}${x.comment ? `: ${x.comment}` : ''}${drift}`);
        if (local && !drift && x.status !== local.status && ['approved', 'rejected'].includes(x.status)) setFrontmatterField(path.join(root, local.file), 'status', x.status);
      }
      return 0;
    }
    case 'done': {
      const c = find(pos[0]);
      const file = path.join(root, c.file);
      setFrontmatterField(file, 'status', 'implemented');
      setFrontmatterField(file, 'implemented', new Date().toISOString().slice(0, 10));
      try { await portal(root, 'POST', '/api/changes/done', { project: p.id, id: c.id }); } catch (e) { console.error(`Hinweis: ${e.message}`); }
      out(`${c.id} als umgesetzt markiert.`);
      return 0;
    }
    case 'verify': {
      const changed = changedFiles(root, flags.base).map((x) => x.file);
      const r = await checkProtected(root, p, changed);
      const bad = r.hits.filter((h) => !(h.covered && h.covered.length));
      if (!r.hits.length) { out('Keine geschützten Dateien geändert.'); return 0; }
      if (r.error) { console.error(`Genehmigungen konnten nicht geprüft werden: ${r.error}`); return 1; }
      for (const h of r.hits) out(`${h.file}: ${h.covered.length ? 'genehmigt (' + h.covered.join(', ') + ')' : 'OHNE Genehmigung'} [${h.areas.join(', ')}]`);
      return bad.length ? 1 : 0;
    }
    default: console.error('doku change new|list|submit|status|done|verify'); return 1;
  }
}

// ───────────────────────── Hooks ─────────────────────────

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let s = '';
  for await (const ch of process.stdin) s += ch;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

async function hook(kind, flags) {
  const input = await readStdin();
  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd(), flags.dir || DEFAULT_DOC_DIR);
  if (!root) return 0;
  const st = readState(root);
  const sid = input.session_id || 'default';
  st.sessions ||= {};
  if (kind === 'start') {
    const head = (git(root, ['rev-parse', 'HEAD']) || '').trim();
    if (head && !st.sessions[sid]) st.sessions[sid] = { base: head, t: Date.now() };
    const keep = Object.entries(st.sessions).sort((a, b) => b[1].t - a[1].t).slice(0, 30);
    st.sessions = Object.fromEntries(keep);
    writeState(root, st);
    // Leere Doku (nur Gerüst, z. B. frisch automatisch eingerichtet): Claude soll zuerst dokumentieren.
    try {
      const p = loadProject(root, { docDir: flags.dir || DEFAULT_DOC_DIR, checkPaths: false, git: false });
      if (!p.components.length) {
        const cli = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join('/');
        out([
          `doku: Dieses Repository hat noch keine Architektur-Doku (${p.docDir}/ enthält nur das Gerüst).`,
          `Bevor oder während du die Aufgabe des Nutzers bearbeitest: Lies .claude/skills/doku/SKILL.md und dokumentiere das Projekt (project.md, Bausteine mit files:, Sicherheit, wichtigste Abläufe, Anleitung Installation).`,
          `Überblick über den Code: node ${cli} coverage. Prüfen: node ${cli} check. Committe die Doku mit deiner Arbeit.`,
        ].join('\n'));
      }
    } catch { /* egal */ }
    return 0;
  }
  if (kind === 'pretool') {
    const ti = input.tool_input || {};
    const target = ti.file_path || ti.notebook_path || ti.path;
    if (!target) return 0;
    let p;
    try { p = loadProject(root, { docDir: flags.dir || DEFAULT_DOC_DIR, checkPaths: false, git: false }); } catch { return 0; }
    if (!p.protected.length) return 0;
    const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
    if (rel.startsWith('..')) return 0;
    const r = await checkProtected(root, p, [rel]);
    const h = r.hits[0];
    if (!h || (h.covered && h.covered.length)) return 0;
    const cli = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join('/');
    console.error([
      `doku: ${rel} liegt im geschützten Bereich (${h.areas.join(', ')}). Änderungen hier brauchen einen genehmigten Antrag.`,
      r.error ? `Portal nicht erreichbar: ${r.error}` : 'Es gibt keinen genehmigten Antrag, der diese Datei abdeckt.',
      `1. node ${cli} change new "<Titel>" --affects ${h.areas[0]}  und Warum/Was/Risiko ausfüllen`,
      `2. node ${cli} change submit <nr>  – dann dem Nutzer sagen, dass der Antrag im Portal auf Genehmigung wartet, und hier stoppen.`,
      `3. Nach Genehmigung: node ${cli} change status <nr>, dann weiterarbeiten; am Ende: change done <nr>.`,
    ].join('\n'));
    return 2;
  }
  if (kind !== 'stop') { console.error('doku hook start|stop|pretool'); return 1; }
  if (input.stop_hook_active) {
    st.ack = [...new Set([...(st.ack || []), ...(st.pending || [])])].slice(-500);
    st.pending = []; writeState(root, st);
    return 0;
  }
  let p;
  try { p = loadProject(root, { docDir: flags.dir || DEFAULT_DOC_DIR }); } catch (e) { console.error(`doku: ${e.message}`); return 0; }
  const errors = p.issues.filter((i) => i.level === 'error');
  let base = st.sessions[sid]?.base;
  if (base && git(root, ['merge-base', '--is-ancestor', base, 'HEAD']) == null) base = undefined;
  const r = reviewChanges(p, root, base);
  const ack = new Set(st.ack || []);
  const stale = r.stale.map((s) => ({ ...s, files: s.files.filter((f) => !ack.has(`stale:${s.comp.id}:${f}`)) })).filter((s) => s.files.length);
  const uncovered = r.uncovered.filter((f) => !ack.has(`uncovered:${f}`));
  let unapproved = [];
  if (p.protected.length) {
    const pr = await checkProtected(root, p, r.changes.map((c) => c.file));
    unapproved = pr.hits.filter((h) => !(h.covered && h.covered.length)).filter((h) => !ack.has(`prot:${h.file}`));
  }
  if (!errors.length && !stale.length && !uncovered.length && !unapproved.length) return 0;
  const cli = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const L = [`doku: Bitte Architektur-Doku (${p.docDir}/) prüfen. Ist nichts zu tun, einfach erneut beenden.`];
  const cap = (arr, n = 8) => (arr.length > n ? [...arr.slice(0, n), `… +${arr.length - n}`] : arr);
  if (errors.length) { L.push('Fehler:'); cap(errors.map((e) => `  ${e.file}: ${e.msg}`)).forEach((x) => L.push(x)); }
  if (stale.length) { L.push('Neue/gelöschte Dateien oder Manifeste, Doku unverändert:'); cap(stale.map((s) => `  ${s.comp.id} (${s.comp.file}): ${cap(s.files, 5).join(' ')}`)).forEach((x) => L.push(x)); }
  if (uncovered.length) { L.push('Keiner Komponente zugeordnet (path ergänzen oder neue Komponente):'); L.push('  ' + cap(uncovered, 10).join(' ')); }
  if (unapproved.length) { L.push('Geschützte Dateien ohne genehmigten Antrag geändert (rückgängig machen oder Antrag stellen: change new/submit):'); L.push('  ' + cap(unapproved.map((h) => h.file), 10).join(' ')); }
  L.push(`Hilfe: node ${cli} context <datei> | summary | check`);
  st.pending = [...stale.flatMap((s) => s.files.map((f) => `stale:${s.comp.id}:${f}`)), ...uncovered.map((f) => `uncovered:${f}`), ...unapproved.map((h) => `prot:${h.file}`)];
  writeState(root, st);
  console.error(L.join('\n'));
  return 2;
}

// ───────────────────────── init ─────────────────────────

function init(target, flags) {
  const tpl = path.resolve(CLI_DIR, '../templates');
  if (!fs.existsSync(tpl)) { console.error('Vorlagen nicht gefunden: "init" nur aus dem dokusystem-Repo ausführen.'); return 1; }
  if (!fs.existsSync(target)) { console.error(`Ziel existiert nicht: ${target}`); return 1; }
  const docDir = flags.dir || DEFAULT_DOC_DIR;
  const done = [];
  const rel = (p) => path.relative(target, p) || '.';
  const put = (dest, content, { overwrite = false } = {}) => {
    if (fs.existsSync(dest) && !overwrite) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content); done.push(rel(dest));
  };
  const cliRel = '.claude/doku/doku.mjs';
  const fill = (s) => s.replaceAll('{{DOKU}}', `node ${cliRel}`).replaceAll('{{DOKU_PATH}}', cliRel).replaceAll('{{DOC_DIR}}', docDir)
    .replaceAll('{{PROJECT_ID}}', slug(path.basename(target))).replaceAll('{{PROJECT_NAME}}', titleCase(slug(path.basename(target))));
  // CLI (immer aktualisieren)
  put(path.join(target, cliRel), fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'), { overwrite: true });
  try { fs.chmodSync(path.join(target, cliRel), 0o755); } catch { /* egal */ }
  // Skill
  put(path.join(target, '.claude/skills/doku/SKILL.md'), fill(fs.readFileSync(path.join(tpl, 'skill/SKILL.md'), 'utf8')), { overwrite: true });
  // Doku-Gerüst
  const abs = path.join(target, docDir);
  if (!fs.existsSync(path.join(abs, 'project.md'))) put(path.join(abs, 'project.md'), fill(fs.readFileSync(path.join(tpl, 'project.md'), 'utf8')));
  for (const d of ['components', 'flows', 'decisions', 'guides', 'changes']) fs.mkdirSync(path.join(abs, d), { recursive: true });
  // Hooks in .claude/settings.json zusammenführen
  const sp = path.join(target, '.claude/settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { /* neu */ }
  settings.hooks ||= {};
  const addHook = (event, command) => {
    settings.hooks[event] ||= [];
    const exists = settings.hooks[event].some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('doku.mjs')));
    if (!exists) settings.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 30 }] });
  };
  addHook('SessionStart', `node "$CLAUDE_PROJECT_DIR/${cliRel}" hook start`);
  addHook('Stop', `node "$CLAUDE_PROJECT_DIR/${cliRel}" hook stop`);
  settings.hooks.PreToolUse ||= [];
  if (!settings.hooks.PreToolUse.some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('doku.mjs')))) {
    settings.hooks.PreToolUse.push({ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${cliRel}" hook pretool`, timeout: 15 }] });
  }
  fs.mkdirSync(path.dirname(sp), { recursive: true }); fs.writeFileSync(sp, JSON.stringify(settings, null, 2) + '\n'); done.push(rel(sp));
  // CLAUDE.md
  const cm = path.join(target, 'CLAUDE.md');
  const snippet = fill(fs.readFileSync(path.join(tpl, 'CLAUDE.snippet.md'), 'utf8'));
  const cur = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
  if (!cur.includes('<!-- doku -->')) { fs.writeFileSync(cm, (cur ? cur.trimEnd() + '\n\n' : '') + snippet); done.push(rel(cm)); }
  // CI
  if (!flags['no-ci']) put(path.join(target, '.github/workflows/doku.yml'), fill(fs.readFileSync(path.join(tpl, 'github-workflow.yml'), 'utf8')));
  out(`doku installiert in ${target}:\n  ${done.join('\n  ')}\n\nNächster Schritt: Claude bitten "Dokumentiere dieses Projekt mit doku".`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code ?? 0), (e) => { console.error(process.env.DOKU_DEBUG ? e.stack : `doku: ${e.message}`); process.exit(1); });
}
