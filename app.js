/* =========================================================
   My Fitness Log — simple workout, cardio & swim tracker
   Everything is saved on the phone (localStorage), so it
   works offline at the gym. Accounts/sync come later.
   ========================================================= */
'use strict';

const DB_KEY = 'fitlog.v1';
const APP_VERSION = '1.0.0';

/* ---------- small helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null || isNaN(+v) ? 0 : +v);
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDur = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const startOfWeek = (d = new Date()) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x.getTime();
};
const e1rm = (kg, reps) => (reps > 0 ? kg * (1 + reps / 30) : 0); // Epley formula

/* ---------- default data ---------- */
const DEFAULT_EXERCISES = {
  strength: [
    'Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Chest Fly', 'Dips',
    'Triceps Pushdown', 'Skull Crusher', 'Pull-up', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row',
    'Face Pull', 'Biceps Curl', 'Hammer Curl', 'Rear Delt Fly', 'Squat', 'Romanian Deadlift', 'Deadlift',
    'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise', 'Hanging Leg Raise', 'Cable Crunch',
  ],
  cardio: ['Running', 'Treadmill', 'Cycling', 'Rowing', 'Stair Climber', 'Walking'],
  swim: ['Swimming'],
  rope: ['Jump Rope'],
};
/* Ready-made programs offered under "Add program" (4 exercises each).
   Built around the main compound lifts; the user can edit them before saving. */
const PROGRAM_TEMPLATES = [
  { name: 'Full Body', tag: 'Beginner · 2–3× a week', desc: 'Whole body in one session — the best start for beginners.',
    exercises: ['Squat', 'Bench Press', 'Barbell Row', 'Overhead Press'] },
  { name: 'Push', tag: 'Chest · Shoulders · Triceps', desc: 'Pushing day of a Push / Pull / Legs split.',
    exercises: ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Triceps Pushdown'] },
  { name: 'Pull', tag: 'Back · Biceps', desc: 'Pulling day of a Push / Pull / Legs split.',
    exercises: ['Lat Pulldown', 'Barbell Row', 'Face Pull', 'Biceps Curl'] },
  { name: 'Legs', tag: 'Quads · Hamstrings · Glutes · Calves', desc: 'Leg day — pairs with Push / Pull or with Upper Body.',
    exercises: ['Squat', 'Romanian Deadlift', 'Leg Press', 'Calf Raise'] },
  { name: 'Upper Body', tag: 'Chest · Back · Shoulders', desc: 'Upper day of an Upper / Lower split (use Legs as the lower day).',
    exercises: ['Bench Press', 'Lat Pulldown', 'Overhead Press', 'Seated Cable Row'] },
];
const TYPE_LABEL = { strength: 'Strength', cardio: 'Cardio', swim: 'Swimming', rope: 'Jump rope' };
const TYPES = ['strength', 'cardio', 'swim', 'rope'];
/* Main choices in the Cardio / Movement menu */
const ACTIVITIES = [
  ['running', '🏃', 'Running'],
  ['swimming', '🏊', 'Swimming'],
  ['walking', '🚶', 'Walking'],
  ['jump-rope', '🪢', 'Jump rope'],
];

function seed() {
  const exercises = [];
  for (const [type, names] of Object.entries(DEFAULT_EXERCISES)) {
    for (const name of names) exercises.push({ id: slug(name), name, type });
  }
  // New users start with no programs — they create their own with "+ Add program"
  return { version: 1, exercises, programs: [], workouts: [], active: null, settings: { rest: 90, hideInstall: false, m2: true } };
}

/* ---------- storage ---------- */
/** Updates data saved by an older version of the app. */
function migrate(d) {
  for (const [type, names] of Object.entries(DEFAULT_EXERCISES)) {
    for (const name of names) if (!d.exercises.some((e) => e.id === slug(name))) d.exercises.push({ id: slug(name), name, type });
  }
  if (!d.settings.m2) {
    // Cardio + Swim tiles were replaced by the Cardio / Movement menu
    d.programs = d.programs.filter((p) => !['cardio', 'swim'].includes(p.id));
    d.settings.m2 = true;
  }
}
/* Each account has its own copy on the phone; without an account the old key is used. */
const dbKey = () => (Auth.user ? `${DB_KEY}.${Auth.user.id}` : DB_KEY);
const syncKey = () => `fitlog.sync.${Auth.user ? Auth.user.id : 'local'}`;
let sync = { dirty: false, at: 0 };

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function load() {
  sync = readJSON(syncKey()) || { dirty: false, at: 0 };
  let d = readJSON(dbKey());
  // First login on this phone: keep the workouts logged before accounts existed
  if (!d && Auth.user && !localStorage.getItem('fitlog.adopted')) {
    d = readJSON(DB_KEY);
    if (d) { localStorage.setItem('fitlog.adopted', '1'); sync.dirty = true; }
  }
  if (d && d.version === 1) { migrate(d); return d; }
  return seed();
}
function saveSync() { localStorage.setItem(syncKey(), JSON.stringify(sync)); }
function save(localOnly = false) {
  try { localStorage.setItem(dbKey(), JSON.stringify(db)); }
  catch (e) { toast('Could not save — storage is full'); }
  if (localOnly || !Auth.user) return;
  sync.dirty = true;
  saveSync();
  scheduleSync();
}

/* ---------- cloud sync ---------- */
let syncTimer = null;
let syncing = false;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 2500);
  setSyncStatus('pending');
}
async function syncNow() {
  if (!Auth.user || !db || syncing) return;
  syncing = true;
  try {
    const ok = await Auth.push(db);
    if (ok) { sync.dirty = false; sync.at = Date.now(); saveSync(); setSyncStatus('ok'); }
    else setSyncStatus('offline');
  } catch (e) {
    handleSyncError(e);
  } finally {
    syncing = false;
  }
}
/** Combines this phone's data with the cloud copy (used the first time a phone syncs). */
function mergeData(local, cloud) {
  const byId = (a = [], b = []) => { const m = new Map(); [...a, ...b].forEach((o) => m.set(o.id, o)); return [...m.values()]; };
  return {
    ...cloud,
    exercises: byId(local.exercises, cloud.exercises),
    programs: byId(local.programs, cloud.programs),
    workouts: byId(local.workouts, cloud.workouts).sort((a, b) => a.date - b.date),
    active: cloud.active || local.active,
    settings: { ...local.settings, ...cloud.settings },
  };
}
/** Run when the app opens or comes back to the screen. */
async function pullSync() {
  if (!Auth.user || !db) return;
  if (sync.dirty) return syncNow();
  try {
    const row = await Auth.pull();
    if (row === undefined) return setSyncStatus('offline');
    if (row === null) return syncNow(); // nothing in the cloud yet → upload
    const cloud = row.data;
    if (!cloud || cloud.version !== 1) return;
    migrate(cloud);
    if (!sync.at) {
      // this phone never synced before → merge both, then upload the result
      db = mergeData(db, cloud);
      save();
      render();
      return;
    }
    if (Date.parse(row.updated_at) > sync.at && !sync.dirty) {
      db = cloud;
      sync.at = Date.parse(row.updated_at);
      saveSync();
      save(true);
      if (!$('#modal:not(.hidden)') && !(document.activeElement && document.activeElement.tagName === 'INPUT')) render();
    }
    setSyncStatus('ok');
  } catch (e) {
    handleSyncError(e);
  }
}
function handleSyncError(e) {
  if (e.expired) {
    toast(e.message);
    db = null;
    ui.authMode = 'login';
    render();
    return;
  }
  setSyncStatus(e.offline ? 'offline' : 'error');
}
function setSyncStatus(st) {
  ui.syncStatus = st;
  const el = $('#sync-status');
  if (el) el.textContent = syncText();
}
function syncText() {
  switch (ui.syncStatus) {
    case 'ok': return `Synced ✓ ${sync.at ? new Date(sync.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`;
    case 'pending': return 'Saving to cloud…';
    case 'offline': return 'Offline — will sync when you are online';
    case 'error': return 'Sync failed — will try again';
    default: return sync.dirty ? 'Waiting to sync' : 'Synced ✓';
  }
}

let db = null;
const ui = {
  tab: 'today',
  authMode: 'login',  // login | signup | forgot | newpass
  authMsg: null,
  authEmail: '',
  syncStatus: null,
  changingPassword: false,
  histMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  histDay: null,
  progEx: null,
  restEnd: null,
  restTotal: 0,
  editing: null,   // program being edited in the editor sheet
  pickerFor: null, // 'workout' | 'editor'
};

/* ---------- data helpers ---------- */
const exById = (id) => db.exercises.find((e) => e.id === id) || { id, name: 'Unknown exercise', type: 'strength' };
const progById = (id) => db.programs.find((p) => p.id === id);

/** Last saved entry for an exercise (from finished workouts). */
function lastEntry(exId) {
  for (let i = db.workouts.length - 1; i >= 0; i--) {
    const e = db.workouts[i].entries.find((x) => x.exerciseId === exId);
    if (e) return e;
  }
  return null;
}
/** Heaviest weight ever lifted for an exercise (finished workouts only). */
function bestKg(exId, excludeWorkoutId) {
  let best = 0;
  for (const w of db.workouts) {
    if (w.id === excludeWorkoutId) continue;
    for (const e of w.entries) if (e.exerciseId === exId && e.sets) for (const s of e.sets) best = Math.max(best, s.kg);
  }
  return best;
}
function workoutKinds(w) {
  const kinds = new Set(w.entries.map((e) => exById(e.exerciseId).type));
  return [...kinds];
}

/* ---------- workout flow ---------- */
function makeEntry(exId) {
  const ex = exById(exId);
  const last = lastEntry(exId);
  if (ex.type === 'cardio') return { exerciseId: exId, minutes: '', km: '', prev: last ? { minutes: last.minutes, km: last.km } : null };
  if (ex.type === 'rope') return { exerciseId: exId, minutes: '', jumps: '', prev: last ? { minutes: last.minutes, jumps: last.jumps } : null };
  if (ex.type === 'swim') return { exerciseId: exId, laps: '', pool: last ? String(last.pool) : '25', minutes: '', prev: last ? { laps: last.laps, minutes: last.minutes } : null };
  const sets = last && last.sets && last.sets.length
    ? last.sets.map((s) => ({ kg: '', reps: '', done: false, prev: { kg: s.kg, reps: s.reps } }))
    : [0, 1, 2].map(() => ({ kg: '', reps: '', done: false, prev: null }));
  return { exerciseId: exId, sets };
}

function startWorkout(programId) {
  if (db.active) { ui.tab = 'workout'; render(); return; }
  const p = programId ? progById(programId) : null;
  db.active = {
    id: uid(),
    name: p ? p.name : 'Workout',
    programId: p ? p.id : null,
    startedAt: Date.now(),
    entries: p ? p.exerciseIds.map(makeEntry) : [],
  };
  save();
  ui.tab = 'workout';
  render();
  window.scrollTo(0, 0);
  if (!p) openPicker('workout');
}

/** Start (or add to the current workout) one cardio / movement activity. */
function startActivity(exId) {
  closeModal();
  if (db.active) {
    db.active.entries.push(makeEntry(exId));
  } else {
    db.active = { id: uid(), name: exById(exId).name, programId: null, startedAt: Date.now(), entries: [makeEntry(exId)] };
  }
  save();
  ui.tab = 'workout';
  render();
  window.scrollTo(0, 0);
}

function openCardioMenu() {
  const others = db.exercises.filter((e) => e.type === 'cardio' && !ACTIVITIES.some(([id]) => id === e.id));
  openModal(`
    <div class="sheet-head"><h2>Cardio / Movement</h2><button class="icon-btn" data-act="editor-close">✕</button></div>
    <div class="activity-grid">
      ${ACTIVITIES.map(([id, icon, name]) => {
        const last = lastEntry(id);
        return `<button class="activity ${exById(id).type}" data-act="activity" data-id="${id}">
          <span class="ic">${icon}</span><span class="name">${name}</span>
          <span class="small muted">${last ? 'Last: ' + entryText(last) : 'Not done yet'}</span>
        </button>`;
      }).join('')}
    </div>
    ${others.length ? `<div class="section-title">More</div>
      ${others.map((e) => `<button class="pick-item" data-act="activity" data-id="${e.id}"><span>${esc(e.name)}</span><span class="tag">＋</span></button>`).join('')}` : ''}
  `);
}

function finishWorkout() {
  const w = db.active;
  let unchecked = 0;
  const entries = w.entries.map((e) => {
    const ex = exById(e.exerciseId);
    if (ex.type === 'strength') {
      unchecked += e.sets.filter((s) => !s.done && (s.kg !== '' || s.reps !== '')).length;
      const sets = e.sets.filter((s) => s.done).map((s) => ({ kg: num(s.kg), reps: num(s.reps) }));
      return sets.length ? { exerciseId: e.exerciseId, sets } : null;
    }
    if (ex.type === 'cardio') {
      const minutes = num(e.minutes), km = num(e.km);
      return minutes || km ? { exerciseId: e.exerciseId, minutes, km } : null;
    }
    if (ex.type === 'rope') {
      const minutes = num(e.minutes), jumps = num(e.jumps);
      return minutes || jumps ? { exerciseId: e.exerciseId, minutes, jumps } : null;
    }
    const laps = num(e.laps), pool = num(e.pool) || 25, minutes = num(e.minutes);
    return laps ? { exerciseId: e.exerciseId, laps, pool, minutes, meters: laps * pool } : null;
  }).filter(Boolean);

  if (!entries.length) {
    if (confirm('Nothing is logged yet. Discard this workout?')) discardWorkout();
    return;
  }
  if (unchecked && !confirm(`${unchecked} set(s) are not ticked ✓ and will not be saved. Finish anyway?`)) return;

  // count personal records hit in this workout
  let prs = 0;
  for (const e of entries) {
    if (!e.sets) continue;
    const before = bestKg(e.exerciseId);
    if (before > 0 && Math.max(...e.sets.map((s) => s.kg)) > before) prs++;
  }

  db.workouts.push({
    id: w.id, name: w.name.trim() || 'Workout', programId: w.programId,
    date: w.startedAt, duration: Date.now() - w.startedAt, entries, prs,
  });
  db.workouts.sort((a, b) => a.date - b.date);
  db.active = null;
  ui.restEnd = null;
  save();

  ui.tab = 'history';
  ui.histDay = dayKey(w.startedAt);
  ui.histMonth = new Date(new Date(w.startedAt).getFullYear(), new Date(w.startedAt).getMonth(), 1);
  render();
  window.scrollTo(0, 0);
  toast(prs ? `Workout saved 💪 ${prs} new PR${prs > 1 ? 's' : ''} 🏆` : 'Workout saved 💪');
}

function discardWorkout() {
  db.active = null;
  ui.restEnd = null;
  save();
  ui.tab = 'today';
  render();
}

function toggleSet(ei, si) {
  const entry = db.active.entries[ei];
  const s = entry.sets[si];
  if (s.done) { s.done = false; save(); render(); return; }

  // One tap: empty fields take last time's numbers (or the set above)
  const above = si > 0 ? entry.sets[si - 1] : null;
  if (s.kg === '') s.kg = s.prev ? String(s.prev.kg) : (above ? above.kg : '');
  if (s.reps === '') s.reps = s.prev ? String(s.prev.reps) : (above ? above.reps : '');
  if (s.reps === '') { toast('Enter your reps first'); render(); return; }
  if (s.kg === '') s.kg = '0'; // bodyweight

  s.done = true;
  checkPR(entry, si);
  save();
  startRest();
  render();
}

function checkPR(entry, si) {
  const kg = num(entry.sets[si].kg);
  const history = bestKg(entry.exerciseId);
  if (history <= 0 || kg <= history) return;
  // only celebrate the first set that beats the record in this workout
  const earlier = entry.sets.some((s, j) => j !== si && s.done && num(s.kg) >= kg);
  if (!earlier) toast(`🏆 New PR! ${exById(entry.exerciseId).name} ${kg} kg`);
}

/* ---------- rest timer ---------- */
function startRest() {
  ui.restTotal = db.settings.rest;
  ui.restEnd = Date.now() + db.settings.rest * 1000;
  renderRest();
}
function renderRest() {
  const bar = $('#restbar');
  if (!ui.restEnd || !db || !db.active) { bar.classList.add('hidden'); return; }
  const left = Math.ceil((ui.restEnd - Date.now()) / 1000);
  if (left <= 0) {
    ui.restEnd = null;
    bar.classList.add('hidden');
    toast('Rest over — next set! 🔥');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    return;
  }
  const pct = Math.max(0, Math.min(100, (left / ui.restTotal) * 100));
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span class="time">${fmtClock(left)}</span>
    <span class="lbl">Rest</span>
    <button class="btn small" data-act="rest-minus">−15</button>
    <button class="btn small" data-act="rest-plus">+15</button>
    <button class="btn small btn-accent" data-act="rest-skip">Skip</button>
    <span class="bar" style="width:${pct}%"></span>`;
}

/* ---------- "Install the app" hint (iPhone + Android) ---------- */
let installEvent = null; // Android/Chrome lets us show its own install window
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (!(document.activeElement && document.activeElement.tagName === 'INPUT')) render();
});
window.addEventListener('appinstalled', () => { installEvent = null; render(); });

function installHint(dismissable) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const close = dismissable ? '<button class="icon-btn" data-act="hide-install" aria-label="Hide">✕</button>' : '';
  const card = (body) => `<div class="card install-hint">
      <div class="row between"><b>📲 Install the app</b>${close}</div>
      <div class="muted small" style="margin-top:4px">${body}</div>
    </div>`;
  if (isIOS) return card('In <b>Safari</b> tap <b>Share</b> (□↑) → <b>Add to Home Screen</b> → <b>Add</b>. It opens full screen like a real app and works offline.');
  if (installEvent) return card(`Add it to your home screen — it works like a real app, even offline.
      <button class="btn btn-accent wide" style="margin-top:10px" data-act="install-app">Install app</button>`);
  if (/android/i.test(ua)) return card('In <b>Chrome</b> tap the menu <b>⋮</b> → <b>Add to Home screen</b> (or <b>Install app</b>).');
  return '';
}

/* ---------- views ---------- */
function renderToday() {
  const now = Date.now();
  const thisWeek = db.workouts.filter((w) => w.date >= startOfWeek()).length;
  const thisMonth = db.workouts.filter((w) => new Date(w.date).getMonth() === new Date().getMonth() && new Date(w.date).getFullYear() === new Date().getFullYear()).length;
  const last = db.workouts[db.workouts.length - 1];
  return `
    <div class="page-head">
      <div class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1>Today</h1>
    </div>

    ${db.settings.hideInstall ? '' : installHint(true)}

    ${db.active ? `
      <div class="card resume">
        <div><div class="small muted">In progress · ${fmtDur(now - db.active.startedAt)}</div><h3>${esc(db.active.name)}</h3></div>
        <button class="btn btn-accent" data-act="resume">Resume</button>
      </div>` : ''}

    <div class="section-title">Your programs</div>
    <div class="program-grid">
      ${db.programs.map((p) => {
        const kinds = [...new Set(p.exerciseIds.map((id) => exById(id).type))];
        return `<button class="program-tile" data-act="start" data-id="${p.id}">
          <span class="name">${esc(p.name)}</span>
          <span class="sub">${kinds.map((k) => `<span class="dot ${k}"></span>`).join('')}${p.exerciseIds.length} exercise${p.exerciseIds.length === 1 ? '' : 's'}</span>
        </button>`;
      }).join('')}
      <button class="program-tile add-tile ${db.programs.length ? '' : 'first'}" data-act="new-program">
        <span class="plus">＋</span>
        <span class="name">Add program</span>
        ${db.programs.length ? '' : '<span class="sub">Create your first workout program</span>'}
      </button>
      <button class="program-tile cardio-tile" data-act="cardio-menu">
        <span class="name">Cardio / Movement</span>
        <span class="sub">🏃 🏊 🚶 🪢 &nbsp;Running · Swimming · Walking · Jump rope</span>
      </button>
    </div>

    <div class="section-title">Stats</div>
    <div class="stat-row">
      <div class="stat"><div class="num">${thisWeek}</div><div class="lbl">This week</div></div>
      <div class="stat"><div class="num">${thisMonth}</div><div class="lbl">This month</div></div>
      <div class="stat"><div class="num">${db.workouts.length}</div><div class="lbl">All time</div></div>
    </div>

    ${last ? `<div class="section-title">Last workout</div>${renderWorkoutCard(last)}` : ''}
  `;
}

function renderWorkout() {
  const w = db.active;
  return `
    <header class="wk-head">
      <button class="icon-btn" data-act="minimize" aria-label="Back">‹</button>
      <div class="wk-title">
        <input class="title-input" data-act="rename" value="${esc(w.name)}" aria-label="Workout name">
        <div class="muted small" id="elapsed">${fmtDur(Date.now() - w.startedAt)}</div>
      </div>
      <button class="btn btn-accent" data-act="finish">Finish</button>
    </header>

    ${w.entries.length ? w.entries.map(renderEntry).join('') : `<div class="empty"><div class="big">🏋️</div>Add your first exercise</div>`}

    <button class="btn btn-ghost wide" data-act="add-exercise">+ Add exercise</button>
    <button class="btn btn-danger-ghost wide" data-act="cancel-workout">Cancel workout</button>
  `;
}

function renderEntry(e, i) {
  const ex = exById(e.exerciseId);
  const head = `<div class="ex-head"><h3>${esc(ex.name)}</h3><button class="icon-btn" data-act="remove-entry" data-e="${i}" aria-label="Remove">✕</button></div>`;

  if (ex.type === 'cardio') {
    return `<section class="card ex-card cardio">${head}
      <div class="field-grid">
        <div class="field"><label>Minutes</label><input class="num-input" inputmode="decimal" data-f="minutes" data-e="${i}" value="${esc(e.minutes)}" placeholder="${e.prev ? e.prev.minutes : '30'}"></div>
        <div class="field"><label>Km</label><input class="num-input" inputmode="decimal" data-f="km" data-e="${i}" value="${esc(e.km)}" placeholder="${e.prev ? e.prev.km : '5'}"></div>
        <div class="field"><label>Pace</label><div class="num-input" style="display:grid;place-items:center" id="sum-${i}">${cardioPace(e)}</div></div>
      </div>
      ${e.prev ? `<div class="calc">Last time: <b>${e.prev.minutes} min · ${e.prev.km} km</b></div>` : ''}
    </section>`;
  }

  if (ex.type === 'rope') {
    return `<section class="card ex-card rope">${head}
      <div class="field-grid">
        <div class="field"><label>Minutes</label><input class="num-input" inputmode="decimal" data-f="minutes" data-e="${i}" value="${esc(e.minutes)}" placeholder="${e.prev ? e.prev.minutes : '10'}"></div>
        <div class="field"><label>Jumps</label><input class="num-input" inputmode="numeric" data-f="jumps" data-e="${i}" value="${esc(e.jumps)}" placeholder="${e.prev ? e.prev.jumps : '1000'}"></div>
        <div class="field"><label>Per min</label><div class="num-input" style="display:grid;place-items:center" id="sum-${i}">${ropeRate(e)}</div></div>
      </div>
      ${e.prev ? `<div class="calc">Last time: <b>${e.prev.minutes} min · ${e.prev.jumps} jumps</b></div>` : ''}
    </section>`;
  }

  if (ex.type === 'swim') {
    return `<section class="card ex-card swim">${head}
      <div class="field-grid">
        <div class="field"><label>Laps</label><input class="num-input" inputmode="numeric" data-f="laps" data-e="${i}" value="${esc(e.laps)}" placeholder="${e.prev ? e.prev.laps : '40'}"></div>
        <div class="field"><label>Pool (m)</label><input class="num-input" inputmode="numeric" data-f="pool" data-e="${i}" value="${esc(e.pool)}"></div>
        <div class="field"><label>Minutes</label><input class="num-input" inputmode="decimal" data-f="minutes" data-e="${i}" value="${esc(e.minutes)}" placeholder="${e.prev ? e.prev.minutes : '30'}"></div>
      </div>
      <div class="calc" id="sum-${i}">${swimSummary(e)}</div>
      ${e.prev ? `<div class="calc">Last time: <b>${e.prev.laps} laps · ${e.prev.minutes} min</b></div>` : ''}
    </section>`;
  }

  return `<section class="card ex-card">${head}
    <div class="set-grid head"><span>Set</span><span>Last time</span><span>kg</span><span>Reps</span><span></span></div>
    ${e.sets.map((s, j) => `
      <div class="set-grid ${s.done ? 'done' : ''}">
        <span class="set-no">${j + 1}</span>
        <span class="prev">${s.prev ? `${s.prev.kg} × ${s.prev.reps}` : '—'}</span>
        <input class="num-input" inputmode="decimal" data-f="kg" data-e="${i}" data-s="${j}" value="${esc(s.kg)}" placeholder="${s.prev ? s.prev.kg : (j > 0 ? esc(e.sets[j - 1].kg) : 'kg')}">
        <input class="num-input" inputmode="numeric" data-f="reps" data-e="${i}" data-s="${j}" value="${esc(s.reps)}" placeholder="${s.prev ? s.prev.reps : (j > 0 ? esc(e.sets[j - 1].reps) : 'reps')}">
        <button class="check" data-act="toggle-set" data-e="${i}" data-s="${j}" aria-label="Done">✓</button>
      </div>`).join('')}
    <div class="set-actions">
      <button class="btn small" data-act="add-set" data-e="${i}">+ Add set</button>
      ${e.sets.length > 1 ? `<button class="btn small btn-danger-ghost" data-act="remove-set" data-e="${i}">− Remove set</button>` : ''}
    </div>
  </section>`;
}

function cardioPace(e) {
  const m = num(e.minutes), km = num(e.km);
  if (!m || !km) return '—';
  const secPerKm = Math.round((m * 60) / km);
  return `${fmtClock(secPerKm)}/km`;
}
function ropeRate(e) {
  const m = num(e.minutes), j = num(e.jumps);
  return m && j ? `${Math.round(j / m)}` : '—';
}
function swimSummary(e) {
  const meters = num(e.laps) * (num(e.pool) || 25);
  if (!meters) return 'Distance is worked out from laps × pool length.';
  const m = num(e.minutes);
  const pace = m ? ` · <b>${fmtClock(Math.round((m * 60) / (meters / 100)))}</b> per 100 m` : '';
  return `Distance: <b>${meters} m</b>${pace}`;
}

function entryText(e) {
  const ex = exById(e.exerciseId);
  if (ex.type === 'cardio') return `${e.minutes} min · ${e.km} km${e.minutes && e.km ? ` · ${cardioPace(e)}` : ''}`;
  if (ex.type === 'rope') return `${e.minutes} min${e.jumps ? ` · ${e.jumps} jumps · ${ropeRate(e)}/min` : ''}`;
  if (ex.type === 'swim') return `${e.meters} m (${e.laps} × ${e.pool} m)${e.minutes ? ` · ${e.minutes} min` : ''}`;
  return e.sets.map((s) => `${s.kg}×${s.reps}`).join(', ');
}

function renderWorkoutCard(w, withDelete = false) {
  return `<div class="card wk-card">
    <div class="row between">
      <div><h3>${esc(w.name)}</h3><div class="muted small">${fmtDate(w.date)} · ${fmtDur(w.duration)}${w.prs ? ` · <span class="pr-badge">🏆 ${w.prs} PR</span>` : ''}</div></div>
      ${withDelete ? `<button class="icon-btn" data-act="delete-workout" data-id="${w.id}" aria-label="Delete">🗑</button>` : ''}
    </div>
    ${w.entries.map((e) => `<div class="entry-line"><span class="n">${esc(exById(e.exerciseId).name)}</span><span class="v">${entryText(e)}</span></div>`).join('')}
  </div>`;
}

function renderHistory() {
  const m = ui.histMonth;
  const year = m.getFullYear(), month = m.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const byDay = {};
  for (const w of db.workouts) (byDay[dayKey(w.date)] ||= []).push(w);
  const today = dayKey(Date.now());

  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="wd">${d}</div>`).join('');
  cells += '<div></div>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const key = dayKey(new Date(year, month, d));
    const ws = byDay[key] || [];
    const kinds = [...new Set(ws.flatMap(workoutKinds))];
    cells += `<button class="day ${ws.length ? 'has' : ''} ${key === today ? 'today' : ''} ${key === ui.histDay ? 'sel' : ''}" data-act="hist-day" data-day="${key}">
      ${d}<span class="dots">${kinds.map((k) => `<i class="${k}"></i>`).join('')}</span></button>`;
  }

  const list = ui.histDay
    ? (byDay[ui.histDay] || [])
    : db.workouts.slice(-15).reverse();

  return `
    <div class="page-head"><h1>History</h1><div class="muted">${db.workouts.length} workouts logged</div></div>
    <div class="card">
      <div class="cal-head">
        <button class="icon-btn" data-act="hist-prev" aria-label="Previous month">‹</button>
        <h2>${m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <button class="icon-btn" data-act="hist-next" aria-label="Next month">›</button>
      </div>
      <div class="cal">${cells}</div>
    </div>
    <div class="section-title row between">
      <span>${ui.histDay ? fmtDate(ui.histDay + 'T12:00') : 'Recent workouts'}</span>
      ${ui.histDay ? '<button class="small" style="color:var(--accent);font-weight:700" data-act="hist-all">Show recent</button>' : ''}
    </div>
    ${list.length ? list.map((w) => renderWorkoutCard(w, true)).join('') : '<div class="empty">No workouts on this day.</div>'}
  `;
}

function renderProgress() {
  const used = db.exercises.filter((ex) => db.workouts.some((w) => w.entries.some((e) => e.exerciseId === ex.id)));
  if (!used.length) {
    return `<div class="page-head"><h1>Progress</h1></div>
      <div class="empty"><div class="big">📈</div>Finish your first workout to see your progress here.</div>`;
  }
  if (!ui.progEx || !used.some((e) => e.id === ui.progEx)) ui.progEx = used[0].id;
  const ex = exById(ui.progEx);
  const sessions = db.workouts.map((w) => ({ w, e: w.entries.find((x) => x.exerciseId === ex.id) })).filter((x) => x.e);

  let points, color, unit, stats;
  if (ex.type === 'strength') {
    points = sessions.map(({ w, e }) => ({ x: w.date, y: Math.max(...e.sets.map((s) => s.kg)) }));
    const best1rm = Math.max(...sessions.flatMap(({ e }) => e.sets.map((s) => e1rm(s.kg, s.reps))));
    color = 'var(--accent)'; unit = 'kg';
    stats = [[`${Math.max(...points.map((p) => p.y))} kg`, 'Heaviest'], [`${round(best1rm)} kg`, 'Est. 1RM'], [sessions.length, 'Sessions']];
  } else if (ex.type === 'cardio') {
    points = sessions.map(({ w, e }) => ({ x: w.date, y: e.km }));
    const total = points.reduce((a, p) => a + p.y, 0);
    color = 'var(--cardio)'; unit = 'km';
    stats = [[`${round(Math.max(...points.map((p) => p.y)))} km`, 'Longest'], [`${round(total)} km`, 'Total'], [sessions.length, 'Sessions']];
  } else if (ex.type === 'rope') {
    points = sessions.map(({ w, e }) => ({ x: w.date, y: e.minutes }));
    const jumps = sessions.reduce((a, { e }) => a + (e.jumps || 0), 0);
    color = 'var(--rope)'; unit = 'min';
    stats = [[`${Math.max(...points.map((p) => p.y))} min`, 'Longest'], [jumps.toLocaleString('en-GB'), 'Total jumps'], [sessions.length, 'Sessions']];
  } else {
    points = sessions.map(({ w, e }) => ({ x: w.date, y: e.meters }));
    const total = points.reduce((a, p) => a + p.y, 0);
    color = 'var(--swim)'; unit = 'm';
    stats = [[`${Math.max(...points.map((p) => p.y))} m`, 'Longest'], [`${round(total / 1000, 2)} km`, 'Total'], [sessions.length, 'Sessions']];
  }

  return `
    <div class="page-head"><h1>Progress</h1></div>
    <select class="select" id="prog-select" aria-label="Exercise">
      ${TYPES.map((t) => {
        const group = used.filter((e) => e.type === t);
        return group.length ? `<optgroup label="${TYPE_LABEL[t]}">${group.map((e) => `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>` : '';
      }).join('')}
    </select>
    <div class="section-title">${ex.type === 'strength' ? 'Top set weight' : ex.type === 'rope' ? 'Time' : 'Distance'} (${unit})</div>
    <div class="card">${chart(points, color, unit)}</div>
    <div class="stat-row" style="margin-top:12px">
      ${stats.map(([n, l]) => `<div class="stat"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('')}
    </div>
    <div class="section-title">Recent sessions</div>
    <div class="card">
      ${sessions.slice(-8).reverse().map(({ w, e }) => `<div class="entry-line"><span class="n">${fmtShort(w.date)}</span><span class="v">${entryText(e)}</span></div>`).join('')}
    </div>
  `;
}

/** Simple SVG line chart. */
function chart(points, color, unit) {
  const W = 340, H = 170, L = 38, R = 12, T = 12, B = 26;
  if (!points.length) return '';
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min = Math.max(0, min - 5); max = max + 5; }
  const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
  const X = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const Y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const gridVals = [min, (min + max) / 2, max];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">
    ${gridVals.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lbl" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${round(v, 0)}</text>`).join('')}
    <path class="line" d="${path}" stroke="${color}"/>
    ${points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="${i === points.length - 1 ? 5 : 3.5}" fill="${color}"><title>${fmtShort(p.x)}: ${p.y} ${unit}</title></circle>`).join('')}
    <text class="lbl" x="${L}" y="${H - 6}">${fmtShort(points[0].x)}</text>
    ${points.length > 1 ? `<text class="lbl" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(points[points.length - 1].x)}</text>` : ''}
  </svg>`;
}

function renderPrograms() {
  return `
    <div class="page-head row between">
      <h1>Programs</h1>
      <button class="btn btn-accent small" data-act="new-program">+ New</button>
    </div>
    ${db.programs.map((p) => `
      <div class="card prog-card">
        <h3>${esc(p.name)}</h3>
        <div class="ex-list">${p.exerciseIds.map((id) => esc(exById(id).name)).join(' · ') || 'No exercises yet'}</div>
        <div class="row">
          <button class="btn btn-accent small" data-act="start" data-id="${p.id}">Start</button>
          <button class="btn small" data-act="edit-program" data-id="${p.id}">Edit</button>
        </div>
      </div>`).join('') || `<div class="empty"><div class="big">📋</div>No programs yet.<br>
      <button class="btn btn-accent" style="margin-top:14px" data-act="new-program">+ Add program</button></div>`}

    <div class="section-title">Account</div>
    <div class="card">
      ${Auth.user ? `
        <div class="setting">
          <span>${esc(Auth.user.email)}<div class="muted small" id="sync-status">${syncText()}</div></span>
          <button class="btn small" data-act="logout">Log out</button>
        </div>
        <div class="setting">
          <span>Password</span>
          <button class="btn small" data-act="change-password">Change</button>
        </div>
        <div class="setting">
          <span>Delete account<div class="muted small">Removes your account and all your data</div></span>
          <button class="btn small btn-danger-ghost" data-act="delete-account">Delete</button>
        </div>` : `
        <div class="setting">
          <span>Not logged in<div class="muted small">Your data is only on this phone</div></span>
          <button class="btn btn-accent small" data-act="to-login">Log in / Sign up</button>
        </div>`}
    </div>

    <div class="section-title">Settings</div>
    <div class="card">
      <div class="setting">
        <span>Rest timer</span>
        <select class="select" id="rest-select">
          ${[45, 60, 90, 120, 150, 180, 240].map((s) => `<option value="${s}" ${s === db.settings.rest ? 'selected' : ''}>${fmtClock(s)}</option>`).join('')}
        </select>
      </div>
      <div class="setting">
        <span>Backup<div class="muted small">Download a copy of all your data</div></span>
        <div class="row">
          <button class="btn small" data-act="export">Export</button>
          <label class="btn small">Import<input type="file" id="import-file" accept="application/json" hidden></label>
        </div>
      </div>
      <div class="setting"><span class="muted small">My Fitness Log v${APP_VERSION}</span><a class="small" style="color:var(--accent);font-weight:700" href="privacy.html">Privacy Policy</a></div>
    </div>
  `;
}

/* ---------- pop-up sheets ---------- */
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal').innerHTML = '';
}

function openPicker(forWhat) {
  ui.pickerFor = forWhat;
  const groups = TYPES.map((t) => {
    const list = db.exercises.filter((e) => e.type === t).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="pick-group" data-group>
      <div class="section-title" style="margin:6px 0">${TYPE_LABEL[t]}</div>
      ${list.map((e) => `<button class="pick-item" data-act="pick" data-id="${e.id}" data-name="${esc(e.name.toLowerCase())}"><span>${esc(e.name)}</span><span class="tag">＋</span></button>`).join('')}
    </div>`;
  }).join('');
  openModal(`
    <div class="sheet-head"><h2>Add exercise</h2><button class="icon-btn" data-act="picker-close">✕</button></div>
    <input class="text-input" id="picker-search" placeholder="Search…" autocomplete="off">
    ${groups}
    <div class="section-title">Create new exercise</div>
    <div class="stack">
      <input class="text-input" id="new-ex-name" placeholder="Exercise name">
      <div class="row">
        <select class="select" id="new-ex-type" style="flex:1">
          <option value="strength">Strength (sets × kg × reps)</option>
          <option value="cardio">Cardio (time + km)</option>
          <option value="swim">Swimming (laps + pool)</option>
          <option value="rope">Jump rope (time + jumps)</option>
        </select>
        <button class="btn btn-accent" data-act="create-ex">Add</button>
      </div>
    </div>
  `);
}

function pickExercise(id) {
  if (ui.pickerFor === 'editor') {
    if (!ui.editing.exerciseIds.includes(id)) ui.editing.exerciseIds.push(id);
    openEditor();
  } else {
    db.active.entries.push(makeEntry(id));
    save();
    closeModal();
    render();
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  }
}

/** "Add program": pick a ready-made program or start from scratch. */
function openTemplates() {
  ui.editing = null;
  openModal(`
    <div class="sheet-head"><h2>Add program</h2><button class="icon-btn" data-act="editor-close">✕</button></div>
    <button class="btn btn-accent wide" data-act="create-program">＋ Create your own program</button>
    <div class="section-title">Or start from a ready-made one</div>
    <p class="muted small" style="margin:-4px 0 12px">You can add, remove and reorder exercises before saving.</p>
    ${PROGRAM_TEMPLATES.map((t, i) => `
      <button class="template-card" data-act="use-template" data-i="${i}">
        <div class="row between"><span class="name">${esc(t.name)}</span><span class="tag">Use ›</span></div>
        <div class="small muted">${esc(t.tag)}</div>
        <div class="desc small">${esc(t.desc)}</div>
        <div class="ex small">${t.exercises.map(esc).join(' · ')}</div>
      </button>`).join('')}
  `);
}

function openEditor() {
  const p = ui.editing;
  openModal(`
    <div class="sheet-head">
      ${!p.id ? '<button class="icon-btn" data-act="to-templates" aria-label="Back">‹</button>' : ''}
      <h2>${p.id ? 'Edit program' : 'New program'}</h2><button class="icon-btn" data-act="editor-close">✕</button></div>
    <input class="text-input" id="prog-name" placeholder="Program name (e.g. Push)" value="${esc(p.name)}">
    <div class="section-title">Exercises</div>
    ${p.exerciseIds.length ? p.exerciseIds.map((id, i) => `
      <div class="editor-item">
        <span class="n"><span class="dot ${exById(id).type}"></span>${esc(exById(id).name)}</span>
        ${i > 0 ? `<button class="icon-btn" data-act="ed-up" data-i="${i}" aria-label="Move up">↑</button>` : ''}
        <button class="icon-btn" data-act="ed-remove" data-i="${i}" aria-label="Remove">✕</button>
      </div>`).join('') : '<div class="muted small">No exercises yet.</div>'}
    <button class="btn btn-ghost wide" style="margin-top:12px" data-act="ed-add">+ Add exercise</button>
    <button class="btn btn-accent wide" style="margin-top:16px" data-act="ed-save">Save program</button>
    ${p.id ? '<button class="btn btn-danger-ghost wide" data-act="ed-delete">Delete program</button>' : ''}
  `);
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- main render ---------- */
function render() {
  document.body.classList.toggle('auth-screen', !db);
  if (!db) { $('#view').innerHTML = renderAuth(); renderRest(); return; }
  if (ui.tab === 'workout' && !db.active) ui.tab = 'today';
  const views = { today: renderToday, workout: renderWorkout, history: renderHistory, progress: renderProgress, programs: renderPrograms };
  $('#view').innerHTML = views[ui.tab]();
  document.querySelectorAll('.nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab || (ui.tab === 'workout' && b.dataset.tab === 'today'));
  });
  renderRest();
}

/* ---------- actions (all buttons use data-act="...") ---------- */
const actions = {
  tab: (d) => { ui.tab = d.tab === 'today' && db.active ? 'workout' : d.tab; render(); window.scrollTo(0, 0); },
  start: (d) => startWorkout(d.id),
  resume: () => { ui.tab = 'workout'; render(); },
  minimize: () => { ui.tab = 'today'; render(); },
  finish: () => finishWorkout(),
  'cancel-workout': () => { if (confirm('Cancel this workout? Nothing will be saved.')) discardWorkout(); },
  'add-exercise': () => openPicker('workout'),
  'remove-entry': (d) => {
    const name = exById(db.active.entries[d.e].exerciseId).name;
    if (confirm(`Remove ${name}?`)) { db.active.entries.splice(+d.e, 1); save(); render(); }
  },
  'add-set': (d) => {
    const e = db.active.entries[+d.e];
    const last = e.sets[e.sets.length - 1];
    e.sets.push({ kg: last ? last.kg : '', reps: '', done: false, prev: null });
    save(); render();
  },
  'remove-set': (d) => { db.active.entries[+d.e].sets.pop(); save(); render(); },
  'toggle-set': (d) => toggleSet(+d.e, +d.s),

  'rest-skip': () => { ui.restEnd = null; renderRest(); },
  'rest-plus': () => { ui.restEnd += 15000; ui.restTotal += 15; renderRest(); },
  'rest-minus': () => { ui.restEnd -= 15000; renderRest(); },

  'hist-prev': () => { ui.histMonth = new Date(ui.histMonth.getFullYear(), ui.histMonth.getMonth() - 1, 1); render(); },
  'hist-next': () => { ui.histMonth = new Date(ui.histMonth.getFullYear(), ui.histMonth.getMonth() + 1, 1); render(); },
  'hist-day': (d) => { ui.histDay = ui.histDay === d.day ? null : d.day; render(); },
  'hist-all': () => { ui.histDay = null; render(); },
  'delete-workout': (d) => {
    if (!confirm('Delete this workout forever?')) return;
    db.workouts = db.workouts.filter((w) => w.id !== d.id);
    save(); render(); toast('Workout deleted');
  },

  'new-program': () => openTemplates(),
  'create-program': () => { ui.editing = { id: null, name: '', exerciseIds: [] }; openEditor(); },
  'use-template': (d) => {
    const t = PROGRAM_TEMPLATES[+d.i];
    const ids = t.exercises.map((n) => (db.exercises.find((e) => e.name === n) || { id: slug(n) }).id);
    ui.editing = { id: null, name: t.name, exerciseIds: ids };
    openEditor();
  },
  'to-templates': () => openTemplates(),
  'edit-program': (d) => { const p = progById(d.id); ui.editing = { id: p.id, name: p.name, exerciseIds: [...p.exerciseIds] }; openEditor(); },
  'editor-close': () => { ui.editing = null; closeModal(); },
  'ed-add': () => { ui.editing.name = $('#prog-name').value; openPicker('editor'); },
  'ed-up': (d) => {
    ui.editing.name = $('#prog-name').value;
    const a = ui.editing.exerciseIds, i = +d.i;
    [a[i - 1], a[i]] = [a[i], a[i - 1]];
    openEditor();
  },
  'ed-remove': (d) => { ui.editing.name = $('#prog-name').value; ui.editing.exerciseIds.splice(+d.i, 1); openEditor(); },
  'ed-save': () => {
    const name = $('#prog-name').value.trim();
    if (!name) { toast('Give the program a name'); return; }
    if (!ui.editing.exerciseIds.length) { toast('Add at least one exercise'); return; }
    if (ui.editing.id) Object.assign(progById(ui.editing.id), { name, exerciseIds: ui.editing.exerciseIds });
    else db.programs.push({ id: uid(), name, exerciseIds: ui.editing.exerciseIds });
    ui.editing = null; save(); closeModal(); render(); toast('Program saved');
  },
  'ed-delete': () => {
    if (!confirm('Delete this program? Your workout history stays.')) return;
    db.programs = db.programs.filter((p) => p.id !== ui.editing.id);
    ui.editing = null; save(); closeModal(); render();
  },

  pick: (d) => pickExercise(d.id),
  'cardio-menu': () => openCardioMenu(),
  activity: (d) => startActivity(d.id),
  'picker-close': () => { if (ui.pickerFor === 'editor') openEditor(); else closeModal(); },
  'create-ex': () => {
    const name = $('#new-ex-name').value.trim();
    const type = $('#new-ex-type').value;
    if (!name) { toast('Type an exercise name'); return; }
    let ex = db.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!ex) { ex = { id: uid(), name, type }; db.exercises.push(ex); save(); }
    pickExercise(ex.id);
  },

  'resend-code': async () => {
    try {
      await Auth.resendCode(ui.authEmail);
      ui.authMsg = { type: 'ok', text: `New code sent to ${ui.authEmail}.` };
    } catch (e) {
      ui.authMsg = { type: 'error', text: e.message };
    }
    render();
  },
  'auth-mode': (d) => { ui.authMode = d.mode; ui.authMsg = null; render(); },
  'to-login': () => { localStorage.removeItem('fitlog.skipAuth'); db = null; ui.authMode = 'login'; ui.authMsg = null; render(); },
  'skip-auth': () => { localStorage.setItem('fitlog.skipAuth', '1'); startSession(); },
  'change-password': () => { ui.authMode = 'newpass'; ui.authMsg = null; ui.changingPassword = true; db = null; render(); },
  'cancel-newpass': () => { ui.changingPassword = false; ui.authMode = 'login'; startSession(); },
  logout: async () => {
    if (sync.dirty) await syncNow();
    if (sync.dirty && !confirm('Some changes are not uploaded yet (no internet). Log out anyway? They stay saved on this phone.')) return;
    await Auth.signOut();
    db = null; ui.authMode = 'login'; ui.authMsg = null; ui.restEnd = null;
    render();
    window.scrollTo(0, 0);
  },
  'install-app': async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    render();
  },
  'delete-account': async () => {
    if (!confirm('Delete your account and ALL your workouts forever? This cannot be undone.')) return;
    const typed = prompt('To confirm, type DELETE');
    if ((typed || '').trim().toUpperCase() !== 'DELETE') { toast('Account not deleted'); return; }
    const id = Auth.user && Auth.user.id;
    try {
      await Auth.deleteAccount();
    } catch (e) {
      toast(e.message);
      return;
    }
    if (id) { localStorage.removeItem(`${DB_KEY}.${id}`); localStorage.removeItem(`fitlog.sync.${id}`); }
    db = null; ui.restEnd = null; ui.authMode = 'login';
    ui.authMsg = { type: 'ok', text: 'Your account and all your data were deleted.' };
    render();
    window.scrollTo(0, 0);
  },
  'hide-install': () => { db.settings.hideInstall = true; save(); render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fitness-log-backup-${dayKey(Date.now())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (el && el.tagName !== 'INPUT' && actions[el.dataset.act]) {
    actions[el.dataset.act](el.dataset, el);
    return;
  }
  // tap on the dark area behind a sheet closes it
  if (ev.target.id === 'modal') {
    if (ui.editing && ui.pickerFor === 'editor' && !$('#prog-name')) openEditor();
    else { ui.editing = null; closeModal(); }
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'auth-email') { ui.authEmail = t.value; return; }
  if (!db) return;
  if (t.dataset.act === 'rename' && db.active) { db.active.name = t.value; save(); return; }
  if (t.id === 'picker-search') {
    const q = t.value.trim().toLowerCase();
    document.querySelectorAll('.pick-item').forEach((b) => b.classList.toggle('hidden', !b.dataset.name.includes(q)));
    document.querySelectorAll('[data-group]').forEach((g) => g.classList.toggle('hidden', !g.querySelector('.pick-item:not(.hidden)')));
    return;
  }
  if (t.dataset.f && db.active) {
    const e = db.active.entries[+t.dataset.e];
    if (t.dataset.s !== undefined) e.sets[+t.dataset.s][t.dataset.f] = t.value.replace(',', '.');
    else e[t.dataset.f] = t.value.replace(',', '.');
    save();
    const sum = $(`#sum-${t.dataset.e}`);
    const type = exById(e.exerciseId).type;
    if (sum) sum.innerHTML = type === 'swim' ? swimSummary(e) : type === 'rope' ? ropeRate(e) : cardioPace(e);
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'prog-select') { ui.progEx = t.value; render(); }
  if (t.id === 'rest-select') { db.settings.rest = +t.value; save(); toast(`Rest timer: ${fmtClock(+t.value)}`); }
  if (t.id === 'import-file' && t.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.version !== 1 || !Array.isArray(data.workouts)) throw new Error('bad file');
        if (!confirm(`Replace all data on this phone with the backup (${data.workouts.length} workouts)?`)) return;
        db = data; save(); render(); toast('Backup imported ✅');
      } catch (e) { toast('That is not a valid backup file'); }
    };
    reader.readAsText(t.files[0]);
  }
});

/* ---------- clock: workout time + rest countdown ---------- */
setInterval(() => {
  if (!db || !db.active) return;
  const el = $('#elapsed');
  if (el) el.textContent = fmtDur(Date.now() - db.active.startedAt);
  if (ui.restEnd) renderRest();
}, 1000);

/* ---------- offline support ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ---------- login / sign-up screen ---------- */
function renderAuth() {
  const m = ui.authMode;
  const msg = ui.authMsg ? `<div class="auth-msg ${ui.authMsg.type}">${esc(ui.authMsg.text)}</div>` : '';
  const head = `
    <div class="auth-head">
      <img src="icons/icon-192.png" alt="" class="auth-logo">
      <h1>My Fitness Log</h1>
      <p class="muted">Simple tracking for lifting, cardio and swimming.</p>
    </div>
    ${installHint(false)}`;

  if (!Auth.configured) {
    return `<div class="auth">${head}
      <div class="card stack">
        <h3>Accounts are not set up yet</h3>
        <p class="muted small">Add your Supabase project details to <b>config.js</b>. The steps are in <b>SETUP-ACCOUNTS.md</b>. Until then you can use the app without an account.</p>
        <button class="btn btn-accent wide" data-act="skip-auth">Continue without account</button>
      </div></div>`;
  }

  const email = `<input class="text-input" type="email" id="auth-email" placeholder="Email" autocomplete="email" inputmode="email" value="${esc(ui.authEmail)}" required>`;

  if (m === 'forgot') {
    return `<div class="auth">${head}
      <form class="card stack" id="auth-form">
        <h3>Reset password</h3>
        <p class="muted small">We'll email you a link to set a new password.</p>
        ${email}${msg}
        <button class="btn btn-accent wide" type="submit">Send reset link</button>
      </form>
      <button class="link-btn" data-act="auth-mode" data-mode="login">← Back to log in</button>
    </div>`;
  }

  if (m === 'verify') {
    return `<div class="auth">${head}
      <form class="card stack" id="auth-form">
        <h3>Check your email</h3>
        <p class="muted small" style="margin:0">We sent an email to <b>${esc(ui.authEmail)}</b>. Type the code from it here — or, if the email has a link instead, open the link. Can't find it? Look in spam.</p>
        <input class="text-input code-input" id="auth-code" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>
        ${msg}
        <button class="btn btn-accent wide" type="submit">Confirm</button>
      </form>
      <button class="link-btn" data-act="resend-code">Send a new code</button>
      <button class="link-btn" data-act="auth-mode" data-mode="login">← Back to log in</button>
    </div>`;
  }

  if (m === 'newpass') {
    return `<div class="auth">${head}
      <form class="card stack" id="auth-form">
        <h3>Set a new password</h3>
        <input class="text-input" type="password" id="auth-pass" placeholder="New password (min. 6 characters)" autocomplete="new-password" required>
        <input class="text-input" type="password" id="auth-pass2" placeholder="Repeat new password" autocomplete="new-password" required>
        ${msg}
        <button class="btn btn-accent wide" type="submit">Save new password</button>
      </form>
      ${ui.changingPassword ? '<button class="link-btn" data-act="cancel-newpass">Cancel</button>' : ''}
    </div>`;
  }

  const signup = m === 'signup';
  return `<div class="auth">${head}
    <div class="auth-tabs">
      <button class="${!signup ? 'active' : ''}" data-act="auth-mode" data-mode="login">Log in</button>
      <button class="${signup ? 'active' : ''}" data-act="auth-mode" data-mode="signup">Sign up</button>
    </div>
    <form class="card stack" id="auth-form">
      ${email}
      <input class="text-input" type="password" id="auth-pass" placeholder="${signup ? 'Password (min. 6 characters)' : 'Password'}" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
      ${signup ? '<input class="text-input" type="password" id="auth-pass2" placeholder="Repeat password" autocomplete="new-password" required>' : ''}
      ${msg}
      ${signup ? '<p class="muted small" style="margin:0">By creating an account you agree to the <a href="privacy.html" style="color:var(--accent)">Privacy Policy</a>.</p>' : ''}
      <button class="btn btn-accent wide" type="submit">${signup ? 'Create account' : 'Log in'}</button>
    </form>
    ${!signup ? '<button class="link-btn" data-act="auth-mode" data-mode="forgot">Forgot password?</button>' : ''}
    <a class="muted small" style="display:block;text-align:center;margin-top:18px" href="privacy.html">Privacy Policy</a>
  </div>`;
}

async function handleAuthSubmit(form) {
  const val = (id) => { const el = $(id); return el ? el.value : ''; };
  const email = val('#auth-email').trim();
  const pass = val('#auth-pass');
  const pass2 = val('#auth-pass2');
  const fail = (text) => { ui.authMsg = { type: 'error', text }; render(); };
  const btn = form.querySelector('button[type=submit]');
  const newPassword = ui.authMode === 'signup' || ui.authMode === 'newpass';

  if (newPassword && pass.length < 6) return fail('Password must be at least 6 characters.');
  if (newPassword && pass !== pass2) return fail('The passwords do not match.');

  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    if (ui.authMode === 'login') {
      try {
        await Auth.signIn(email, pass);
      } catch (e) {
        if (!e.unconfirmed) throw e;
        // account exists but was never confirmed → send a fresh code and ask for it
        ui.authEmail = email;
        ui.authMode = 'verify';
        try { await Auth.resendCode(email); } catch (e2) { /* code from before may still work */ }
        ui.authMsg = { type: 'ok', text: 'Your email is not confirmed yet. We sent you a new code.' };
        render();
        return;
      }
      ui.authMsg = null;
      startSession();
      toast('Welcome back 👋');
    } else if (ui.authMode === 'signup') {
      const r = await Auth.signUp(email, pass);
      if (r.loggedIn) { ui.authMsg = null; startSession(); toast('Account created 🎉'); return; }
      ui.authEmail = email;
      ui.authMode = 'verify';
      ui.authMsg = null;
      render();
      setTimeout(() => { const c = $('#auth-code'); if (c) c.focus(); }, 50);
    } else if (ui.authMode === 'verify') {
      const code = val('#auth-code').replace(/\D/g, '');
      if (code.length < 6) return fail('Type the code from the email.');
      await Auth.verifyCode(ui.authEmail, code);
      ui.authMsg = null;
      ui.authMode = 'login';
      startSession();
      toast('Account created 🎉');
    } else if (ui.authMode === 'forgot') {
      await Auth.recover(email);
      ui.authMsg = { type: 'ok', text: `If ${email} has an account, a reset link is on its way. Check your inbox (and spam).` };
      render();
    } else if (ui.authMode === 'newpass') {
      await Auth.updatePassword(pass);
      ui.authMsg = null;
      ui.authMode = 'login';
      ui.changingPassword = false;
      startSession();
      toast('Password changed ✅');
    }
  } catch (e) {
    fail(e.message || 'Something went wrong.');
  }
}

document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'auth-form') { ev.preventDefault(); handleAuthSubmit(ev.target); }
});

/** Opens the app for the logged-in user (or without an account). */
function startSession() {
  db = load();
  ui.tab = db.active ? 'workout' : 'today';
  ui.syncStatus = null;
  render();
  window.scrollTo(0, 0);
  pullSync();
}

window.addEventListener('online', () => { if (sync.dirty) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullSync(); });

/* ---------- start ---------- */
(async function boot() {
  if (Auth.configured) {
    const r = await Auth.handleRedirect();
    if (r && r.error) ui.authMsg = { type: 'error', text: r.error };
    if (r && r.type === 'recovery') { ui.authMode = 'newpass'; render(); return; }
    if (r && r.type && Auth.user) { startSession(); toast('Email confirmed — welcome! 🎉'); return; }
  }
  if (Auth.user || (!Auth.configured && localStorage.getItem('fitlog.skipAuth'))) startSession();
  else render();
})();
