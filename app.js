// BUG Lab course program. All course data lives in schedule.json; this file only renders it.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
const VIEWS = { mandatory: 'mandatory', electives: 'elective', 'my-week': null };
const ICON_CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>';

const phoneQuery = window.matchMedia('(max-width: 759px)');
const state = {
  data: null,
  view: 'mandatory',
  hidden: { mandatory: new Set(), elective: new Set() },
  room: '', lect: '', query: '',
  selected: null,
  day: DAYS[new Date().getDay() - 1] || 'Mon',
  picks: new Map(), // course code -> section number
  lastFocus: null,
};

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const lower = (s) => String(s).toLocaleLowerCase('tr');
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) p.startsWith('--') ? n.style.setProperty(p, val) : (n.style[p] = val);
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
};
const type = () => VIEWS[state.view];
const groupOf = (c) => state.data.groups[c.type].items[c.group];
const colors = (c) => { const g = groupOf(c); return { '--fill': g.fill, '--accent': g.accent }; };
const courseBy = (code) => state.data.courses.find((c) => c.code === code);
const pickKey = (code, sec) => `${code}|${sec}`;
// A shared week (opened from someone's link) is shown read-only in place of the viewer's own picks.
const activePicks = () => state.shared || state.picks;
const isPicked = (c, s) => activePicks().get(c.code) === s.section;
const roomPill = (s) => el('span', { class: s.online ? 'pill online' : 'pill' }, s.room);
const overlaps = (a, b) => a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/* ---------- storage (per-viewer convenience only) ---------- */
const storeKey = () => `bug-picks:${state.data.semester}`;
function loadPicks() {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey()) || '{}');
    for (const [code, sec] of Object.entries(raw)) {
      const c = courseBy(code);
      if (c && c.sections.some((s) => s.section === sec)) state.picks.set(code, sec);
    }
  } catch { /* storage unavailable: start empty */ }
}
function savePicks() {
  try { localStorage.setItem(storeKey(), JSON.stringify(Object.fromEntries(state.picks))); } catch { /* ignore */ }
}

/* ---------- data shaping ---------- */
function pickedEntries() {
  return [...activePicks()].map(([code, sec]) => {
    const course = courseBy(code);
    return { course, s: course.sections.find((x) => x.section === sec) };
  }).filter((p) => p.s)
    .sort((a, b) => DAYS.indexOf(a.s.day) - DAYS.indexOf(b.s.day) || toMin(a.s.start) - toMin(b.s.start));
}

function clashInfo() {
  const list = pickedEntries();
  const keys = new Set(); const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(list[i].s, list[j].s)) {
        keys.add(pickKey(list[i].course.code, list[i].s.section));
        keys.add(pickKey(list[j].course.code, list[j].s.section));
        pairs.push([list[i], list[j]]);
      }
    }
  }
  return { keys, pairs };
}

function sectionPasses(c, s) {
  if (state.hidden[c.type].has(c.group)) return false;
  if (state.room && s.room !== state.room) return false;
  if (state.lect && s.lecturer !== state.lect) return false;
  const q = lower(state.query.trim());
  if (q && !lower([c.code, c.name, s.lecturer, s.room].join(' ')).includes(q)) return false;
  return true;
}

// Sections of the same course at the same day/time (e.g. Senior Game Project 1–4) become one block.
function blocks() {
  const out = new Map();
  if (state.view === 'my-week') {
    for (const { course, s } of pickedEntries()) out.set(pickKey(course.code, s.section), { course, day: s.day, start: s.start, end: s.end, sections: [s] });
    return [...out.values()];
  }
  for (const c of state.data.courses) {
    if (c.type !== type()) continue;
    for (const s of c.sections) {
      if (!sectionPasses(c, s)) continue;
      const key = `${c.code}|${s.day}|${s.start}|${s.end}`;
      if (!out.has(key)) out.set(key, { course: c, day: s.day, start: s.start, end: s.end, sections: [] });
      out.get(key).sections.push(s);
    }
  }
  return [...out.values()];
}

// Greedy lane assignment so overlapping blocks sit side by side.
function assignLanes(list) {
  list.sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  const ends = [];
  for (const b of list) {
    let lane = ends.findIndex((e) => e <= toMin(b.start));
    if (lane === -1) { lane = ends.length; ends.push(0); }
    ends[lane] = toMin(b.end);
    b.lane = lane;
  }
  return Math.max(1, ends.length);
}

function secLabel(course, secs) {
  const total = course.sections.length;
  if (total === 1) return '1 section';
  const nums = secs.map((s) => s.section);
  return `Sec ${nums.length === 1 ? nums[0] : `${nums[0]}–${nums[nums.length - 1]}`} of ${total}`;
}

/* ---------- rendering ---------- */
function renderHeader() {
  const d = state.data;
  $('lab').textContent = d.lab || 'BUG Lab';
  $('term').textContent = d.semester;
  document.title = `${d.lab || 'BUG Lab'} Course Program`;
  document.querySelectorAll('.view').forEach((a) => {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const copy = {
    mandatory: ['Mandatory courses', 'Sections of a course are alternatives. Register for one of them.'],
    electives: ['Elective courses', 'Electives open this semester, colored by area.'],
    'my-week': state.shared
      ? ['Shared week', 'Someone shared the sections they picked. Your own picks are unchanged.']
      : ['My week', 'The sections you picked from both lists. Overlapping picks are hatched.'],
  }[state.view];
  $('title').textContent = copy[0];
  $('subtitle').textContent = copy[1];
  $('list-title').textContent = state.view === 'my-week' ? (state.shared ? 'Their picks' : 'Your picks') : `All ${state.view === 'mandatory' ? 'mandatory' : 'elective'} sections`;
}

function renderFilters() {
  const box = $('filters');
  box.hidden = state.view === 'my-week';
  if (box.hidden) return;
  const t = type();
  const groups = state.data.groups[t];
  $('chips').setAttribute('aria-label', groups.label);
  $('chips').replaceChildren(...Object.entries(groups.items).map(([key, g]) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(!state.hidden[t].has(key)),
    style: { '--sw-fill': g.fill, '--sw-accent': g.accent },
    onclick: () => { state.hidden[t].has(key) ? state.hidden[t].delete(key) : state.hidden[t].add(key); render(); },
  }, el('span', { class: 'sw', 'aria-hidden': 'true' }), g.label)));

  const secs = state.data.courses.filter((c) => c.type === t).flatMap((c) => c.sections);
  const rooms = [...new Set(secs.map((s) => s.room))].sort((a, b) => (a === 'MS Teams') - (b === 'MS Teams') || a.localeCompare(b, 'tr'));
  const lects = [...new Set(secs.map((s) => s.lecturer))].sort((a, b) => a.localeCompare(b, 'tr'));
  if (!rooms.includes(state.room)) state.room = '';
  if (!lects.includes(state.lect)) state.lect = '';
  fillSelect($('f-room'), 'All classrooms', rooms, state.room);
  fillSelect($('f-lect'), 'All lecturers', lects, state.lect);
  $('f-search').value = state.query;
  $('f-search').classList.toggle('is-set', !!state.query.trim());

  const active = [state.room, state.lect, state.query.trim()].filter(Boolean).length;
  $('more-count').hidden = !active;
  $('more-count').textContent = active;
  $('f-clear').hidden = !active && !state.hidden[t].size;
}

function fillSelect(sel, allLabel, values, current) {
  sel.replaceChildren(el('option', { value: '' }, allLabel), ...values.map((v) => el('option', { value: v, selected: v === current }, v)));
  sel.value = current;
  sel.classList.toggle('is-set', !!current);
}

function renderTimetable(all) {
  const tt = $('timetable');
  const empty = $('empty');
  const phone = phoneQuery.matches;
  const clash = clashInfo().keys;

  // Day picker (phone) with per-day counts under current filters.
  $('daypick').hidden = !all.length;
  $('daypick').replaceChildren(...DAYS.map((d) => {
    const n = all.filter((b) => b.day === d).length;
    return el('button', {
      type: 'button', class: 'day-btn', 'aria-current': String(d === state.day),
      'aria-label': `${DAY_NAMES[d]}, ${n} ${n === 1 ? 'class' : 'classes'}`,
      onclick: () => { state.day = d; renderTimetable(all); applySelection(); },
    }, el('b', {}, d), el('small', {}, n ? `${n} ${n === 1 ? 'class' : 'classes'}` : 'free'));
  }));

  if (!all.length) {
    tt.hidden = true;
    empty.hidden = false;
    empty.innerHTML = state.view === 'my-week'
      ? '<strong>No picks yet</strong>Open Mandatory or Electives, tap a course and pick the section you want.'
      : '<strong>No classes match these filters</strong>Try another classroom or lecturer, or clear the filters.';
    return;
  }
  tt.hidden = false;

  const days = phone ? [state.day] : DAYS;
  const dayBlocks = phone && !all.some((b) => b.day === state.day);
  empty.hidden = !dayBlocks;
  if (dayBlocks) empty.innerHTML = `<strong>Nothing on ${DAY_NAMES[state.day]}</strong>${state.view === 'my-week' ? 'None of your picks fall on this day.' : 'No classes match on this day. Try another day above.'}`;

  const { start, end } = state.data.timeRange;
  const t0 = toMin(start), t1 = toMin(end);
  const pxm = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--px-per-min')) || 1.5;
  const height = (t1 - t0) * pxm;
  const byDay = Object.fromEntries(days.map((d) => [d, all.filter((b) => b.day === d)]));
  const lanes = Object.fromEntries(days.map((d) => [d, assignLanes(byDay[d])]));
  tt.style.gridTemplateColumns = `var(--hour-col) ${days.map((d) => `minmax(0, ${phone ? 1 : Math.max(1, lanes[d] * 0.9)}fr)`).join(' ')}`;

  const nodes = [el('div', { class: 'day-head corner', 'aria-hidden': 'true' })];
  days.forEach((d) => nodes.push(el('div', { class: 'day-head' }, DAY_NAMES[d])));

  const hours = el('div', { class: 'hours', style: { height: `${height}px` }, 'aria-hidden': 'true' });
  for (let t = t0; t <= t1; t += 60) {
    hours.append(el('span', { style: { top: `${(t - t0) * pxm}px`, ...(t === t0 ? { transform: 'translateY(2px)' } : t + 60 > t1 ? { transform: 'translateY(-100%)' } : {}) } }, el('b', {}, fmt(t).slice(0, 2)), fmt(t).slice(2)));
  }
  nodes.push(hours);

  days.forEach((d) => {
    const col = el('div', { class: DAYS.indexOf(d) % 2 ? 'day alt' : 'day', style: { height: `${height}px` }, 'aria-label': DAY_NAMES[d] });
    for (let t = t0; t <= t1; t += 60) col.append(el('div', { class: 'hline', style: { top: `${(t - t0) * pxm}px` } }));
    const n = lanes[d];
    const gap = 4, pad = phone ? 4 : 6;
    for (const b of byDay[d]) {
      const c = b.course;
      const picked = b.sections.some((s) => isPicked(c, s));
      const clashing = b.sections.some((s) => isPicked(c, s) && clash.has(pickKey(c.code, s.section)));
      const lecturers = [...new Set(b.sections.map((s) => s.lecturer))];
      const lect = lecturers.length === 1 ? lecturers[0] : b.sections.map((s) => `S${s.section} ${s.lecturer}`).join('\n');
      const label = secLabel(c, b.sections);
      col.append(el('button', {
        type: 'button', 'data-code': c.code,
        class: `block${picked ? ' is-picked' : ''}${clashing ? ' has-clash' : ''}`,
        'aria-label': `${c.code} ${c.name}, ${label}, ${DAY_NAMES[d]} ${b.start} to ${b.end}, ${b.sections[0].room}${picked ? ', picked' : ''}${clashing ? ', clashes with another pick' : ''}`,
        style: {
          ...colors(c),
          top: `${(toMin(b.start) - t0) * pxm + 2}px`,
          height: `${(toMin(b.end) - toMin(b.start)) * pxm - 4}px`,
          left: `calc(${pad}px + (100% - ${2 * pad + (n - 1) * gap}px) / ${n} * ${b.lane} + ${b.lane * gap}px)`,
          width: `calc((100% - ${2 * pad + (n - 1) * gap}px) / ${n})`,
        },
        onclick: (e) => toggleSheet(c.code, e.currentTarget),
      },
      el('span', { class: 'tick', 'aria-hidden': 'true', html: ICON_CHECK }),
      el('span', { class: 'code' }, c.code),
      el('span', { class: 'name' }, c.name),
      el('span', { class: 'pills' },
        el('span', { class: 'pill sec' }, label), roomPill(b.sections[0]),
        (c.tag || groupOf(c).tag) && el('span', { class: 'pill tag' }, c.tag || groupOf(c).tag),
        clashing && el('span', { class: 'pill clash' }, 'Clash')),
      el('span', { class: 'time' }, `${b.start}–${b.end}`),
      el('span', { class: 'lect' }, lect)));
    }
    nodes.push(col);
  });
  tt.replaceChildren(...nodes);
  tt.querySelectorAll('.block').forEach((b) => { b.classList.toggle('is-narrow', b.offsetWidth < 108); b.classList.toggle('is-tight', b.offsetWidth < 92); });
}

function renderList() {
  const box = $('list');
  if (state.view === 'my-week') {
    const picks = pickedEntries();
    const { keys, pairs } = clashInfo();
    if (!picks.length) { box.replaceChildren(el('p', { class: 'sub' }, 'Sections you pick will be listed here, with the room and time for each.')); return; }
    box.replaceChildren(el('div', { class: 'mine' }, picks.map(({ course: c, s }) => {
      const clashing = keys.has(pickKey(c.code, s.section));
      const other = pairs.filter((p) => p.some((x) => x.course.code === c.code)).map((p) => p.find((x) => x.course.code !== c.code).course.code);
      return el('div', { class: `mine-row${clashing ? ' has-clash' : ''}`, style: colors(c), 'data-code': c.code },
        el('span', { class: 't' }, `${c.code} ${c.name}`),
        el('span', { class: 'm' }, `${DAY_NAMES[s.day]} ${s.start}–${s.end} · Sec ${s.section} · ${s.room} · ${s.lecturer}`),
        clashing && el('span', { class: 'm', style: { color: 'var(--clash)', fontWeight: 700 } }, `Clashes with ${other.join(', ')}`),
        state.data.classes && el('a', { class: 'gcal', href: googleCalUrl(c, s), target: '_blank', rel: 'noopener', 'aria-label': `Add ${c.code} to Google Calendar` },
          el('span', { html: ICON_CAL }), 'Add to Google Calendar'),
        !state.shared && el('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${c.code} from your picks`, onclick: () => { state.picks.delete(c.code); savePicks(); render(); } }, 'Remove'));
    })));
    return;
  }
  const t = type();
  const groups = state.data.groups[t].items;
  const cols = Object.entries(groups).filter(([key]) => !state.hidden[t].has(key)).map(([key, g]) => {
    const courses = state.data.courses.filter((c) => c.type === t && c.group === key)
      .map((c) => ({ c, secs: c.sections.filter((s) => sectionPasses(c, s)) })).filter((x) => x.secs.length);
    if (!courses.length) return null;
    return el('div', { class: 'list-group', style: { '--fill': g.fill, '--accent': g.accent } },
      el('h3', {}, g.label),
      courses.map(({ c, secs }) => el('button', {
        type: 'button', class: 'course', 'data-code': c.code, style: colors(c),
        onclick: (e) => toggleSheet(c.code, e.currentTarget),
      },
      el('span', { class: 'head' }, el('span', { class: 'code' }, c.code), el('span', { class: 'name' }, c.name)),
      secs.map((s) => el('span', { class: `row${isPicked(c, s) ? ' is-picked' : ''}` },
        el('span', { class: 's' }, c.sections.length > 1 ? `S${s.section}` : ''),
        el('span', { class: 'd' }, s.day),
        el('span', {}, `${s.start}–${s.end}`),
        el('span', { class: 'pills' }, roomPill(s), isPicked(c, s) && el('span', { class: 'pill', html: 'Picked' })))))));
  }).filter(Boolean);
  box.replaceChildren(...(cols.length ? cols : [el('p', { class: 'sub' }, 'No sections match these filters.')]));
}

function renderPicksBar() {
  const picks = pickedEntries();
  const { pairs } = clashInfo();
  $('pick-count').textContent = state.picks.size;
  $('pick-count').classList.toggle('has-picks', state.picks.size > 0);
  const summary = $('picks-summary');
  if (!picks.length) {
    summary.textContent = 'Tap a course to pick a section.';
  } else {
    const mins = picks.reduce((sum, { s }) => sum + toMin(s.end) - toMin(s.start), 0);
    summary.replaceChildren(
      el('b', {}, `${picks.length} ${picks.length === 1 ? 'pick' : 'picks'}`),
      ` · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m/week`,
      pairs.length ? el('span', { class: 'warn' }, ` · ${pairs.length} ${pairs.length === 1 ? 'clash' : 'clashes'}`) : ' · no clashes');
  }
  $('picks-go').hidden = !picks.length || state.view === 'my-week';
}

/* ---------- course sheet ---------- */
function toggleSheet(code, from) {
  if (state.selected === code) { closeSheet(); return; }
  state.lastFocus = from || document.activeElement;
  state.selected = code;
  renderSheet();
  $('sheet').hidden = false;
  document.body.classList.add('sheet-open');
  applySelection();
  $('sheet-title').focus({ preventScroll: true });
}

function closeSheet() {
  if (!state.selected) return;
  state.selected = null;
  $('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
  applySelection();
  const back = state.lastFocus;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
  else {
    const code = back && back.dataset && back.dataset.code;
    const again = code && document.querySelector(`[data-code="${code}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

function renderSheet() {
  const c = courseBy(state.selected);
  if (!c) return;
  const g = groupOf(c);
  const sheet = $('sheet');
  for (const [k, v] of Object.entries(colors(c))) sheet.style.setProperty(k, v);
  $('sheet-code').textContent = c.code;
  $('sheet-title').textContent = c.name;
  $('sheet-group').textContent = `${g.label} · ${c.type === 'mandatory' ? 'mandatory' : 'elective'} · ${c.sections.length} ${c.sections.length === 1 ? 'section' : 'sections'}`;
  const note = c.note || g.note;
  $('sheet-note').classList.toggle('is-key', !!note);
  $('sheet-note').textContent = note || (c.sections.length > 1
    ? 'These sections are alternatives. Pick the one you will register for.'
    : 'This course has one section this semester.');
  const others = pickedEntries().filter((p) => p.course.code !== c.code);
  $('sheet-secs').replaceChildren(...c.sections.map((s) => {
    const picked = isPicked(c, s);
    const hits = others.filter((p) => overlaps(p.s, s));
    return el('li', { class: `sheet-sec${picked ? ' is-picked' : ''}` },
      el('span', { class: 'when' }, `${DAY_NAMES[s.day]} ${s.start}–${s.end}`),
      el('span', { class: 'pills' }, el('span', { class: 'pill sec' }, c.sections.length > 1 ? `Sec ${s.section}` : 'Sec 1'), roomPill(s)),
      el('span', { class: 'who' }, s.lecturer),
      !state.shared && el('button', {
        type: 'button', class: 'pick', 'aria-pressed': String(picked),
        'aria-label': `${picked ? 'Remove' : 'Pick'} section ${s.section}, ${DAY_NAMES[s.day]} ${s.start}`,
        html: `${picked ? ICON_CHECK : ICON_PLUS}${picked ? 'Picked' : 'Pick'}`,
        onclick: () => {
          if (picked) state.picks.delete(c.code); else state.picks.set(c.code, s.section);
          savePicks(); render(); renderSheet();
          const btn = $('sheet-secs').children[c.sections.indexOf(s)]?.querySelector('.pick');
          if (btn) btn.focus({ preventScroll: true });
        },
      }),
      hits.length > 0 && el('p', { class: 'clash-note' }, `${picked ? 'Clashes' : 'Would clash'} with ${hits.map((p) => `${p.course.code} ${p.course.name} (${p.s.start}–${p.s.end})`).join(', ')}`));
  }));
}

function applySelection() {
  document.querySelectorAll('.block[data-code], .course[data-code], .mine-row[data-code]').forEach((n) => {
    const on = !state.selected || n.dataset.code === state.selected;
    n.classList.toggle('is-dim', !on);
    n.classList.toggle('is-selected', !!state.selected && on);
  });
}

function render() {
  const all = blocks();
  renderHeader();
  renderFilters();
  renderTimetable(all);
  renderList();
  renderPicksBar();
  renderWeekActions();
  if (state.selected && !$('sheet').hidden) renderSheet();
  applySelection();
}

/* ---------- save + share My week ---------- */
// Share links carry the picks in the hash as letters, digits and hyphens only: #week-GAD1004-1-GAD3005-1
const weekHash = (entries) => `week-${entries.map(({ course, s }) => `${course.code}-${s.section}`).join('-')}`;
function parseWeekHash(v) {
  const parts = v.slice(5).split('-');
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const c = courseBy(parts[i]);
    const sec = Number(parts[i + 1]);
    if (c && c.sections.some((s) => s.section === sec)) map.set(c.code, sec);
  }
  return map.size ? map : null;
}
// Inside the claude.ai viewer the page runs in a frame, so its own address is not the one to share.
function shareBase() {
  const framed = window.top !== window.self;
  if (framed && state.data.shareUrl) return state.data.shareUrl.replace(/#.*$/, '');
  return location.href.replace(/#.*$/, '');
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('is-on'); }, 3200);
}

function renderWeekActions() {
  const entries = state.view === 'my-week' ? pickedEntries() : [];
  $('week-actions').hidden = !entries.length;
  $('shared-banner').hidden = !(state.view === 'my-week' && state.shared);
  $('share-native').hidden = !canShareFiles();
  // The claude.ai viewer cannot save .ics files, so the calendar file is offered only on a self-hosted copy.
  $('add-calendar').hidden = !state.data.classes || !!window.claude;
  $('link-box').hidden = true;
  $('save-image').classList.toggle('btn-primary', !state.shared); // one gold button per screen
  if (state.shared) {
    const mine = state.picks.size;
    $('use-shared').textContent = mine ? `Replace my ${mine} ${mine === 1 ? 'pick' : 'picks'} with these` : 'Use these as my picks';
  }
}

function canShareFiles() {
  if (window.claude || !navigator.canShare) return false; // the claude.ai viewer refuses Web Share
  try { return navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }); } catch { return false; }
}

async function copyLink() {
  const url = `${shareBase()}#${weekHash(pickedEntries())}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Anyone who opens it sees this week.');
  } catch {
    const box = $('link-box');
    box.hidden = false;
    $('link-field').value = url;
    $('link-field').select();
    toast('Copy the link from the box below.');
  }
}

async function saveImage() {
  const btn = $('save-image');
  btn.disabled = true;
  try {
    const blob = await weekImage();
    const name = `my-week-${state.data.semester.replace(/[^0-9a-z]+/gi, '-').toLowerCase()}.png`;
    const downloads = window.claude?.use ? await window.claude.use('downloads') : null;
    if (downloads) {
      try { await downloads.save({ filename: name, data: blob }); toast('Image saved.'); }
      catch (e) {
        if (e && e.code === 'declined') return;
        if (e && e.code === 'rate_limited') toast('A save is already waiting for you. Try again in a moment.');
        else toast('Saving is not available here. Open the page in a browser to save the image.');
      }
      return;
    }
    if (window.claude) { toast('Saving is not available here. Open the page in a browser to save the image.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    toast('The image could not be made. Reload the page and try again.');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- calendar export ---------- */
// Each pick repeats weekly for the semester's teaching weeks, starting on its weekday in the first week.
const ICON_CAL = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12v11H4zM4 9h12M7.5 3.5v3M12.5 3.5v3"/></svg>';
function firstDate(day) {
  const [y, m, d] = state.data.classes.start.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const want = DAYS.indexOf(day) + 1; // Mon = 1 … Fri = 5, as in getUTCDay
  start.setUTCDate(start.getUTCDate() + ((want - start.getUTCDay() + 7) % 7));
  return start;
}
const ymd = (dt) => `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
const hms = (t) => `${t.replace(':', '')}00`;
const eventTitle = (c) => `${c.code} ${c.name}`;
const eventPlace = (s) => (s.online ? 'MS Teams (online)' : s.room);
const eventNotes = (c, s) => [`Section ${s.section} · ${s.lecturer}`, c.note || groupOf(c).note || '', `${state.data.lab || 'BUG Lab'} Course Program, ${state.data.semester}`].filter(Boolean).join('\n');

function googleCalUrl(c, s) {
  const d = ymd(firstDate(s.day));
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: eventTitle(c), dates: `${d}T${hms(s.start)}/${d}T${hms(s.end)}`,
    ctz: state.data.classes.timeZone, recur: `RRULE:FREQ=WEEKLY;COUNT=${state.data.classes.weeks}`,
    location: eventPlace(s), details: eventNotes(c, s),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function icsFile(entries) {
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  // Lines fold at 75 bytes (not characters), never inside a multi-byte letter such as ş or Ü.
  const enc = new TextEncoder();
  const fold = (line) => {
    const out = []; let cur = '', bytes = 0;
    for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n');
  };
  const tz = state.data.classes.timeZone;
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const slug = state.data.semester.replace(/[^0-9a-z]+/gi, '-').toLowerCase();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BUG Lab//Course Program//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${state.data.lab || 'BUG Lab'} ${state.data.semester}`)}`, `X-WR-TIMEZONE:${tz}`];
  // Istanbul has stayed on UTC+3 all year since 2016, so one fixed offset describes it.
  if (tz === 'Europe/Istanbul') lines.push('BEGIN:VTIMEZONE', 'TZID:Europe/Istanbul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:+03', 'END:STANDARD', 'END:VTIMEZONE');
  for (const { course: c, s } of entries) {
    const d = ymd(firstDate(s.day));
    lines.push('BEGIN:VEVENT', `UID:${c.code}-${s.section}-${slug}@buglab`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${d}T${hms(s.start)}`, `DTEND;TZID=${tz}:${d}T${hms(s.end)}`,
      `RRULE:FREQ=WEEKLY;COUNT=${state.data.classes.weeks}`,
      `SUMMARY:${esc(eventTitle(c))}`, `LOCATION:${esc(eventPlace(s))}`, `DESCRIPTION:${esc(eventNotes(c, s))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function addToCalendar() {
  const entries = pickedEntries();
  if (!entries.length) return;
  const blob = new Blob([icsFile(entries)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-lab-${state.data.semester.replace(/[^0-9a-z]+/gi, '-').toLowerCase()}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${entries.length} weekly ${entries.length === 1 ? 'class' : 'classes'}, ${state.data.classes.weeks} weeks each. Open the file to add them.`);
}

async function shareNative() {
  try {
    const blob = await weekImage();
    const file = new File([blob], 'my-week.png', { type: 'image/png' });
    await navigator.share({ files: [file], title: `My week · ${state.data.semester}`, url: `${shareBase()}#${weekHash(pickedEntries())}` });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Sharing did not work here. Save the image or copy the link instead.');
  }
}

// Draws the week (only days and hours that have picks) onto a canvas, in the page's own colours and fonts.
async function weekImage() {
  const entries = pickedEntries();
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const C = { bg: v('--bg'), surface: v('--surface'), line: v('--line'), text: v('--text'), strong: v('--text-strong'), muted: v('--muted'), gold: v('--brand-gold'), clash: v('--clash'), onlineBg: v('--online-bg'), onlineFg: v('--online-fg') };
  const F = { head: "'Chakra Petch', 'Archivo', sans-serif", narrow: "'Archivo', sans-serif", ui: "'Atkinson Hyperlegible Next', sans-serif" };
  await Promise.all(['700 28px "Chakra Petch"', '700 16px Archivo', '700 13px "Atkinson Hyperlegible Next"', '400 13px "Atkinson Hyperlegible Next"'].map((f) => document.fonts.load(f).catch(() => null)));

  const { keys } = clashInfo();
  // All five days, so it reads as a week; busy days get room for side-by-side lanes, free days stay slim.
  const days = DAYS;
  const lists = Object.fromEntries(days.map((d) => [d, entries.filter((e) => e.s.day === d).map((e) => ({ ...e, start: e.s.start, end: e.s.end }))]));
  const lanes = Object.fromEntries(days.map((d) => [d, assignLanes(lists[d])]));
  const weights = days.map((d) => (lists[d].length ? lanes[d] : 0.6));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const base = toMin(state.data.timeRange.start);
  const s0 = Math.min(...entries.map((e) => toMin(e.s.start)));
  const e1 = Math.max(...entries.map((e) => toMin(e.s.end)));
  const t0 = base + Math.floor((s0 - base) / 60) * 60;
  const t1 = base + Math.ceil((e1 - base) / 60) * 60;
  const pad = 36, rail = 54, pxm = 1.55;
  const W = Math.round(Math.max(1080, pad * 2 + rail + sumW * 210));
  const top = 128, head = 34, gridH = (t1 - t0) * pxm;
  const H = top + head + gridH + 64;
  const scale = 2;
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

  // Header: pixel bug, wordmark, title, totals.
  const bug = [[0, 0, 1], [7, 0, 1], [1, 1, 1], [3, 1, 2], [6, 1, 1], [2, 2, 4], [1, 3, 6], [0, 4, 2], [3, 4, 2], [6, 4, 2], [0, 5, 8], [2, 6, 1], [5, 6, 1]];
  const u = 4, bx = pad, by = pad + 6;
  g.fillStyle = C.gold;
  for (const [x, y, w] of bug) g.fillRect(bx + x * u, by + y * u, w * u, u);
  for (const cy of [-1.2, 0.2]) { g.beginPath(); g.moveTo(bx + 4 * u, by + (cy - 0.7) * u); g.lineTo(bx + 4.7 * u, by + cy * u); g.lineTo(bx + 4 * u, by + (cy + 0.7) * u); g.lineTo(bx + 3.3 * u, by + cy * u); g.fill(); }
  g.textBaseline = 'alphabetic';
  g.fillStyle = C.gold; g.font = `700 28px ${F.head}`;
  g.fillText('BUG LAB', pad + 44, pad + 30);
  g.fillStyle = C.strong; g.font = `700 22px ${F.head}`;
  g.fillText(state.shared ? 'Shared week' : 'My week', pad, pad + 72);
  const mins = entries.reduce((sum, e) => sum + toMin(e.s.end) - toMin(e.s.start), 0);
  g.fillStyle = C.muted; g.font = `400 14px ${F.ui}`;
  const meta = `${state.data.semester} · ${entries.length} ${entries.length === 1 ? 'course' : 'courses'} · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m a week${keys.size ? ` · ${clashInfo().pairs.length} ${clashInfo().pairs.length === 1 ? "clash" : "clashes"}` : ''}`;
  g.textAlign = 'right'; g.fillText(meta, W - pad, pad + 72); g.textAlign = 'left';

  // Grid.
  const gx = pad + rail, gw = W - pad - gx, gy = top + head;
  const colW = weights.map((w) => (w / sumW) * gw);
  const colX = colW.map((_, i) => gx + colW.slice(0, i).reduce((a, b) => a + b, 0));
  g.font = `700 16px ${F.head}`; g.textAlign = 'center';
  days.forEach((d, i) => { g.fillStyle = lists[d].length ? C.strong : C.muted; g.fillText(colW[i] < 150 ? d : DAY_NAMES[d], colX[i] + colW[i] / 2, top + 22); });
  g.textAlign = 'right'; g.font = `700 12px ${F.ui}`;
  for (let t = t0; t <= t1; t += 60) {
    const y = gy + (t - t0) * pxm;
    g.fillStyle = C.line; g.fillRect(gx, y, gw, 1);
    g.fillStyle = C.muted; g.fillText(fmt(t), gx - 10, y + (t === t0 ? 12 : 4));
  }
  g.textAlign = 'left';
  days.forEach((d, i) => { g.fillStyle = C.line; g.fillRect(colX[i], gy, 1, gridH); });
  g.fillRect(gx + gw - 1, gy, 1, gridH);

  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  const wrap = (text, maxW, font) => {
    g.font = font; const words = text.split(' '); const lines = []; let line = '';
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line); return lines;
  };
  days.forEach((d, i) => {
    const list = lists[d];
    const n = lanes[d];
    const laneW = (colW[i] - 12 - (n - 1) * 6) / n;
    for (const b of list) {
      const grp = groupOf(b.course);
      const x = colX[i] + 6 + b.lane * (laneW + 6), y = gy + (toMin(b.start) - t0) * pxm + 2;
      const w = laneW, h = (toMin(b.end) - toMin(b.start)) * pxm - 4;
      const clash = keys.has(pickKey(b.course.code, b.s.section));
      g.save(); rr(x, y, w, h, 7); g.fillStyle = grp.fill; g.fill(); g.clip();
      if (clash) { g.strokeStyle = C.clash; g.globalAlpha = 0.5; g.lineWidth = 2; for (let k = -h; k < w; k += 10) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); g.stroke(); } g.globalAlpha = 1; }
      let ty = y + 22; const tx = x + 12, tw = w - 24;
      g.fillStyle = grp.accent; g.font = `700 13px ${F.ui}`; g.fillText(b.course.code, tx, ty);
      ty += 22; g.fillStyle = C.strong;
      for (const ln of wrap(b.course.name, tw, `700 17px ${F.narrow}`)) { g.fillText(ln, tx, ty); ty += 20; }
      ty += 4; g.font = `700 13px ${F.ui}`;
      const secTxt = b.course.sections.length > 1 ? `Sec ${b.s.section}` : 'Sec 1';
      g.fillStyle = grp.accent; g.fillText(secTxt, tx, ty);
      const sw = g.measureText(secTxt).width + 10;
      g.fillStyle = b.s.online ? C.onlineFg : C.strong;
      if (sw + g.measureText(b.s.room).width <= tw) g.fillText(b.s.room, tx + sw, ty);
      else { ty += 18; g.fillText(b.s.room, tx, ty); }
      ty += 20; g.fillStyle = C.strong; g.fillText(`${b.s.start}–${b.s.end}`, tx, ty);
      ty += 19; g.fillStyle = C.text; g.font = `400 13px ${F.ui}`;
      for (const ln of wrap(b.s.lecturer, tw, `400 13px ${F.ui}`)) { g.fillText(ln, tx, ty); ty += 17; }
      g.restore();
      rr(x + 1, y + 1, w - 2, h - 2, 7); g.lineWidth = 2; g.strokeStyle = clash ? C.clash : `${grp.accent}55`; g.stroke();
    }
  });

  g.fillStyle = C.muted; g.font = `400 12px ${F.ui}`;
  g.fillText(`${state.data.lab || 'BUG Lab'} Course Program · check UMIS before you register`, pad, H - 26);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

/* ---------- routing + events ---------- */
function route() {
  const v = location.hash.slice(1);
  state.shared = v.startsWith('week-') ? parseWeekHash(v) : null;
  const next = state.shared ? 'my-week' : v in VIEWS ? v : 'mandatory';
  if (next !== state.view) { state.room = ''; state.lect = ''; state.query = ''; }
  state.view = next;
  if (next === 'my-week') { // on phones, open on a day that has picks
    const e = pickedEntries();
    if (e.length && !e.some((x) => x.s.day === state.day)) state.day = e[0].s.day;
  }
  if (state.selected) closeSheet();
  $('filters').classList.remove('is-open');
  $('more-toggle').setAttribute('aria-expanded', 'false');
  render();
}

function wire() {
  window.addEventListener('hashchange', route);
  phoneQuery.addEventListener('change', render);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  $('f-room').addEventListener('change', (e) => { state.room = e.target.value; render(); });
  $('f-lect').addEventListener('change', (e) => { state.lect = e.target.value; render(); });
  $('f-search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('f-clear').addEventListener('click', () => { state.room = ''; state.lect = ''; state.query = ''; state.hidden[type()].clear(); render(); });
  $('more-toggle').addEventListener('click', () => {
    const open = $('filters').classList.toggle('is-open');
    $('more-toggle').setAttribute('aria-expanded', String(open));
  });
  $('sheet-close').addEventListener('click', closeSheet);
  $('save-image').addEventListener('click', saveImage);
  $('copy-link').addEventListener('click', copyLink);
  $('share-native').addEventListener('click', shareNative);
  $('add-calendar').addEventListener('click', addToCalendar);
  $('use-shared').addEventListener('click', () => { state.picks = new Map(state.shared); savePicks(); location.hash = 'my-week'; toast('These are now your picks.'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  // Swipe between days on phones.
  let sx = null, sy = null;
  const tt = $('timetable');
  tt.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  tt.addEventListener('touchend', (e) => {
    if (sx == null || !phoneQuery.matches) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const i = DAYS.indexOf(state.day) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < DAYS.length) { state.day = DAYS[i]; render(); }
  }, { passive: true });

  // Keep sticky offsets in step with the real bar height (it wraps on phones).
  const bar = document.querySelector('.bar');
  const setBar = () => document.documentElement.style.setProperty('--bar-offset', `${bar.offsetHeight}px`);
  if ('ResizeObserver' in window) new ResizeObserver(setBar).observe(bar);
  setBar();
}

async function init() {
  document.documentElement.lang = document.documentElement.lang || 'en';
  try {
    const res = await fetch('schedule.json');
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
  } catch {
    $('empty').hidden = false;
    $('empty').innerHTML = '<strong>The schedule could not load</strong>schedule.json is missing or not reachable. Reload the page; if you opened index.html from disk, serve the folder instead (see README.md).';
    return;
  }
  loadPicks();
  wire();
  route();
}

init();
