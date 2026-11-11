/* Road to 2000 — CP tracker. Plain JS, no build step.
   Data: sheet.json (static plan) + state (your logs) synced to data/state.json + data/STATUS.md in this same repo (cp-tracker) via the GitHub API.
   Everything numeric (practice rating, XP, gold, HP, streak) is DERIVED from the attempt log, so merging two devices
   is just a union of attempts. */
'use strict';

// ---------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const isoLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
const fmtShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short'});
const mmss = s => `${Math.floor(s/60)}:${pad(Math.floor(s%60))}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rk = r => !r ? 0 : r < 1200 ? 1 : r < 1400 ? 2 : r < 1600 ? 3 : r < 1900 ? 4 : r < 2100 ? 5 : 6;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoLocal(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function toast(msg, big = false) {
  const t = document.createElement('div'); t.className = 'toast' + (big ? ' big' : ''); t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); toast(ok ? 'Copied to clipboard' : 'Copy failed — select the text manually'); return ok;
  }
}
const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(bin); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

// ---------------------------------------------------------------- constants
const SPECIAL = new Set(['notes', 'lecture', 'edu', 'mock', 'contest']);
const MILESTONES = [[600, 'Hint 1 time — ask for a direction, not the solution'], [1020, 'Hint 2 time — ask for the key observation'], [1500, 'Editorial time — read it, then code it yourself']];
const OUTCOMES = {
  solved:    {label: 'Solved alone', pill: 'solved'},
  hint:      {label: 'Solved after hint(s)', pill: 'hint'},
  editorial: {label: 'Needed the editorial', pill: 'editorial'},
  gaveup:    {label: 'Not solved yet', pill: 'gaveup'},
};
const MISTAKES = ['none', 'wrong idea / missed observation', 'implementation bug', 'TLE / complexity', 'edge case', 'misread statement', 'overflow / types'];
const AI_SOURCES = ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Other'];

// ---------------------------------------------------------------- state
let SHEET = null, ITEMS = new Map(), ORDER = [], BLOCK_TITLE = {};
const DEFAULT_STATE = () => ({v: 1, items: {}, synced: {}, rewards: [{id: 'r1', name: '1 episode / 30 min break', cost: 60}], redeemed: [], grace: [], graceLog: [], reviews: [], updatedAt: 0});
// Grace days: legacy `grace` list plus an append-only log, so a mistaken grace day can be undone on every device.
function graceDays() {
  const m = new Map(); (state.grace || []).forEach(d => m.set(d, {on: true, at: 0}));
  (state.graceLog || []).slice().sort((a, b) => a.at - b.at).forEach(e => m.set(e.date, {on: e.on, at: e.at}));
  return [...m].filter(([, v]) => v.on).map(([d]) => d).sort();
}
let state = LS.get('cpt.state', null) || DEFAULT_STATE();
let cfg = Object.assign({owner: '', repo: 'cp-tracker', branch: 'main', token: '', cf: 'Heavenly_Restriction', ac: 'Distant_Horizons', initRating: 1100, dailyTarget: 6}, LS.get('cpt.cfg', {}));
// one-time migration: the data and solutions repos were merged into cp-tracker
if (cfg.repo === 'cp-tracker-data' || cfg.solRepo === 'cp-tracker-solutions' || cfg.solRepo === 'cp-tracker-data') {
  if (cfg.repo === 'cp-tracker-data') cfg.repo = 'cp-tracker';
  if (cfg.solRepo === 'cp-tracker-solutions' || cfg.solRepo === 'cp-tracker-data') cfg.solRepo = '';
  LS.set('cpt.cfg', cfg);
}
let timer = LS.get('cpt.timer', null);   // {id, startedAt, acc, running, hints:[], editorial:false, wa:0, alerted:[]}
let D = null;                            // derived data
let tab = LS.get('cpt.tab', 'today');
let syncState = {status: 'idle', msg: ''};

function itemState(id) { return state.items[id] || (state.items[id] = {attempts: [], analyses: []}); }
function touch() { state.updatedAt = Date.now(); LS.set('cpt.state', state); scheduleSync(); }

// ---------------------------------------------------------------- derivation
function scoreOf(a, it) {
  if (a.outcome === 'solved') { const est = it.m || 25, t = a.sec / 60; return t <= est ? 1 : t <= est * 1.5 ? 0.85 : 0.75; }
  if (a.outcome === 'hint') return a.hints?.includes(2) ? 0.4 : 0.6;
  if (a.outcome === 'editorial') return 0.1;
  return 0;
}
function topicOf(it) {
  if (it.b && /^[BL]\d/.test(it.b)) return BLOCK_TITLE[it.b] || it.b;
  if (it.k === 'retest') return 'Retests';
  if (it.t?.length) { const pri = ['dp','graphs','trees','data structures','number theory','binary search','constructive algorithms','greedy','math','strings','bitmasks','two pointers','combinatorics','sortings','brute force','implementation']; return 'tag: ' + (pri.find(p => it.t.includes(p)) || it.t[0]); }
  return it.p === 'AC' ? 'AtCoder mixed' : 'Mixed';
}
function derive() {
  const today = isoLocal();
  const att = [];
  for (const [id, s] of Object.entries(state.items)) for (const a of s.attempts || []) att.push({...a, id});
  att.sort((x, y) => x.end - y.end);
  let R = +cfg.initRating || 1100, n = 0, xp = 0, gold = 0;
  const ratingHist = [], perDay = {}, perItem = {}, dRmap = {};
  for (const a of att) {
    const it = ITEMS.get(a.id) || {r: a.r || 0, m: 25, k: 'core'};
    const day = isoLocal(new Date(a.end));
    const sc = scoreOf(a, it);
    if (it.r > 0 && !SPECIAL.has(it.k)) {
      const E = 1 / (1 + Math.pow(10, (it.r - R) / 400));
      const K = n < 50 ? 40 : 24;
      a.dR = K * (sc - E); dRmap[a.id] = a.dR; R += a.dR; n++;
      ratingHist.push({t: a.end, day, R, id: a.id});
    }
    const gain = Math.round(Math.max(8, (it.r || 1000) / 20) * Math.max(sc, 0.15));
    xp += gain; gold += gain / 5;
    const pd = perDay[day] ||= {solved: 0, min: 0, att: 0};
    pd.att++; pd.min += a.sec / 60; if (a.outcome !== 'gaveup') pd.solved++;
    perItem[a.id] = a;
  }
  // synced solves (solved on CF/AtCoder without a logged attempt) count toward the day but not the rating
  for (const [id, s] of Object.entries(state.synced)) {
    if (s.off) continue;
    if (perItem[id]) continue;
    const pd = perDay[s.day] ||= {solved: 0, min: 0, att: 0}; pd.solved++;
    const it = ITEMS.get(id); if (it) { xp += Math.round(Math.max(8, it.r / 20) * 0.7); gold += Math.max(8, it.r / 20) * 0.14; }
  }
  // manual completions of notes/videos/contests
  for (const [id, s] of Object.entries(state.items)) if (s.done && s.doneAt) {
    const it = ITEMS.get(id); const day = isoLocal(new Date(s.doneAt));
    const g = it?.k === 'mock' || it?.k === 'contest' ? 60 : 20; xp += g; gold += g / 5;
    (perDay[day] ||= {solved: 0, min: 0, att: 0});
  }
  // HP & streak replay, from plan start to yesterday
  const blocked = new Set(SHEET.meta.blocked), grace = new Set(graceDays());
  let hp = 50, streak = 0, best = 0, faints = 0;
  const start = SHEET.meta.start, target = +cfg.dailyTarget || 6;
  const first = att.length ? isoLocal(new Date(att[0].end)) : today;
  for (let d = (first < start ? first : start); d < today; d = addDays(d, 1)) {
    if (d < start && !perDay[d]) continue;
    const s = perDay[d]?.solved || 0;
    if (blocked.has(d) || grace.has(d)) continue;
    if (s >= target) { streak++; best = Math.max(best, streak); hp = Math.min(50, hp + 5); }
    else { streak = 0; hp -= s >= target / 2 ? 5 : 10; if (hp <= 0) { faints++; gold *= 0.5; hp = 50; } }
  }
  const todaySolved = perDay[today]?.solved || 0;
  if (todaySolved >= target) streak++;
  gold -= state.redeemed.reduce((a, r) => a + r.cost, 0);
  const level = Math.floor(Math.sqrt(xp / 60)) + 1, lvBase = 60 * (level - 1) ** 2, lvNext = 60 * level ** 2;
  // statuses
  const status = {};
  for (const id of ORDER) {
    const it = ITEMS.get(id), s = state.items[id];
    if (s?.skipped) status[id] = 'skipped';
    else if (perItem[id]) status[id] = perItem[id].outcome;
    else if (state.synced[id] && !state.synced[id].off) status[id] = 'synced';
    else if (s?.done) status[id] = 'done';
    else status[id] = null;
  }
  const isDone = id => { const st = status[id]; return st && st !== 'gaveup'; };
  // revisit queue: last attempt editorial/gaveup -> due 3 days later; cleared by a later clean/hint solve
  const revisit = [];
  for (const [id, a] of Object.entries(perItem)) if (a.outcome === 'editorial' || a.outcome === 'gaveup') {
    const due = addDays(isoLocal(new Date(a.end)), 3); revisit.push({id, due, overdue: due <= today});
  }
  revisit.sort((x, y) => x.due.localeCompare(y.due));
  // plan position
  let planDay = SHEET.days.find(d => d.it.some(i => !isDone(i.id) && status[i.id] !== 'skipped')) || SHEET.days[SHEET.days.length - 1];
  let calDay = 0; for (let d = start; d <= today; d = addDays(d, 1)) if (!blocked.has(d) && !grace.has(d)) calDay++;
  // topic stats
  const topics = {};
  for (const a of att) {
    const it = ITEMS.get(a.id); if (!it || SPECIAL.has(it.k)) continue;
    const tp = topicOf(it), T = topics[tp] ||= {n: 0, clean: 0, hint: 0, ed: 0, fail: 0, ratio: 0, rsum: 0, mistakes: {}};
    T.n++; T.rsum += it.r || 0; T.ratio += (a.sec / 60) / (it.m || 25);
    if (a.outcome === 'solved') T.clean++; else if (a.outcome === 'hint') T.hint++; else if (a.outcome === 'editorial') T.ed++; else T.fail++;
    if (a.mistake && a.mistake !== 'none') T.mistakes[a.mistake] = (T.mistakes[a.mistake] || 0) + 1;
  }
  // projection to 1600 from the last 21 days of rating history
  let proj = null;
  const recent = ratingHist.filter(h => daysBetween(h.day, today) <= 21);
  if (recent.length >= 8) {
    const xs = recent.map(h => (h.t - recent[0].t) / 864e5), ys = recent.map(h => h.R);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const slope = den ? num / den : 0;
    if (R >= 1600) proj = {done: true};
    else if (slope > 0.5) proj = {date: addDays(today, Math.ceil((1600 - R) / slope)), slope};
    else proj = {flat: true, slope};
  }
  D = {dRmap, att, R, n, xp, gold: Math.max(0, Math.floor(gold)), level, lvBase, lvNext, hp, streak, best, faints, perDay, perItem, status,
       isDone, revisit, planDay, calDay, topics, ratingHist, proj, todaySolved, target, today};
  return D;
}

// ---------------------------------------------------------------- GitHub sync (data/ in the app repo)
const GH = {
  headers() { return {'Authorization': `Bearer ${cfg.token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}; },
  url(path, repo = cfg.repo) { return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; },
  async get(path, repo) {
    const r = await fetch(this.url(path, repo) + `?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {headers: this.headers(), cache: 'no-store'});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
    const j = await r.json(); return {text: b64dec(j.content), sha: j.sha};
  },
  async put(path, text, sha, message, repo) {
    const body = {message, content: b64enc(text), branch: cfg.branch}; if (sha) body.sha = sha;
    const r = await fetch(this.url(path, repo), {method: 'PUT', headers: {...this.headers(), 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
    return (await r.json()).content.sha;
  },
};
function mergeStates(a, b) {
  const out = DEFAULT_STATE();
  out.rewards = (a.updatedAt >= b.updatedAt ? a : b).rewards;
  const ids = new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})]);
  for (const id of ids) {
    const x = a.items?.[id] || {}, y = b.items?.[id] || {};
    const byId = (arr1 = [], arr2 = []) => { const m = new Map(); [...arr1, ...arr2].forEach(o => m.set(o.id, o)); return [...m.values()].sort((p, q) => (p.end || p.at) - (q.end || q.at)); };
    const newer = (x.updatedAt || 0) >= (y.updatedAt || 0) ? x : y;
    out.items[id] = {attempts: byId(x.attempts, y.attempts), analyses: byId(x.analyses, y.analyses), solutions: byId(x.solutions, y.solutions),
                     skipped: newer.skipped || false, done: x.done || y.done || false, doneAt: x.doneAt || y.doneAt, updatedAt: newer.updatedAt || 0};
  }
  out.synced = {...(b.synced || {}), ...(a.synced || {})};
  const uni = (p = [], q = [], key = 'id') => { const m = new Map(); [...p, ...q].forEach(o => m.set(typeof o === 'string' ? o : o[key], o)); return [...m.values()]; };
  out.redeemed = uni(a.redeemed, b.redeemed); out.grace = uni(a.grace, b.grace).sort(); out.graceLog = uni(a.graceLog, b.graceLog); out.reviews = uni(a.reviews, b.reviews);
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}
let shaState = LS.get('cpt.sha', null), syncTimer = null, syncing = false;
function scheduleSync() { clearTimeout(syncTimer); if (cfg.token && cfg.owner) syncTimer = setTimeout(() => syncNow(), 4000); }
function setSync(status, msg = '') { syncState = {status, msg}; renderChips(); }
async function syncNow(force = false) {
  if (!cfg.token || !cfg.owner || !cfg.repo) { setSync('idle', 'Sync not set up'); return; }
  if (syncing) return; syncing = true; setSync('busy', 'Syncing…');
  try {
    for (let tries = 0; tries < 3; tries++) {
      const remote = await GH.get('data/state.json');
      let merged = state;
      if (remote) { merged = mergeStates(state, JSON.parse(remote.text)); }
      const text = JSON.stringify(merged);
      const changed = !remote || remote.text !== text;
      state = merged; LS.set('cpt.state', state);
      if (changed || force) {
        try { shaState = await GH.put('data/state.json', text, remote?.sha, `log ${new Date().toISOString()}`); }
        catch (e) { if (e.conflict) continue; throw e; }
        derive();
        const st = await GH.get('data/STATUS.md');
        const md = statusMd();
        if (!st || st.text !== md) await GH.put('data/STATUS.md', md, st?.sha, 'status update');
      } else shaState = remote.sha;
      LS.set('cpt.sha', shaState);
      break;
    }
    LS.set('cpt.lastSync', Date.now());
    setSync('ok', 'Synced ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
    render();
  } catch (e) { setSync('err', e.message); }
  finally { syncing = false; }
}

// ---------------------------------------------------------------- Codeforces / AtCoder autosync (free, runs in your browser)
async function autosync(manual = false) {
  const last = LS.get('cpt.lastAuto', 0);
  if (!manual && Date.now() - last < 30 * 60 * 1000) return;
  let added = 0;
  try {
    if (cfg.cf) {
      const r = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(cfg.cf)}&from=1&count=${last ? 300 : 10000}`);
      const j = await r.json();
      if (j.status === 'OK') for (const s of j.result) {
        const day = isoLocal(new Date(s.creationTimeSeconds * 1000));
        if (s.verdict === 'OK') {
          const key = `${s.problem.contestId}${s.problem.index}`;
          const id = ITEMS.has(`CF:${key}`) ? `CF:${key}` : gymIndex().get(key);   // gym mirrors (e.g. CSES on Codeforces)
          if (id && ITEMS.has(id) && !state.synced[id]) { state.synced[id] = {day, src: 'Codeforces'}; added++; }
        }
        if (s.author?.participantType === 'VIRTUAL' || s.author?.participantType === 'CONTESTANT') {
          const mid = `MOCK:${s.problem.contestId}`;
          if (ITEMS.has(mid) && !state.items[mid]?.done) { const x = itemState(mid); x.done = true; x.doneAt = s.creationTimeSeconds * 1000; x.updatedAt = Date.now(); added++; }
        }
      }
    }
    if (cfg.ac) {
      const from = last ? Math.floor(last / 1000) - 86400 : 0;
      const r = await fetch(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(cfg.ac)}&from_second=${from}`);
      const j = await r.json();
      if (Array.isArray(j)) for (const s of j) if (s.result === 'AC') {
        const id = `AC:${s.problem_id}`;
        if (ITEMS.has(id) && !state.synced[id]) { state.synced[id] = {day: isoLocal(new Date(s.epoch_second * 1000)), src: 'AtCoder'}; added++; }
      }
    }
    try { added += await syncExternal(); } catch (e) { if (manual) toast('LeetCode/GFG sync failed: ' + e.message); }
    LS.set('cpt.lastAuto', Date.now());
    if (added) { touch(); render(); }
    if (manual) toast(added ? `Found ${added} new solve${added > 1 ? 's' : ''}` : 'No new solves found');
  } catch (e) { if (manual) toast('Codeforces/AtCoder sync failed: ' + e.message); }
}
let GYM_INDEX = null;
function gymIndex() {
  if (GYM_INDEX) return GYM_INDEX;
  GYM_INDEX = new Map();
  for (const it of ITEMS.values()) { const m = (it.u || '').match(/codeforces\.com\/gym\/(\d+)\/problem\/(\w+)/); if (m) GYM_INDEX.set(m[1] + m[2], it.id); }
  return GYM_INDEX;
}
// LeetCode + GFG: browsers can't call those sites directly, so a GitHub Action in this repo fetches them
// every few hours into data/external.json; the app reads that file through the API with your token.
const normName = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
const parenName = s => { const m = String(s || '').match(/\((.*?)\)/); return m ? normName(m[1]) : ''; };
let GFG_INDEX = null;
function gfgIndex() {
  if (GFG_INDEX) return GFG_INDEX;
  GFG_INDEX = new Map();
  for (const it of ITEMS.values()) if (it.p === 'GFG' && it.k !== 'retest') [normName(it.n), parenName(it.n)].filter(Boolean).forEach(k => GFG_INDEX.set(k, it.id));
  return GFG_INDEX;
}
async function syncExternal() {
  if (!cfg.token || !cfg.owner) return 0;
  const f = await GH.get('data/external.json'); if (!f) return 0;
  const ext = JSON.parse(f.text); let added = 0;
  const dayOf = ts => isoLocal(new Date((ts || Date.now() / 1000) * 1000));
  for (const [slug, v] of Object.entries(ext.leetcode || {})) {
    const id = 'LC:' + slug;
    if (ITEMS.has(id) && !state.synced[id]) { state.synced[id] = {day: dayOf(v.ts), src: 'LeetCode'}; added++; }
  }
  const gi = gfgIndex();
  for (const [slug, v] of Object.entries(ext.gfg || {})) {
    const keys = [normName(v.name), normName(slug.replace(/\d+$/, '').replace(/-/g, ' '))];
    const id = keys.map(k => gi.get(k)).find(Boolean);
    if (id && !state.synced[id]) { state.synced[id] = {day: dayOf(v.ts), src: 'GFG'}; added++; }
  }
  LS.set('cpt.extRun', ext.lastRun || null);
  return added;
}

// ---------------------------------------------------------------- timer
let tick = null, audioCtx = null;
function beep() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.2, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.6); } catch {}
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
}
const elapsed = () => !timer ? 0 : timer.acc + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);
function saveTimer() { LS.set('cpt.timer', timer); }
function startTimer(id) {
  timer = {id, startedAt: Date.now(), acc: 0, running: true, hints: [], editorial: false, wa: 0, alerted: [], began: Date.now()};
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {}
  saveTimer(); tab = 'today'; render(); runTick();
}
function runTick() {
  clearInterval(tick);
  if (!timer) return;
  tick = setInterval(() => {
    const s = elapsed();
    const c = $('#clock'); if (c) c.textContent = mmss(s);
    const rc = $('#rowclock'); if (rc) rc.textContent = mmss(s);
    if (timer.running) renderTimerMs();
    for (const [t, msg] of MILESTONES) if (s >= t && !timer.alerted.includes(t)) {
      timer.alerted.push(t); saveTimer(); beep(); const b = $('#tbanner'); if (b) { b.textContent = msg; b.hidden = false; }
      document.title = '⏰ ' + msg.split(' —')[0]; setTimeout(() => document.title = 'Road to 2000', 8000);
    }
  }, 1000);
}
function pauseTimer() { if (!timer) return; if (timer.running) { timer.acc = elapsed(); timer.running = false; } else { timer.startedAt = Date.now(); timer.running = true; } saveTimer(); render(); }
function discardTimer() { timer = null; saveTimer(); clearInterval(tick); render(); }

// ---------------------------------------------------------------- AI packs
function shortStatus() {
  const d = D, weak = Object.entries(d.topics).filter(([, T]) => T.n >= 3).map(([k, T]) => [k, (T.clean + 0.5 * T.hint) / T.n]).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const mist = {}; Object.values(d.topics).forEach(T => Object.entries(T.mistakes).forEach(([m, c]) => mist[m] = (mist[m] || 0) + c));
  const topM = Object.entries(mist).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${m} (${c})`).join(', ') || 'none logged yet';
  return `- Practice rating (Elo-style, from my logged solves): ${Math.round(d.R)} after ${d.n} rated attempts; target is Codeforces Expert (1600).
- Plan position: day ${d.planDay.n} of the sheet (${d.planDay.ph}); calendar says day ${d.calDay}.
- Weakest topics so far: ${weak.map(([k, v]) => `${k} (${Math.round(v * 100)}% clean-ish)`).join('; ') || 'not enough data yet'}.
- Most common mistakes: ${topM}.
- Language: C++. I want to learn the pattern, so guide me with hints, not full solutions.`;
}
function itemHistory(id) {
  const s = state.items[id]; if (!s) return 'No previous attempts.';
  const lines = (s.attempts || []).map(a => `- ${new Date(a.end).toLocaleDateString('en-GB')}: ${OUTCOMES[a.outcome]?.label}, ${Math.round(a.sec / 60)} min, hints used: ${a.hints?.length ? a.hints.join('+') : 'none'}${a.editorial ? ', read editorial' : ''}, WA: ${a.wa || 0}, mistake: ${a.mistake || 'n/a'}. My notes: ${a.notes || '(none)'}`);
  const an = (s.analyses || []).map(x => `- Analysis from ${x.source} on ${new Date(x.at).toLocaleDateString('en-GB')}:\n${x.text.trim().split('\n').map(l => '    ' + l).join('\n')}`);
  return [...lines, ...an].join('\n') || 'No previous attempts.';
}
function aiPack(id) {
  const it = ITEMS.get(id), live = timer && timer.id === id;
  const s = live ? elapsed() : 0;
  const ask = !live ? 'Give me the smallest useful hint.' : s >= 1500 ? 'I hit my 25-minute limit: walk me through the editorial idea step by step, then let me code it.' : s >= 1020 ? 'I am at hint 2: tell me the key observation, but not the full algorithm.' : s >= 600 ? 'I am at hint 1: give me a direction only (what to think about), not the solution.' : 'I am early in the attempt; only nudge me if my approach below is clearly wrong.';
  return `You are my competitive-programming coach. Coach with hints, not full solutions, unless I explicitly ask.

## About me
${shortStatus()}

## Problem
- ${it.n} — ${({CF:'Codeforces',LC:'LeetCode',GFG:'GeeksforGeeks',CSES:'CSES',AC:'AtCoder',USACO:'USACO'})[it.p] || it.p}, estimated CF rating ${it.r || 'n/a'}
- Link: ${it.u || '(search the name)'}
- If you can't open the link, ask me to paste the statement.

## My current attempt
- Time so far: ${live ? mmss(s) : 'not started'}${live ? `, hints used: ${timer.hints.join('+') || 'none'}, WA so far: ${timer.wa}` : ''}
- My thinking so far: ${$('#tnotes')?.value?.trim() || '(I will describe it below)'}

## My history on this problem
${itemHistory(id)}

## What I need now
${ask}

## When we finish (important)
End your final reply with this block filled in, exactly in this format, so I can paste it into my tracker:
\`\`\`ANALYSIS
problem: ${id}
understanding: <how I understood the problem and where my model was wrong>
stuck_on: <the exact point I got stuck>
key_idea: <the core observation/technique in one or two lines>
mistake_type: <one of: ${MISTAKES.join(' | ')}>
practice_next: <1-2 concrete things/problem types to practise>
confidence: <1-5, how well I now understand it>
\`\`\``;
}
function weeklyPack() {
  const since = Date.now() - 7 * 864e5;
  const rows = D.att.filter(a => a.end >= since).map(a => { const it = ITEMS.get(a.id) || {}; return `- ${new Date(a.end).toLocaleDateString('en-GB')} | ${it.n} (${it.p}, ${it.r}) | ${Math.round(a.sec / 60)}/${it.m} min | ${OUTCOMES[a.outcome]?.label}${a.hints?.length ? ' hints:' + a.hints.join('+') : ''} | mistake: ${a.mistake || '-'} | notes: ${(a.notes || '').replace(/\n/g, ' ').slice(0, 220)}`; });
  return `You are my competitive-programming coach doing my weekly review. My goal: Codeforces Expert (1600). Below is my status file and every attempt from the last 7 days.

${statusMd()}

## Attempts in the last 7 days
${rows.join('\n') || '(none)'}

Please: (1) diagnose patterns in my mistakes and time usage, (2) say which topics need extra problems or a revisit, (3) suggest concrete changes to next week (pace, which blocks to slow down/speed up, contest strategy).
End with this block so I can paste it into my tracker:
\`\`\`REVIEW
week_ending: ${D.today}
summary: <3-4 lines>
weak_spots: <list>
change_next_week: <list of concrete changes>
\`\`\``;
}
function parseBlock(text, kind) {
  const m = text.match(new RegExp('```\\s*' + kind + '\\s*\\n([\\s\\S]*?)```', 'i'));
  const body = (m ? m[1] : text).trim();
  const fields = {}; body.split('\n').forEach(l => { const k = l.match(/^([a-z_]+):\s*(.*)$/i); if (k) fields[k[1].toLowerCase()] = k[2]; });
  return {body, fields};
}

// ---------------------------------------------------------------- STATUS.md
function statusMd() {
  const d = D; const lines = [];
  lines.push(`# CP status — Harshith (C++)`, `_Updated ${new Date().toLocaleString('en-GB')}. Generated by the Road to 2000 tracker from my attempt log. Any AI coaching me should read this first._`, '');
  lines.push('## Snapshot',
    `- Practice rating: **${Math.round(d.R)}** (${d.n} rated attempts; Elo-style vs estimated CF problem ratings). Goal: Codeforces Expert 1600.`,
    `- Projection: ${d.proj?.done ? 'already at 1600 practice level' : d.proj?.date ? `reaches 1600 around ${fmtShort(d.proj.date)} at the current trend (+${d.proj.slope.toFixed(1)}/day)` : 'not enough recent data / trend flat'}`,
    `- Plan: on sheet day ${d.planDay.n} (${d.planDay.ph}); calendar day ${d.calDay}; grace days used ${graceDays().length}/${SHEET.meta.grace_days}.`,
    `- Level ${d.level} · ${d.xp} XP · ${d.gold} gold · HP ${d.hp}/50 · streak ${d.streak} (best ${d.best}) · daily target ${d.target} problems`,
    `- Solved/logged: ${Object.values(d.status).filter(s => s && s !== 'gaveup' && s !== 'skipped').length} sheet items done.`, '');
  lines.push('## Topics (logged attempts)', '| Topic | Attempts | Clean | Hint | Editorial | Unsolved | Avg time vs estimate | Avg rating |', '|---|---|---|---|---|---|---|---|');
  Object.entries(d.topics).sort((a, b) => b[1].n - a[1].n).forEach(([k, T]) => lines.push(`| ${k} | ${T.n} | ${T.clean} | ${T.hint} | ${T.ed} | ${T.fail} | ${(T.ratio / T.n).toFixed(2)}× | ${Math.round(T.rsum / T.n)} |`));
  lines.push('');
  const mist = {}; Object.values(d.topics).forEach(T => Object.entries(T.mistakes).forEach(([m, c]) => mist[m] = (mist[m] || 0) + c));
  lines.push('## Recurring mistakes', ...(Object.entries(mist).sort((a, b) => b[1] - a[1]).map(([m, c]) => `- ${m}: ${c}`)), Object.keys(mist).length ? '' : '- none logged yet', '');
  lines.push('## Revisit queue', ...(d.revisit.slice(0, 15).map(r => `- ${ITEMS.get(r.id)?.n || r.id} — due ${fmtShort(r.due)}`)), d.revisit.length ? '' : '- empty', '');
  lines.push('## Recent attempts (newest first)');
  d.att.slice(-25).reverse().forEach(a => { const it = ITEMS.get(a.id) || {}; lines.push(`- ${new Date(a.end).toLocaleDateString('en-GB')} · ${it.n} (${it.p} ${it.r}) · ${Math.round(a.sec / 60)}/${it.m} min · ${OUTCOMES[a.outcome]?.label}${a.hints?.length ? ' (hints ' + a.hints.join('+') + ')' : ''}${a.mistake && a.mistake !== 'none' ? ' · ' + a.mistake : ''}${a.notes ? ' — ' + a.notes.replace(/\n+/g, ' ').slice(0, 200) : ''}`); });
  if (!d.att.length) lines.push('- none yet');
  lines.push('', '## AI analyses (newest first)');
  const an = []; for (const [id, s] of Object.entries(state.items)) for (const x of s.analyses || []) an.push({...x, id});
  an.sort((a, b) => b.at - a.at).slice(0, 20).forEach(x => lines.push(`### ${ITEMS.get(x.id)?.n || x.id} — ${x.source}, ${new Date(x.at).toLocaleDateString('en-GB')}`, x.text.trim(), ''));
  if (!an.length) lines.push('- none yet', '');
  lines.push('## Weekly reviews (newest first)');
  [...state.reviews].sort((a, b) => b.at - a.at).slice(0, 4).forEach(r => lines.push(`### ${r.source}, ${new Date(r.at).toLocaleDateString('en-GB')}`, r.text.trim(), ''));
  if (!state.reviews.length) lines.push('- none yet', '');
  lines.push('## How to coach me', '- Give the smallest next hint; never a full solution unless I ask.', '- At the end of a problem, output an ANALYSIS block (problem, understanding, stuck_on, key_idea, mistake_type, practice_next, confidence) so I can log it.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- rendering
const RANKS = [
  {name: 'Newbie', lo: 0, hi: 1200, v: '--r-newbie'}, {name: 'Pupil', lo: 1200, hi: 1400, v: '--r-pupil'},
  {name: 'Specialist', lo: 1400, hi: 1600, v: '--r-spec'}, {name: 'Expert', lo: 1600, hi: 1900, v: '--r-expert'},
  {name: 'Candidate Master', lo: 1900, hi: 2100, v: '--r-cm'}, {name: 'Master', lo: 2100, hi: 9999, v: '--r-master'},
];
const rankOf = r => RANKS.find(x => r >= x.lo && r < x.hi) || RANKS[0];
const rcol = r => `var(${r ? rankOf(r).v : '--dim'})`;
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
const PF_FULL = {CF: 'Codeforces', LC: 'LeetCode', GFG: 'GFG', CSES: 'CSES', AC: 'AtCoder', USACO: 'USACO', NOTE: 'Notes', VIDEO: 'Video', EDU: 'CF EDU'};

function renderMinis() {
  const d = D; if (!d) return;
  const rnk = rankOf(d.R);
  document.documentElement.style.setProperty('--rank', `var(${rnk.v})`);
  const syncCls = {ok: 'ok', busy: 'busy', err: 'err'}[syncState.status] || '';
  $('#minis').innerHTML = `
    <span class="mini rk num" title="Practice rating · ${rnk.name}">${Math.round(d.R)}</span>
    <span class="mini num hide-s" title="Level">LV ${d.level}</span>
    <span class="mini num hide-s" title="Streak">${d.streak}d streak</span>
    <span class="mini" title="${esc(syncState.msg)}"><span class="dot ${syncCls}"></span><span class="hide-s">${syncState.status === 'err' ? 'sync error' : syncState.status === 'busy' ? 'syncing' : syncState.status === 'ok' ? 'synced' : 'local'}</span></span>`;
}
const renderChips = renderMinis;

function rankCard() {
  const d = D, rnk = rankOf(d.R), next = RANKS[RANKS.indexOf(rnk) + 1];
  const pos = Math.max(0, Math.min(100, (d.R - 800) / (2400 - 800) * 100));
  const lvPct = (d.xp - d.lvBase) / (d.lvNext - d.lvBase) * 100;
  const hearts = Array.from({length: 10}, (_, i) => `<i class="${d.hp >= (i + 1) * 5 ? '' : 'off'}"></i>`).join('');
  const tp = Math.min(100, d.todaySolved / d.target * 100);
  return `<section class="rank" aria-label="Your rank">
    <div style="position:relative;z-index:1;min-width:0">
      <div class="title">${rnk.name}</div>
      <div class="big num">${Math.round(d.R)}<small>practice rating</small></div>
      <div class="muted" style="font-size:13.5px;margin-top:8px">${next ? `<b style="color:var(${next.v})">${Math.ceil(next.lo - d.R)}</b> to ${next.name}` : 'Top of the ladder'} · ${d.proj?.date ? `1600 projected <b>${fmtShort(d.proj.date)}</b>` : d.proj?.done ? 'Expert level reached' : 'projection after ~8 attempts'}</div>
      <div class="ladder"><div class="wrapt"><div class="track"></div><div class="pin" style="left:${pos}%"></div></div>
        <div class="ticks"><span style="left:0">800</span><span style="left:25%">1200</span><span style="left:37.5%">1400</span><span style="left:50%">1600</span><span style="left:68.75%">1900</span><span style="left:81.25%">2100+</span></div></div>
    </div>
    <div class="stats4">
      <div class="st"><span class="l">Today</span><span class="v num">${d.todaySolved}<span class="muted" style="font-size:15px">/${d.target}</span></span><div class="bar"><i style="width:${tp}%;background:var(--good)"></i></div></div>
      <div class="st"><span class="l">Level ${d.level}</span><span class="v num">${d.xp}<span class="muted" style="font-size:13px"> xp</span></span><div class="bar"><i style="width:${lvPct}%;background:var(--rank)"></i></div></div>
      <div class="st"><span class="l">Health ${d.hp}/50</span><div class="hearts" style="margin-top:6px">${hearts}</div></div>
      <div class="st"><span class="l">Streak · gold</span><span class="v num">${d.streak}d <span style="color:var(--r-master);font-size:18px">◆ ${d.gold}</span></span></div>
    </div>
  </section>`;
}

function itemRow(it, {actions = true} = {}) {
  const st = D.status[it.id], done = D.isDone(it.id), special = SPECIAL.has(it.k), live = timer?.id === it.id;
  const hideTags = (it.k === 'mixed' || it.k === 'ladder') && !(state.items[it.id]?.attempts?.length || done);
  const sub = [`<span class="pf">${esc(it.p)}</span>`];
  if (it.k !== 'core') sub.push(`<span class="role ${it.k}">${esc(it.k)}</span>`);
  if (st) sub.push(`<span class="pill ${OUTCOMES[st]?.pill || st}">${st === 'synced' ? 'solved · synced' : st === 'done' ? 'done' : st === 'skipped' ? 'skipped' : OUTCOMES[st]?.label}</span>`);
  if (it.l?.length && !special) sub.push(`<span>${esc(it.l.join(' · '))}</span>`);
  if (!hideTags && it.sb) sub.push(`<span>${esc(it.sb)}</span>`);
  if (!hideTags && it.t?.length) sub.push(`<span class="mono" style="font-size:11.5px">${esc(it.t.join(', '))}</span>`);
  if (hideTags && !special) sub.push('<span class="mono" style="font-size:11px">tags hidden</span>');
  if ((special || it.k === 'retest') && it.no) sub.push(`<span>${esc(it.no)}</span>`);
  if (it.p === 'GFG') sub.push('<span>search the name on GFG</span>');
  const an = state.items[it.id]?.analyses?.length; if (an) sub.push(`<span>${an} AI note${an > 1 ? 's' : ''}</span>`);
  const title = it.u ? `<a class="t" href="${esc(it.u)}" target="_blank" rel="noopener">${esc(it.n)} ${ICON.ext}</a>` : `<span class="t">${esc(it.n)}</span>`;
  const rate = special ? `<span class="rate" style="--c:var(--r-cm)">${it.k === 'mock' || it.k === 'contest' ? 'RND' : it.k === 'edu' ? 'EDU' : it.k === 'lecture' ? 'VID' : 'NTS'}<small>${it.m}m</small></span>`
                       : `<span class="rate num" style="--c:${rcol(it.r)}">${it.r || '—'}<small>${it.m}m</small></span>`;
  let acts = '';
  if (actions) {
    if (special) acts = done ? `<button class="btn sm ghost" data-act="undone" data-id="${esc(it.id)}">Undo</button>` : `<button class="btn sm pri" data-act="markdone" data-id="${esc(it.id)}">Done</button>`;
    else acts = `${live ? `<button class="btn sm on" data-act="${timer.running ? 'pause' : 'askresume'}">${timer.running ? 'Pause' : 'Resume'} <span class="num" id="rowclock">${mmss(elapsed())}</span></button>` : `<button class="btn sm ${done ? '' : 'pri'}" data-act="start" data-id="${esc(it.id)}">${ICON.play} ${done || st === 'gaveup' ? 'Retry' : 'Start'}</button>`}
      <button class="btn sm ghost" data-act="detail" data-id="${esc(it.id)}" aria-label="Details">•••</button>`;
  }
  return `<li class="q${done ? ' done' : ''}${special ? ' special' : ''}${live ? ' live' : ''}">${rate}<div class="nm">${title}<div class="sub">${sub.join('')}</div></div><div class="acts">${acts}</div></li>`;
}

function ringSVG(s) {
  const R = 74, C = 2 * Math.PI * R, frac = Math.min(1, s / 1500);
  const col = s >= 1500 ? 'var(--bad)' : s >= 1020 ? 'var(--warn)' : s >= 600 ? 'var(--r-spec)' : 'var(--rank)';
  const tick = t => { const a = t / 1500 * 2 * Math.PI; return `<line x1="${85 + 64 * Math.cos(a)}" y1="${85 + 64 * Math.sin(a)}" x2="${85 + 84 * Math.cos(a)}" y2="${85 + 84 * Math.sin(a)}" stroke="var(--fg)" stroke-width="2" opacity=".5"/>`; };
  return `<svg viewBox="0 0 170 170"><circle cx="85" cy="85" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/>
    <circle id="ringArc" cx="85" cy="85" r="${R}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" style="filter:drop-shadow(0 0 6px ${col})"/>
    ${tick(600)}${tick(1020)}</svg>`;
}
function phaseLabel(s) { return s >= 1500 ? 'editorial time' : s >= 1020 ? 'hint 2 window' : s >= 600 ? 'hint 1 window' : 'think solo'; }
function timerPanel() {
  if (!timer) return '';
  const it = ITEMS.get(timer.id); if (!it) { timer = null; saveTimer(); return ''; }
  const s = elapsed();
  return `<section class="timer" aria-label="Timer">
    <div class="ring" id="ring">${ringSVG(s)}<div class="c"><div class="clock num" id="clock">${mmss(s)}</div><div class="phase" id="phase">${timer.running ? phaseLabel(s) : 'paused'}</div></div></div>
    <div class="side">
      <div><div class="kicker">${timer.running ? 'Solving' : 'Paused'} · ${esc(it.p)} · est ${it.m} min</div>
        <h2 style="margin-top:2px">${it.u ? `<a href="${esc(it.u)}" target="_blank" rel="noopener" style="color:var(--fg);text-decoration:none">${esc(it.n)} ${ICON.ext}</a>` : esc(it.n)} <span class="num" style="color:${rcol(it.r)};font-size:16px">${it.r || ''}</span></h2></div>
      <div class="banner" id="tbanner" hidden></div>
      ${timer.running ? `<div class="row">
        <button class="btn ${timer.hints.includes(1) ? 'on' : ''}" data-act="hint" data-h="1">Hint 1</button>
        <button class="btn ${timer.hints.includes(2) ? 'on' : ''}" data-act="hint" data-h="2">Hint 2</button>
        <button class="btn ${timer.editorial ? 'on' : ''}" data-act="editorial">Editorial</button>
        <button class="btn" data-act="wa" title="Count of submissions the judge rejected (Wrong Answer, TLE, runtime error)">Wrong answers <span class="num">${timer.wa}</span></button>
      </div>
      <textarea id="tnotes" placeholder="Thought process: what you're trying, where you're stuck…">${esc(timer.notes || '')}</textarea>
      ${solutionBox(it.id)}
      <div class="row">
        <button class="btn" data-act="copyai" data-id="${esc(it.id)}">Copy for AI</button>
        <button class="btn" data-act="paste" data-id="${esc(it.id)}">Paste analysis</button>
        <span style="flex:1"></span>
        <button class="btn" data-act="pause">Pause</button>
        <button class="btn" data-act="entertime" title="Log the attempt with a time you type in, instead of the timer's">Solved in… (enter time)</button>
        <button class="btn pri" data-act="finish">Finish</button>
      </div>` : `<div class="banner">Paused at ${mmss(s)}. Resume the timer or discard this attempt.</div>
      <textarea id="tnotes" placeholder="Thought process: what you're trying, where you're stuck…">${esc(timer.notes || '')}</textarea>
      <div class="row">
        <button class="btn pri" data-act="askresume">Resume</button>
        <button class="btn ghost danger" data-act="discard">Discard</button>
      </div>`}
    </div>
  </section>`;
}
function renderTimerMs() {
  if (!timer) return; const s = elapsed();
  const ring = $('#ring'); if (ring) { const c = ring.querySelector('.c').outerHTML; ring.innerHTML = ringSVG(s) + c; }
  const ph = $('#phase'); if (ph) ph.textContent = timer.running ? phaseLabel(s) : 'paused';
}

function renderToday() {
  const d = D, day = d.planDay, items = day.it;
  const behind = d.calDay - day.n;
  const next = SHEET.days[day.n] || null;
  const due = d.revisit.filter(r => r.overdue);
  const block = items.find(i => /^[BL]\d/.test(i.b))?.b;
  const segs = items.map(i => `<i class="${timer?.id === i.id ? 'live' : (D.status[i.id] || '')}" title="${esc(i.n)}"></i>`).join('');
  const doneN = items.filter(i => D.isDone(i.id)).length;
  return `${timerPanel()}${rankCard()}
  <section class="panel">
    <div class="dayhead">
      <div><div class="kicker">Sheet day ${day.n} of ${SHEET.days.length}${block ? ' · ' + esc(BLOCK_TITLE[block] || block) : ''}</div>
        <h2 style="margin-top:2px">${fmtDate(d.today)}</h2></div>
      <div class="row">
        <span class="tag ${behind > 0 ? 'behind' : behind < 0 ? 'ahead' : ''}">${behind > 0 ? `${behind}d behind plan` : behind < 0 ? `${-behind}d ahead` : 'on pace'}</span>
        <span class="tag num">${doneN}/${items.length} items</span>
      </div>
    </div>
    <div class="segs">${segs}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn sm" data-act="autosync">Check all platforms</button>
      ${graceDays().includes(d.today) ? '' : `<button class="btn sm ghost" data-act="grace">Grace day (${SHEET.meta.grace_days - graceDays().length} left)</button>`}
      ${(() => { const g = graceDays().filter(x => x >= addDays(d.today, -2)).pop(); return g ? `<button class="btn sm ghost" data-act="ungrace" data-date="${g}">Undo grace day (${fmtShort(g)})</button>` : ''; })()}
    </div>
  </section>
  ${due.length ? `<section class="panel"><div class="kicker" style="color:var(--warn)">Revisits due</div><p class="muted" style="margin:4px 0 10px;font-size:13.5px">You needed the editorial or didn't finish these. Redo them from a blank editor.</p><ol class="quests">${due.map(r => itemRow(ITEMS.get(r.id))).join('')}</ol></section>` : ''}
  <section><ol class="quests">${items.map(i => itemRow(i)).join('')}</ol></section>
  ${next ? `<section class="panel"><details><summary class="muted" style="cursor:pointer">Up next · sheet day ${next.n} · ${next.it.filter(i => !SPECIAL.has(i.k)).length} problems</summary><ol class="quests" style="margin-top:10px">${next.it.map(i => itemRow(i)).join('')}</ol></details></section>` : ''}`;
}

let sheetQ = '', sheetOpen = new Set();
function renderSheet() {
  const q = sheetQ.toLowerCase();
  const weeks = []; let cur = null;
  const wk = iso => { const dd = new Date(iso + 'T00:00:00'); dd.setDate(dd.getDate() - (dd.getDay() + 6) % 7); return isoLocal(dd); };
  SHEET.days.forEach(d => { const k = wk(d.d); if (!cur || cur.k !== k) { cur = {k, days: []}; weeks.push(cur); } cur.days.push(d); });
  const pw = wk(D.planDay.d); if (!sheetOpen.size) sheetOpen.add(pw);
  let html = `<section class="panel"><input type="search" id="sq" placeholder="Search name, tag, platform, block…" value="${esc(sheetQ)}">
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Planned dates assume no grace days. Tags on mixed and ladder problems stay hidden until you attempt them.</p></section>`;
  for (const w of weeks) {
    let body = '', total = 0, done = 0;
    for (const d of w.days) {
      const its = d.it.filter(i => !q || (i.n + ' ' + i.p + ' ' + (i.t || []).join(' ') + ' ' + i.sb + ' ' + (BLOCK_TITLE[i.b] || '')).toLowerCase().includes(q));
      if (!its.length) continue;
      total += its.filter(i => !SPECIAL.has(i.k)).length; done += its.filter(i => !SPECIAL.has(i.k) && D.isDone(i.id)).length;
      body += `<div class="daybox${d.n === D.planDay.n ? ' cur' : ''}"><div class="kicker" style="margin-bottom:8px">Day ${d.n} · ${fmtDate(d.d)}</div><ol class="quests">${its.map(i => itemRow(i)).join('')}</ol></div>`;
    }
    if (!body) continue;
    const open = q || sheetOpen.has(w.k);
    html += `<details class="wk" data-k="${w.k}" ${open ? 'open' : ''}><summary><h3>${fmtShort(w.days[0].d)} – ${fmtShort(w.days[w.days.length - 1].d)}</h3><span class="muted mono num" style="font-size:12px">days ${w.days[0].n}–${w.days[w.days.length - 1].n}</span><span class="wkbar bar"><i style="width:${total ? done / total * 100 : 0}%;background:var(--good)"></i></span><span class="mono num muted" style="font-size:12px">${done}/${total}</span></summary>${body}</details>`;
  }
  return html;
}

function ratingChart() {
  const h = D.ratingHist; if (h.length < 2) return '<div class="empty" style="padding:24px">Your rating curve appears after a couple of logged attempts.</div>';
  const W = 900, H = 240, L = 44, R = 12, T = 12, B = 22;
  const ys = h.map(p => p.R), lo = Math.min(1000, Math.floor(Math.min(...ys) / 100) * 100), hi = Math.max(1700, Math.ceil(Math.max(...ys) / 100) * 100);
  const x = i => L + i / (h.length - 1) * (W - L - R), y = r => T + (1 - (r - lo) / (hi - lo)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Practice rating over time"><defs><linearGradient id="gA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--rank)" stop-opacity=".35"/><stop offset="1" stop-color="var(--rank)" stop-opacity="0"/></linearGradient></defs>`;
  RANKS.slice(0, 5).forEach(rk => { const A = Math.max(rk.lo || lo, lo), Bb = Math.min(rk.hi, hi); if (Bb > A) s += `<rect x="${L}" y="${y(Bb)}" width="${W - L - R}" height="${y(A) - y(Bb)}" fill="var(${rk.v})" opacity=".07"/>`; });
  for (let r = lo; r <= hi; r += 200) s += `<line x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}" stroke="var(--line)"/><text x="${L - 7}" y="${y(r) + 4}" text-anchor="end" style="font:10.5px var(--f-mono);fill:var(--muted)">${r}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${y(1600)}" y2="${y(1600)}" stroke="var(--r-expert)" stroke-dasharray="5 5"/><text x="${W - R - 4}" y="${y(1600) - 6}" text-anchor="end" style="font:600 11px var(--f-mono);fill:var(--r-expert)">EXPERT 1600</text>`;
  const line = h.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.R).toFixed(1)).join(' ');
  s += `<path d="${line} L${x(h.length - 1)} ${H - B} L${L} ${H - B} Z" fill="url(#gA)"/><path d="${line}" fill="none" stroke="var(--rank)" stroke-width="2.4" stroke-linejoin="round"/>`;
  s += `<circle cx="${x(h.length - 1)}" cy="${y(h[h.length - 1].R)}" r="5" fill="var(--rank)" style="filter:drop-shadow(0 0 6px var(--rank))"/></svg>`;
  return s;
}
function renderStats() {
  const d = D;
  const weeks = 12, cells = [];
  const monday = addDays(d.today, -((new Date(d.today + 'T00:00:00').getDay() + 6) % 7));
  const startCell = addDays(monday, -7 * (weeks - 1));
  for (let i = 0; i < weeks * 7; i++) { const day = addDays(startCell, i); const n = d.perDay[day]?.solved || 0; const a = n ? Math.min(1, 0.3 + n / (d.target * 1.3)) : 0; cells.push(`<i title="${day}: ${n}" style="${n ? `background:var(--good);opacity:${a.toFixed(2)}` : day > d.today ? 'opacity:.3' : ''}"></i>`); }
  const topics = Object.entries(d.topics).sort((a, b) => b[1].n - a[1].n);
  return `${rankCard()}
  <section class="panel"><div class="row" style="justify-content:space-between"><h3>Practice rating</h3><span class="muted" style="font-size:13px">${d.proj?.date ? `trend +${d.proj.slope.toFixed(1)}/day → 1600 around <b>${fmtShort(d.proj.date)}</b>` : ''}</span></div>
    <div style="margin-top:10px">${ratingChart()}</div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Each attempt moves the rating by K × (score − expected). Score: solved alone within the estimate 1.0, slower 0.85 or 0.75, after hint 1 0.6, after hint 2 0.4, editorial 0.1, unsolved 0. K is 40 for the first 50 attempts, then 24.</p></section>
  <section class="grid2">
    <div class="panel"><div class="kicker">Activity · last 12 weeks</div><div class="row" style="margin-top:10px;align-items:flex-start;gap:16px"><div class="heat">${cells.join('')}</div><p class="muted" style="font-size:12px;max-width:26ch;margin:0">Each row is a week, Monday to Sunday, newest at the bottom.</p></div></div>
    <div class="panel"><div class="kicker">Rules of the game</div><ul class="muted" style="font-size:13px;margin:8px 0 0;padding-left:18px">
      <li>XP per solve scales with rating; hints and editorials earn less.</li><li>Miss the daily target (${d.target}) and lose 10 HP, or 5 if you did half. Hitting it heals 5.</li>
      <li>At 0 HP you faint and lose half your gold (fainted ${d.faints}×).</li><li>Exam days and grace days never cost HP or streak. Best streak: ${d.best} days.</li></ul></div>
  </section>
  <section class="panel"><div class="row" style="justify-content:space-between"><h3>Rewards shop</h3><span class="mini num" style="color:var(--r-master)">◆ ${d.gold} gold</span></div>
    <ol class="quests" style="margin-top:10px">${state.rewards.map(r => `<li class="q" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm"><span class="t">${esc(r.name)}</span><div class="sub"><span class="num" style="color:var(--r-master)">◆ ${r.cost}</span></div></div><div class="acts"><button class="btn sm pri" data-act="redeem" data-id="${r.id}" ${d.gold < r.cost ? 'disabled' : ''}>Redeem</button><button class="btn sm ghost" data-act="delreward" data-id="${r.id}">Remove</button></div></li>`).join('')}</ol>
    <div class="row" style="margin-top:10px"><input type="text" id="rwName" placeholder="Reward, e.g. a movie night" style="flex:2;min-width:140px;width:auto"><input type="number" id="rwCost" placeholder="Cost" min="1" style="flex:1;min-width:80px;width:auto"><button class="btn" data-act="addreward">Add</button></div></section>
  <section class="panel"><h3>Topics</h3><div class="scroll" style="margin-top:8px"><table class="t num"><thead><tr><th>Topic</th><th>Att.</th><th>Clean</th><th>Hint</th><th>Edit.</th><th>Unsolved</th><th>Time vs est.</th><th>Avg rating</th></tr></thead><tbody>
    ${topics.map(([k, T]) => `<tr><td>${esc(k)}</td><td>${T.n}</td><td style="color:var(--good)">${T.clean}</td><td>${T.hint}</td><td style="color:var(--warn)">${T.ed}</td><td>${T.fail}</td><td>${(T.ratio / T.n).toFixed(2)}×</td><td style="color:${rcol(Math.round(T.rsum / T.n))}">${Math.round(T.rsum / T.n)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No logged attempts yet.</td></tr>'}
  </tbody></table></div></section>`;
}
function renderStatus() {
  return `<section class="panel"><div class="row" style="justify-content:space-between"><h3>STATUS.md</h3><div class="row"><button class="btn sm" data-act="copystatus">Copy</button><button class="btn sm" data-act="weekly">Copy weekly review pack</button><button class="btn sm" data-act="pastereview">Paste review</button></div></div>
    <p class="muted" style="font-size:13px;margin:8px 0 10px">Saved to <span class="mono">data/STATUS.md</span> in your cp-tracker repo on every sync. Give it, or the weekly pack, to any AI so it starts with full context. Paste the AI's REVIEW or ANALYSIS block back in here.</p>
    <pre class="md">${esc(statusMd())}</pre></section>`;
}
function renderSettings() {
  const last = LS.get('cpt.lastSync', 0);
  return `<section class="panel"><h3>GitHub sync</h3>
    <p class="muted" style="font-size:13.5px;margin:6px 0 12px">Your log is saved to <span class="mono">data/state.json</span> and <span class="mono">data/STATUS.md</span> in the same repo as this app (default <span class="mono">cp-tracker</span>), next to <span class="mono">sheet.json</span>. The token never leaves this browser: enter it once on each device. Use a fine-grained token for that repo only, with Contents set to read and write.</p>
    <div class="grid2">
      <label class="f">GitHub username<input type="text" id="s_owner" value="${esc(cfg.owner)}" autocomplete="username" placeholder="Harshith-Akella-1"></label>
      <label class="f">Repo<input type="text" id="s_repo" value="${esc(cfg.repo)}"></label>
      <label class="f">Branch<input type="text" id="s_branch" value="${esc(cfg.branch)}"></label>
      <label class="f">Token<input type="password" id="s_token" value="${esc(cfg.token)}" autocomplete="off" placeholder="github_pat_…"></label>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn pri" data-act="savecfg">Save &amp; sync</button><span class="muted" style="font-size:12.5px">${last ? 'Last synced ' + new Date(last).toLocaleString('en-GB') : 'Not synced yet'} ${syncState.status === 'err' ? '· <span style="color:var(--bad)">' + esc(syncState.msg) + '</span>' : ''}</span></div></section>
  <section class="panel"><h3>Practice</h3><div class="grid2" style="margin-top:10px">
      <label class="f">Codeforces handle<input type="text" id="s_cf" value="${esc(cfg.cf)}"></label>
      <label class="f">AtCoder handle<input type="text" id="s_ac" value="${esc(cfg.ac)}"></label>
      <label class="f">Starting practice rating<input type="number" id="s_init" value="${esc(cfg.initRating)}"></label>
      <label class="f">Daily target (problems)<input type="number" id="s_target" value="${esc(cfg.dailyTarget)}" min="1"></label>
      <label class="f">Solutions repo (blank = same repo)<input type="text" id="s_solrepo" value="${esc(cfg.solRepo || '')}" placeholder="${esc(cfg.repo)}"></label>
      <label class="f">Solutions folder<input type="text" id="s_soldir" value="${esc(cfg.solDir ?? 'solutions')}" placeholder="leave empty for rating folders at the repo root"></label>
    </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">Uploaded code goes to <span class="mono">${esc(cfg.solDir ?? 'solutions') ? esc(cfg.solDir ?? 'solutions') + '/' : ''}&lt;rating&gt;/</span> in that repo; leave the folder empty to put the rating folders at the top level. If you use a different repo, give your token access to it too (Contents: read and write).</p>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="savecfg">Save</button></div></section>
  <section class="panel"><h3>Backup</h3><p class="muted" style="font-size:13.5px;margin:6px 0 12px">Export the full log as JSON for any AI or for safekeeping, or import one to merge it in.</p>
    <div class="row"><button class="btn" data-act="export">Export JSON</button><label class="btn">Import JSON<input type="file" id="importFile" accept="application/json" hidden></label><button class="btn ghost danger" data-act="resetlocal">Clear this device's copy</button></div></section>`;
}
function renderOnboarding() {
  return `<section class="onb"><div class="rank" style="grid-template-columns:1fr"><div style="position:relative;z-index:1"><div class="title">Road to 2000</div>
    <div class="big" style="font-size:44px">Connect your repo</div>
    <p class="muted">Your logs are stored in your GitHub repo, so connect it once on each device to load and save them.</p></div></div>
    <div class="panel"><ol><li>Create a fine-grained token for <span class="mono">cp-tracker</span> only, with Contents set to read and write.</li><li>Fill in the form below and tap <b>Save &amp; sync</b>.</li><li>Do the same once on each device.</li></ol></div>
    ${renderSettings()}</section>`;
}
let armed = false;   // celebrations only follow your own actions, never a sync
function render() {
  if (!SHEET) { $('#main').innerHTML = renderOnboarding(); return; }
  const prevLevel = D?.level, prevToday = D?.todaySolved;
  derive();
  renderMinis();
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const main = $('#main');
  main.innerHTML = tab === 'today' ? renderToday() : tab === 'sheet' ? renderSheet() : tab === 'stats' ? renderStats() : tab === 'status' ? renderStatus() : renderSettings();
  if (tab === 'sheet') {
    $('#sq')?.addEventListener('input', e => { sheetQ = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#sq'); n.focus(); n.setSelectionRange(pos, pos); });
    main.querySelectorAll('details.wk').forEach(el => el.addEventListener('toggle', () => el.open ? sheetOpen.add(el.dataset.k) : sheetOpen.delete(el.dataset.k)));
  }
  if (tab === 'settings') $('#importFile')?.addEventListener('change', importJson);
  const tn = $('#tnotes'); if (tn) tn.addEventListener('input', e => { timer.notes = e.target.value; saveTimer(); });
  if (armed) {
    armed = false;
    if (prevLevel && D.level > prevLevel) { celebrate(); toast(`Level up · LV ${D.level}`, true); }
    else if (prevToday != null && prevToday < D.target && D.todaySolved >= D.target) { celebrate(); toast('Daily target hit', true); }
  }
}

// one orchestrated moment: a short burst in your rank colour when you level up or hit the daily target
function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#fx'), ctx = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
  const col = getComputedStyle(document.documentElement).getPropertyValue('--good').trim() || '#3ddc84';
  const cols = [col, '#6f8cff', '#2fd6cf', '#ffa940', '#c77dff'];
  const P = Array.from({length: 120}, () => ({x: innerWidth / 2, y: innerHeight * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4, s: Math.random() * 5 + 3, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6}));
  let f = 0; (function step() { ctx.clearRect(0, 0, cv.width, cv.height); P.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .2; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); ctx.restore(); }); if (++f < 90) requestAnimationFrame(step); else ctx.clearRect(0, 0, cv.width, cv.height); })();
}

// ---------------------------------------------------------------- solutions → GitHub (rating-wise folders)
let pendingSol = null;   // {id, name, text} picked/pasted but not uploaded yet (survives re-renders)
const LANG = {cpp: '//', cc: '//', cxx: '//', c: '//', h: '//', java: '//', js: '//', ts: '//', kt: '//', rs: '//', go: '//', cs: '//', swift: '//', py: '#', rb: '#'};
const slugify = s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function solutionPath(it, ext) {
  const band = it.r ? String(Math.floor(it.r / 100) * 100) : 'unrated';
  const gym = (it.u || '').match(/codeforces\.com\/gym\/(\d+)\/problem\/(\w+)/);
  const code = gym ? `${gym[1]}${gym[2]}` : it.id.split(':').slice(1).join('-');
  const name = `${it.p}_${code}${slugify(it.n) && !code.includes(slugify(it.n)) ? '_' + slugify(it.n) : ''}.${ext}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const dir = cfg.solDir ?? 'solutions';
  return `${dir ? dir + '/' : ''}${band}/${name}`;
}
const LEGACY_REPOS = new Set(['cp-tracker-data', 'cp-tracker-solutions']);   // merged into cp-tracker; old links point here now
function solutionBox(id) {
  const it = ITEMS.get(id), sols = state.items[id]?.solutions || [], repo = cfg.solRepo || cfg.repo;
  const p = pendingSol?.id === id ? pendingSol : null;
  const links = sols.slice().reverse().map(x => `<li><a href="https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(LEGACY_REPOS.has(x.repo) ? repo : (x.repo || repo))}/blob/${encodeURIComponent(cfg.branch)}/${x.path.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener">${esc(x.path)}</a> <span class="muted">· ${new Date(x.at).toLocaleString('en-GB')}</span></li>`).join('');
  return `<div class="solbox" style="border:1px dashed var(--line-2,var(--line));border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px">
    <div class="row" style="justify-content:space-between"><b style="font-size:14px">Accepted code</b><span class="muted" style="font-size:12px">goes to <span class="mono">${esc(solutionPath(it, 'cpp').replace(/[^/]+$/, ''))}</span></span></div>
    <div class="row">
      <label class="btn sm">Choose file<input type="file" class="solFile" data-id="${esc(id)}" accept=".cpp,.cc,.cxx,.c,.h,.py,.java,.js,.ts,.kt,.rs,.go,.cs,.rb,.swift,.txt" hidden></label>
      <span class="muted solName" style="font-size:13px;min-width:0;overflow-wrap:anywhere">${p?.name ? esc(p.name) : 'or paste it below'}</span>
    </div>
    <textarea class="solCode" data-id="${esc(id)}" placeholder="Paste your accepted code here (C++ assumed for pasted code)" style="min-height:70px;font-family:var(--f-mono);font-size:12.5px">${p && !p.name ? esc(p.text) : ''}</textarea>
    <div class="row"><button class="btn sm pri" data-act="uploadsol" data-id="${esc(id)}">Submit to GitHub</button>${sols.length ? `<span class="muted" style="font-size:12.5px">${sols.length} saved</span>` : ''}</div>
    ${links ? `<ul style="margin:0;padding-left:18px;font-size:12.5px">${links}</ul>` : ''}
  </div>`;
}
document.addEventListener('change', async e => {
  if (!e.target.classList?.contains('solFile')) return;
  const f = e.target.files?.[0]; if (!f) return;
  if (f.size > 200000) { toast('That file is over 200 KB — pick the source file'); return; }
  pendingSol = {id: e.target.dataset.id, name: f.name, text: await f.text()};
  const n = e.target.closest('.solbox')?.querySelector('.solName'); if (n) n.textContent = f.name;
});
document.addEventListener('input', e => {
  if (!e.target.classList?.contains('solCode')) return;
  const id = e.target.dataset.id;
  if (e.target.value.trim()) pendingSol = {id, name: '', text: e.target.value};
  else if (pendingSol?.id === id && !pendingSol.name) pendingSol = null;
});
async function uploadSolution(id, btn) {
  const it = ITEMS.get(id);
  if (!cfg.token || !cfg.owner) { toast('Set up GitHub sync in Setup first'); return; }
  const pasted = btn.closest('.solbox')?.querySelector('.solCode')?.value?.trim();
  const src = pendingSol?.id === id && pendingSol.name ? pendingSol : pasted ? {name: '', text: pasted} : null;
  if (!src) { toast('Choose a file or paste your code first'); return; }
  const ext = (src.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'cpp').toLowerCase();
  const path = solutionPath(it, ext), repo = cfg.solRepo || cfg.repo, c = LANG[ext];
  let text = src.text.replace(/\r\n/g, '\n');
  if (c && it.u && !text.includes(it.u)) text = `${c} ${it.n} (${({CF:'Codeforces',LC:'LeetCode',GFG:'GeeksforGeeks',CSES:'CSES',AC:'AtCoder',USACO:'USACO'})[it.p] || it.p}, rating ${it.r || 'n/a'})\n${c} ${it.u}\n${c} Accepted ${new Date().toLocaleDateString('en-GB')}\n\n` + text;
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const old = await GH.get(path, repo);
    await GH.put(path, text, old?.sha, `${old ? 'update' : 'add'} ${it.p} ${it.n} (${it.r || 'unrated'})`, repo);
    const s = itemState(id); (s.solutions ||= []).push({id: uid(), at: Date.now(), path, repo}); s.updatedAt = Date.now();
    pendingSol = null; touch(); toast(`Saved to ${path}`);
    if (dlg.open) detailDlg(id); else render();
  } catch (e) {
    toast(/404/.test(e.message) ? `Upload failed: the token can't reach "${repo}". Check its repository access.` : 'Upload failed: ' + e.message);
    btn.disabled = false; btn.textContent = 'Submit to GitHub';
  }
}

// ---------------------------------------------------------------- dialogs
const dlg = $('#dlg'), dlgBody = $('#dlgBody');
function openDlg(html) { dlgBody.innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDlg() { dlg.close(); }
// mode: 'timer' = finish with the timer's time (editable) · 'enter' = running timer, type the time · 'manual' = no timer at all
function finishDlg(id = timer?.id, mode = 'timer') {
  const it = ITEMS.get(id), t = mode === 'manual' ? null : timer, s = t ? elapsed() : 0;
  const suggested = t ? (t.editorial ? 'editorial' : t.hints.length ? 'hint' : 'solved') : 'solved';
  const minVal = mode === 'timer' ? Math.max(1, Math.round(s / 60)) : '';
  openDlg(`<header><h3>${mode === 'manual' ? 'Log a solve' : 'Finish'}: ${esc(it.n)}</h3><button class="btn sm" data-act="close">Close</button></header>
    <div class="muted num">${t ? `${mmss(s)} on the timer · ` : ''}estimate ${it.m} min${t ? ` · hints ${t.hints.join('+') || 'none'}${t.editorial ? ' · read editorial' : ''} · wrong answers ${t.wa}` : ''}</div>
    <label class="f">Time taken (minutes)<input type="number" id="f_min" min="1" step="1" inputmode="numeric" value="${minVal}" placeholder="e.g. 18"></label>
    ${t ? '' : `<div class="row" style="gap:14px;font-size:14px">
      <label><input type="checkbox" id="f_h1"> Used hint 1</label><label><input type="checkbox" id="f_h2"> Used hint 2</label>
      <label><input type="checkbox" id="f_ed"> Read editorial</label>
      <label style="display:flex;align-items:center;gap:6px">Wrong answers <input type="number" id="f_wa" min="0" value="0" style="width:70px"></label></div>`}
    <label class="f">Outcome<select id="f_out">${Object.entries(OUTCOMES).map(([k, o]) => `<option value="${k}" ${k === suggested ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
    <label class="f">Main mistake<select id="f_mis">${MISTAKES.map(m => `<option>${m}</option>`).join('')}</select></label>
    <label class="f">Thought process and what you learned (an AI will read this later)<textarea id="f_notes" style="min-height:120px">${esc(t?.notes || '')}</textarea></label>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="savefinish" data-id="${esc(id)}" data-mode="${mode}">Save attempt</button></div>`);
  if (mode !== 'timer') setTimeout(() => $('#f_min')?.focus(), 50);
}
function confirmDlg(title, body, act, label, danger = false) {
  openDlg(`<header><h3>${esc(title)}</h3></header><p style="margin:0">${esc(body)}</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn ${danger ? 'danger' : 'pri'}" data-act="${act}">${esc(label)}</button></div>`);
}
function detailDlg(id) {
  const it = ITEMS.get(id), s = state.items[id];
  const hist = (s?.attempts || []).slice().reverse().map(a => `<li style="padding:6px 0;border-top:1px solid var(--line)"><b>${OUTCOMES[a.outcome]?.label}</b> <span class="muted num">· ${new Date(a.end).toLocaleString('en-GB')} · ${Math.round(a.sec / 60)} min · hints ${a.hints?.join('+') || 'none'} · WA ${a.wa || 0}${a.mistake && a.mistake !== 'none' ? ' · ' + esc(a.mistake) : ''}${D.dRmap[a.id] != null ? ` · rating ${D.dRmap[a.id] >= 0 ? '+' : ''}${D.dRmap[a.id].toFixed(1)}` : ''}</span>${a.notes ? `<div style="white-space:pre-wrap;font-size:13.5px">${esc(a.notes)}</div>` : ''}</li>`).join('');
  const an = (s?.analyses || []).slice().reverse().map(x => `<li style="padding:6px 0;border-top:1px solid var(--line)"><b>${esc(x.source)}</b> <span class="muted">· ${new Date(x.at).toLocaleString('en-GB')}</span><pre class="md" style="margin-top:4px">${esc(x.text)}</pre></li>`).join('');
  openDlg(`<header><h3>${it.u ? `<a href="${esc(it.u)}" target="_blank" rel="noopener">${esc(it.n)}</a>` : esc(it.n)}</h3><button class="btn sm" data-act="close">Close</button></header>
    <div class="muted" style="font-size:13.5px">${esc(it.p)} · est. rating ${it.r || '—'} · est. ${it.m} min · ${esc(it.l?.join(' · ') || '')}${it.t?.length ? ' · ' + esc(it.t.join(', ')) : ''}${it.sb ? ' · ' + esc(it.sb) : ''}</div>
    <div class="row"><button class="btn pri" data-act="start" data-id="${esc(id)}">Start timer</button><button class="btn" data-act="logtime" data-id="${esc(id)}">Solved in… (enter time)</button><button class="btn" data-act="copyai" data-id="${esc(id)}">Copy for AI</button><button class="btn" data-act="paste" data-id="${esc(id)}">Paste analysis</button>
      <button class="btn" data-act="${s?.skipped ? 'unskip' : 'skip'}" data-id="${esc(id)}">${s?.skipped ? 'Unskip' : 'Skip'}</button>
      ${state.synced[id] && !state.synced[id].off ? (state.synced[id].src === 'manual' ? `<button class="btn" data-act="unmanual" data-id="${esc(id)}">Unmark solved</button>` : `<span class="muted" style="font-size:13px;align-self:center">Solved on ${esc(state.synced[id].src)}</span>`) : `<button class="btn" data-act="manualsolve" data-id="${esc(id)}" title="For problems solved without the timer; counts toward today but not the practice rating">Mark solved (no timer)</button>`}</div>
    ${SPECIAL.has(it.k) ? '' : solutionBox(id)}
    <div><h3 style="font-size:15px">Attempts</h3><ul style="list-style:none;margin:0;padding:0">${hist || '<li class="muted">None yet.</li>'}</ul></div>
    <div><h3 style="font-size:15px">AI analyses</h3><ul style="list-style:none;margin:0;padding:0">${an || '<li class="muted">None yet. Use Copy for AI, and paste the ANALYSIS block back here.</li>'}</ul></div>`);
}
function pasteDlg(id, kind = 'ANALYSIS') {
  const title = kind === 'REVIEW' ? 'Paste weekly review' : `Paste analysis: ${esc(ITEMS.get(id)?.n || '')}`;
  openDlg(`<header><h3>${title}</h3><button class="btn sm" data-act="close">Close</button></header>
    <p class="muted" style="margin:0;font-size:13.5px">Paste the AI's whole reply or just the ${kind} block. If a block is found, only the block is kept.</p>
    <label class="f">Which AI<select id="p_src">${AI_SOURCES.map(s => `<option>${s}</option>`).join('')}</select></label>
    <label class="f">Text<textarea id="p_text" style="min-height:200px"></textarea></label>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-act="${kind === 'REVIEW' ? 'savereview' : 'saveanalysis'}" data-id="${esc(id || '')}">Save</button></div>`);
}

// ---------------------------------------------------------------- actions
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act],[data-tab]'); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; LS.set('cpt.tab', tab); render(); window.scrollTo(0, 0); return; }
  const act = b.dataset.act, id = b.dataset.id;
  switch (act) {
    case 'start': if (timer && timer.id !== id) { toast('Finish or discard the running timer first'); break; } closeDlg(); if (!timer) startTimer(id); else { tab = 'today'; render(); } window.scrollTo(0, 0); break;
    case 'pause': pauseTimer(); runTick(); break;
    case 'hint': { const h = +b.dataset.h; timer.hints = timer.hints.includes(h) ? timer.hints.filter(x => x !== h) : [...timer.hints, h].sort(); saveTimer(); render(); break; }
    case 'editorial': timer.editorial = !timer.editorial; saveTimer(); render(); break;
    case 'wa': timer.wa++; saveTimer(); render(); break;
    case 'discard': if (timer) { timer.notes = $('#tnotes')?.value ?? timer.notes; saveTimer(); } confirmDlg('Discard this attempt?', `The ${mmss(elapsed())} on the timer and this attempt's notes will be deleted. This can't be undone.`, 'dodiscard', 'Discard', true); break;
    case 'dodiscard': closeDlg(); discardTimer(); toast('Attempt discarded'); break;
    case 'askresume': confirmDlg('Resume the timer?', `The clock continues from ${mmss(elapsed())}.`, 'doresume', 'Resume'); break;
    case 'doresume': closeDlg(); if (timer && !timer.running) { pauseTimer(); runTick(); } break;
    case 'finish': timer.notes = $('#tnotes')?.value || timer.notes; saveTimer(); finishDlg(timer.id, 'timer'); break;
    case 'entertime': timer.notes = $('#tnotes')?.value || timer.notes; saveTimer(); finishDlg(timer.id, 'enter'); break;
    case 'logtime': if (timer && timer.id === id) { finishDlg(id, 'enter'); break; } finishDlg(id, 'manual'); break;
    case 'savefinish': {
      const mode = b.dataset.mode || 'timer', fid = b.dataset.id || timer?.id;
      const it = ITEMS.get(fid), s = itemState(fid);
      const min = +$('#f_min').value; if (!(min > 0)) { toast('Enter the time taken in minutes'); $('#f_min').focus(); break; }
      const t = mode === 'manual' ? null : timer;
      const hints = t ? t.hints : [$('#f_h1')?.checked && 1, $('#f_h2')?.checked && 2].filter(Boolean);
      const ed = t ? t.editorial : !!$('#f_ed')?.checked, wa = t ? t.wa : (+$('#f_wa')?.value || 0);
      const outcome = $('#f_out').value, now = Date.now(), sec = Math.round(min * 60);
      s.attempts.push({id: uid(), start: t ? t.began : now - sec * 1000, end: now, sec, hints, editorial: ed || outcome === 'editorial', wa,
                       outcome, mistake: $('#f_mis').value, notes: $('#f_notes').value.trim(), r: it.r, ...(mode !== 'timer' ? {timeEntered: true} : {})});
      s.updatedAt = now; s.skipped = false;
      const before = D.R; if (t) { timer = null; saveTimer(); clearInterval(tick); } closeDlg(); touch(); armed = true; render();
      const dR = D.R - before; toast(`Saved · rating ${dR >= 0 ? '+' : ''}${dR.toFixed(1)} → ${Math.round(D.R)}`);
      break;
    }
    case 'detail': pendingSol = null; detailDlg(id); break;
    case 'uploadsol': uploadSolution(id, b); break;
    case 'close': closeDlg(); break;
    case 'skip': case 'unskip': { const s = itemState(id); s.skipped = act === 'skip'; s.updatedAt = Date.now(); touch(); closeDlg(); render(); break; }
    case 'markdone': { const s = itemState(id); s.done = true; s.doneAt = Date.now(); s.updatedAt = Date.now(); touch(); armed = true; render(); break; }
    case 'undone': { const s = itemState(id); s.done = false; s.doneAt = null; s.updatedAt = Date.now(); touch(); render(); break; }
    case 'copyai': await copyText(aiPack(id)); break;
    case 'paste': pasteDlg(id); break;
    case 'saveanalysis': {
      const text = $('#p_text').value.trim(); if (!text) { toast('Paste the text first'); break; }
      const {body, fields} = parseBlock(text, 'ANALYSIS');
      const target = (fields.problem && ITEMS.has(fields.problem)) ? fields.problem : id;
      const s = itemState(target); s.analyses.push({id: uid(), at: Date.now(), source: $('#p_src').value, text: body}); s.updatedAt = Date.now();
      touch(); closeDlg(); render(); toast('Analysis saved — it goes into STATUS.md on the next sync'); break;
    }
    case 'weekly': await copyText(weeklyPack()); break;
    case 'copystatus': await copyText(statusMd()); break;
    case 'pastereview': pasteDlg(null, 'REVIEW'); break;
    case 'savereview': { const text = $('#p_text').value.trim(); if (!text) break; const {body} = parseBlock(text, 'REVIEW'); state.reviews.push({id: uid(), at: Date.now(), source: $('#p_src').value, text: body}); touch(); closeDlg(); render(); toast('Review saved'); break; }
    case 'grace': if (graceDays().length >= SHEET.meta.grace_days) { toast('No grace days left'); break; } (state.graceLog ||= []).push({id: uid(), date: D.today, on: true, at: Date.now()}); touch(); render(); toast('Grace day taken — streak and HP are safe today'); break;
    case 'ungrace': (state.graceLog ||= []).push({id: uid(), date: b.dataset.date || D.today, on: false, at: Date.now()}); touch(); render(); toast('Grace day undone'); break;
    case 'autosync': autosync(true); break;
    case 'manualsolve': state.synced[id] = {day: D.today, src: 'manual', at: Date.now()}; touch(); closeDlg(); render(); toast('Marked solved'); break;
    case 'unmanual': state.synced[id] = {...state.synced[id], off: true, at: Date.now()}; touch(); closeDlg(); render(); toast('Unmarked'); break;
    case 'redeem': { const r = state.rewards.find(x => x.id === id); if (r && D.gold >= r.cost) { state.redeemed.push({id: uid(), rid: r.id, name: r.name, cost: r.cost, at: Date.now()}); touch(); render(); toast(`Enjoy: ${r.name}`); } break; }
    case 'delreward': state.rewards = state.rewards.filter(x => x.id !== id); touch(); render(); break;
    case 'addreward': { const n = $('#rwName').value.trim(), c = +$('#rwCost').value; if (!n || !(c > 0)) { toast('Give the reward a name and a cost'); break; } state.rewards.push({id: uid(), name: n, cost: Math.round(c)}); touch(); render(); break; }
    case 'savecfg': {
      const v = k => $('#s_' + k)?.value?.trim();
      if ($('#s_owner')) Object.assign(cfg, {owner: v('owner'), repo: v('repo') || 'cp-tracker', branch: v('branch') || 'main', token: v('token')});
      if ($('#s_cf')) Object.assign(cfg, {cf: v('cf'), ac: v('ac'), initRating: +v('init') || 1100, dailyTarget: +v('target') || 6, solRepo: v('solrepo') || '', solDir: (v('soldir') ?? 'solutions').replace(/^\/+|\/+$/g, '')});
      LS.set('cpt.cfg', cfg); toast('Saved');
      if (cfg.token) { const sh = await loadSheet(); if (sh) { const first = !SHEET; initSheet(sh); if (first) tab = 'today'; } render(); if (SHEET) { syncNow(true); autosync(true); } } else render(); break;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify({exportedAt: new Date().toISOString(), state, status: statusMd()}, null, 1)], {type: 'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cp-tracker-${D.today}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); break;
    }
    case 'resetlocal': if (b.dataset.confirm) { localStorage.removeItem('cpt.state'); state = DEFAULT_STATE(); render(); toast('Local copy cleared; sync will restore it from GitHub'); syncNow(); } else { b.dataset.confirm = '1'; b.textContent = 'Tap again to clear'; } break;
  }
});
async function importJson(e) {
  const f = e.target.files?.[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); state = mergeStates(state, j.state || j); touch(); render(); toast('Imported and merged'); }
  catch (err) { toast('Could not read that file: ' + err.message); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && SHEET) { render(); runTick(); syncNow(); autosync(); } });

// ---------------------------------------------------------------- boot
// sheet.json sits at the root of the app repo: read it through the API (freshest), else the local cache, else the Pages copy.
function initSheet(sheet) {
  SHEET = sheet; ITEMS = new Map(); ORDER = []; BLOCK_TITLE = {};
  SHEET.meta.blocks.forEach(b => BLOCK_TITLE[b.id] = b.title);
  for (const d of SHEET.days) for (const it of d.it) { it.day = d.n; ITEMS.set(it.id, it); ORDER.push(it.id); }
}
async function loadSheet() {
  if (cfg.token && cfg.owner) {
    try { const r = await GH.get('sheet.json'); if (r) { try { localStorage.setItem('cpt.sheet', r.text); } catch {} return JSON.parse(r.text); } }
    catch (e) { setSync('err', e.message); }
  }
  try { const c = localStorage.getItem('cpt.sheet'); if (c) return JSON.parse(c); } catch {}
  try { const r = await fetch('sheet.json', {cache: 'no-cache'}); if (r.ok) return await r.json(); } catch {}
  return null;
}
async function boot() {
  const sh = await loadSheet();
  if (sh) initSheet(sh);
  if (!SHEET) tab = 'settings';
  render(); runTick();
  if (SHEET) { syncNow(); autosync(); }
}
boot();
