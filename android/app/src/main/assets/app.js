(function () {
  'use strict';
  const REMOTE_URLS = [
    'https://malexander88.github.io/sen-events-ni/events.json',
    'https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json'
  ];
  const CACHE_KEY = 'sen-events-ni-cache-v1';
  const SAVED_KEY = 'sen-events-ni-saved-v1';
  const HIDDEN_KEY = 'sen-events-ni-hidden-v1';
  const NEAR = 'Newtownabbey & North Belfast';
  const AREAS = [NEAR, 'Belfast', 'Rest of Antrim', 'County Down'];
  const AREA_ORDER = { [NEAR]: 0, 'Belfast': 1, 'Rest of Antrim': 2, 'County Down': 3 };
  const TYPE_ICONS = {
    'Halloween': '🎃', 'Christmas': '🎄', 'Theatre': '🎭', 'Cinema': '🎬', 'Sensory play': '🫧',
    'Swim/Leisure': '🏊', 'Library/Storytime': '📚', 'Museum/Attraction': '🏛️', 'Outdoors': '🌳',
    'Disco/Party': '🪩', 'Soft play (SEN hours)': '🧸', 'Place to visit': '📍'
  };
  const EYE_OFF = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const EYE = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const typeIcon = t => TYPE_ICONS[t] || '⭐';

  const $ = id => document.getElementById(id);
  const els = { list: $('list'), status: $('status'), quick: $('quick-chips'), areas: $('area-chips'),
    types: $('type-chips'), detail: $('detail'), search: $('search'), searchClear: $('search-clear'), hiddenChip: $('hidden-chip') };

  const state = { near: false, weekend: false, free: false, sen: false, general: false, new: false, saved: false, area: 'all', type: 'all', query: '', showHidden: false };
  let allEvents = [];
  let saved = new Set();
  try { saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch (_) {}
  const persistSaved = () => { try { localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])); } catch (_) {} };
  let statusText = '';
  let hidden = new Set();
  try { hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch (_) {}
  const persistHidden = () => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch (_) {}
    try { window.SENAndroid && window.SENAndroid.setHidden && window.SENAndroid.setHidden(JSON.stringify([...hidden])); } catch (_) {}
  };
  // Drop hidden ids whose item has passed or is no longer in the list.
  function pruneHidden() {
    if (!allEvents.length) return;
    const live = new Set(allEvents.filter(ev => !isPast(ev)).map(ev => ev.id));
    let changed = false;
    for (const id of [...hidden]) if (!live.has(id)) { hidden.delete(id); changed = true; }
    if (changed) persistHidden();
  }
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function matchesQuery(ev) {
    const words = norm(state.query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = norm([ev.name, ev.description, ev.venue, ev.town].join(' '));
    return words.every(w => hay.includes(w));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseDate(s) { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
  const startOf = ev => parseDate(ev.startDate);
  const endOf = ev => parseDate(ev.endDate) || parseDate(ev.startDate);

  function isPast(ev) { if (ev.recurring) return false; const e = endOf(ev); return !!e && e < today(); }
  function londonToday() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); } catch (_) { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } }
  function isNew(ev) { return !!ev.addedDate && ev.addedDate.slice(0, 10) === londonToday(); }
  // ---- GPS "Near me" ----
  const RADIUS_MI = 10;
  let userPos = null, geoNotice = '';
  function hasCoords(ev) { return typeof ev.lat === 'number' && typeof ev.lng === 'number'; }
  function distMi(ev) {
    if (!userPos || !hasCoords(ev)) return null;
    const r = Math.PI / 180, dLat = (ev.lat - userPos.lat) * r, dLng = (ev.lng - userPos.lng) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(userPos.lat * r) * Math.cos(ev.lat * r) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }
  function requestLocation() {
    geoNotice = 'Finding your location…';
    const fail = () => { userPos = null; geoNotice = 'Location unavailable, so showing Newtownabbey & North Belfast instead.'; render(); };
    if (!navigator.geolocation) return fail();
    navigator.geolocation.getCurrentPosition(p => {
      userPos = { lat: p.coords.latitude, lng: p.coords.longitude }; geoNotice = ''; render();
    }, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }
  function isFree(ev) { const p = String(ev.price || ''); return /^\s*free\b(?!\s+with)/i.test(p) || /£0(\.00)?\b/.test(p) || /free entry/i.test(p); }
  function overlaps(ev, from, to) { const s = startOf(ev); if (!s) return false; const e = endOf(ev) || s; return s <= to && e >= from; }
  function weekendRange() {
    const t = today(); const dow = t.getDay();
    const sat = dow === 0 ? addDays(t, -1) : addDays(t, 6 - dow);
    return [dow === 0 ? t : sat, addDays(sat, 1)];
  }
  function isWeekend(ev) {
    const [a, b] = weekendRange();
    if (startOf(ev)) return overlaps(ev, a, b);
    return /\b(sat|sun|saturday|sunday|weekend|daily|every day|open daily)/i.test((ev.recurring || '') + ' ' + (ev.time || ''));
  }
  const DAY = 86400000;
  function isLong(ev) { const a = startOf(ev), b = endOf(ev); return !!a && !!b && Math.round((b - a) / DAY) > 7; }
  function weekRange() { const t = today(); const mon = addDays(t, -((t.getDay() + 6) % 7)); return [mon, addDays(mon, 6)]; }
  function group(ev) {
    if (!startOf(ev)) return 'Always open';
    if (isLong(ev) && startOf(ev) <= addDays(today(), 7)) return 'On now';
    const [m, su] = weekRange();
    if (!isLong(ev) && overlaps(ev, m, su)) return 'This week';
    return 'Coming up';
  }
  const GROUPS = ['On now', 'This week', 'Coming up', 'Always open'];
  const fmtShort = d => d.getDate() + ' ' + d.toLocaleDateString('en-GB', { month: 'short' });
  function runBadge(ev) {
    if (!isLong(ev)) return '';
    const s = startOf(ev), e = endOf(ev);
    return s > today() ? 'Starts ' + fmtShort(s) + ' · runs to ' + fmtShort(e) : 'Runs until ' + fmtShort(e);
  }

  function dateLabel(ev) {
    const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const parts = [];
    const s = startOf(ev), e = endOf(ev);
    if (ev.recurring) parts.push(ev.recurring);
    else if (s && e && +s !== +e) parts.push(fmt(s) + ' – ' + fmt(e));
    else if (s) parts.push(fmt(s));
    if (ev.time && !ev.recurring) parts.push(ev.time);
    return parts.join(' · ') || 'See booking page';
  }

  function pills(ev) {
    let h = '';
    if (isNew(ev)) h += '<span class="pill pill-new">Found today</span>';
    if (ev.senSpecific) h += '<span class="pill pill-sen">SEN only</span>';
    if (ev.general) h += '<span class="pill pill-general" title="General family event, not SEN-specific">General</span>';
    if (isFree(ev)) h += '<span class="pill pill-free">Free</span>';
    if (ev.soldOut) h += '<span class="pill pill-sold">Sold out</span>';
    h += '<span class="pill pill-type">' + esc(ev.type) + '</span>';
    return h;
  }
  const heartBtn = ev => '<button class="heart" data-heart="' + esc(ev.id) + '" aria-pressed="' + saved.has(ev.id) +
    '" aria-label="' + (saved.has(ev.id) ? 'Remove from saved' : 'Save') + '">' + (saved.has(ev.id) ? '♥' : '♡') + '</button>';

  function anyFilter() {
    return !!(state.near || state.weekend || state.free || state.sen || state.general || state.new || state.saved ||
      state.area !== 'all' || state.type !== 'all' || (state.query && state.query.trim()));
  }
  function filtered(wantHidden) {
    return allEvents.filter(ev => {
      if (isPast(ev)) return false;
      if (hidden.has(ev.id) !== !!wantHidden) return false;
      if (!matchesQuery(ev)) return false;
      if (state.near) {
        if (userPos) { const d = distMi(ev); if (d !== null && d > RADIUS_MI) return false; }
        else if (ev.area !== NEAR) return false;
      }
      if (state.weekend && !isWeekend(ev)) return false;
      if (state.free && !isFree(ev)) return false;
      if (state.sen && !ev.senSpecific) return false;
      if (state.general && !ev.general) return false;
      if (state.new && !isNew(ev)) return false;
      if (state.saved && !saved.has(ev.id)) return false;
      if (state.area !== 'all' && ev.area !== state.area) return false;
      if (state.type !== 'all' && ev.type !== state.type) return false;
      return true;
    }).sort((a, b) => {
      if (state.near && userPos) {
        const d1 = distMi(a), d2 = distMi(b);
        if (d1 !== d2) return (d1 === null ? 9e9 : d1) - (d2 === null ? 9e9 : d2);
      }
      const s1 = startOf(a), s2 = startOf(b);
      const k = [(AREA_ORDER[a.area] ?? 9) - (AREA_ORDER[b.area] ?? 9), (s1 ? +s1 : 9e15) - (s2 ? +s2 : 9e15)];
      for (const v of k) if (v) return v;
      return a.name.localeCompare(b.name);
    });
  }

  const hideBtn = ev => '<button class="hide-btn" data-hide="' + esc(ev.id) + '" aria-label="Hide" title="Hide">' + EYE_OFF + '</button>';
  function hiddenCard(ev) {
    return '<article class="card card-hidden" data-id="' + esc(ev.id) + '" tabindex="0">' +
      '<div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div>' +
      '<div class="card-body"><h2 class="h2-hidden">' + esc(ev.name) + '</h2>' +
        '<p class="meta">' + esc(ev.venue) + ', ' + esc(ev.town) + '</p></div>' +
      '<button class="unhide-btn" data-unhide="' + esc(ev.id) + '">' + EYE + ' Unhide</button></article>';
  }
  function updateHiddenChip() {
    const n = allEvents.filter(ev => hidden.has(ev.id) && !isPast(ev)).length;
    els.hiddenChip.innerHTML = state.showHidden ? (EYE + ' Show all events') : (EYE_OFF + ' Show hidden (' + n + ')');
    els.hiddenChip.setAttribute('aria-pressed', String(state.showHidden));
    els.hiddenChip.disabled = n === 0 && !state.showHidden;
    document.body.classList.toggle('view-hidden', state.showHidden);
    els.searchClear.hidden = !state.query;
  }
  function render() {
    updateHiddenChip();
    if (state.showHidden) {
      const total = allEvents.filter(ev => hidden.has(ev.id) && !isPast(ev)).length;
      const hid = filtered(true);
      els.status.textContent = anyFilter() ? hid.length + ' of ' + total + ' hidden' : total + ' hidden item' + (total === 1 ? '' : 's');
      els.list.innerHTML = '<div class="hidden-view-head"><h3 class="group-title group-hidden">Hidden (' + total + ')' + (hid.length !== total ? ' · ' + hid.length + ' match' : '') + '</h3>' +
        '<button class="icon-btn back-all" data-back-all="1">← Show all events</button></div>' +
        (hid.length ? hid.map(hiddenCard).join('') : '<p class="empty empty-sm">' + (total ? 'No hidden items match these filters.' : 'Nothing hidden.') + '</p>');
      return;
    }
    const items = filtered(false);
    if (anyFilter()) {
      const all = allEvents.filter(ev => !isPast(ev) && !hidden.has(ev.id)).length;
      els.status.textContent = items.length + ' of ' + all + ' events & places';
    } else if (statusText) els.status.textContent = statusText;
    const notice = state.near && geoNotice ? '<p class="geo-notice">' + esc(geoNotice) + '</p>' : (state.near && userPos ? '<p class="geo-notice geo-ok">📍 Within ' + RADIUS_MI + ' miles of you, nearest first</p>' : '');
    if (!items.length) {
      els.list.innerHTML = notice + '<p class="empty">' + (state.query ? 'No matches for “' + esc(state.query.trim()) + '”.' : state.saved ? 'Nothing saved yet. Tap ♡ on anything you like.' : 'Nothing matches these filters right now.') + '</p>';
      return;
    }
    let html = notice;
    for (const g of GROUPS) {
      const gi = items.filter(ev => group(ev) === g);
      if (!gi.length) continue;
      html += '<h3 class="group-title">' + g + ' · ' + gi.length + '</h3>';
      html += gi.map(ev =>
        '<article class="card' + (ev.soldOut ? ' sold-out' : '') + '" data-id="' + esc(ev.id) + '" tabindex="0">' +
          '<div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div>' +
          '<div class="card-body">' +
            '<h2>' + esc(ev.name) + '</h2>' +
            (runBadge(ev) ? '<p class="run-badge">📅 ' + esc(runBadge(ev)) + '</p>' : '<p class="meta">' + esc(dateLabel(ev)) + '</p>') +
            '<p class="meta">' + (state.near && distMi(ev) !== null ? '<span class="dist">' + distMi(ev).toFixed(1) + ' mi</span> · ' : '') + esc(ev.venue) + ', ' + esc(ev.town) + (ev.price ? ' · ' + esc(ev.price) : '') + '</p>' +
            '<div class="pills">' + pills(ev) + '</div>' +
          '</div>' + heartBtn(ev) + hideBtn(ev) +
        '</article>').join('');
    }
    els.list.innerHTML = html;
  }

  function chipRow(container, key, values, labelAll) {
    container.innerHTML = ['all', ...values].map(v =>
      '<button class="chip" data-' + key + '="' + esc(v) + '" aria-pressed="' + (state[key] === v) + '">' +
      (v === 'all' ? labelAll : (key === 'type' ? typeIcon(v) + ' ' : '') + esc(v)) + '</button>').join('');
  }
  function syncChips() {
    els.quick.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(!!state[b.dataset.q])));
    els.areas.querySelectorAll('[data-area]').forEach(b => b.setAttribute('aria-pressed', String(state.area === b.dataset.area)));
    els.types.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', String(state.type === b.dataset.type)));
  }

  // ---------- Details ----------
  const pad = n => String(n).padStart(2, '0');
  function toICSDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function toICSDateTime(d) { return toICSDate(d) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'; }
  // First "HH:MM" (optionally "–HH:MM") in the time text; null if none.
  function parseTimes(t) {
    const m = String(t || '').match(/(\d{1,2})[:.](\d{2})(?:\s*[–\-]\s*(\d{1,2})[:.](\d{2}))?/);
    if (!m) return null;
    return { sh: +m[1], sm: +m[2], eh: m[3] != null ? +m[3] : null, em: m[4] != null ? +m[4] : null };
  }
  function addToCalendar(ev) {
    const s0 = startOf(ev); if (!s0) return;
    const long = isLong(ev);
    const day = long && s0 < today() ? today() : s0; // first upcoming date for long runs
    const tm = parseTimes(ev.time);
    const where = ev.venue + ', ' + ev.town;
    const fmt = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    let details = '';
    if (long) details += 'Runs ' + fmt(s0) + ' – ' + fmt(endOf(ev)) + ' (pick the date that suits on the booking page).\n';
    else if (+endOf(ev) !== +s0) details += 'Dates: ' + fmt(s0) + ' – ' + fmt(endOf(ev)) + '\n';
    details += (ev.time ? 'Time: ' + ev.time + '\n' : '') + (ev.description || '') + '\n' + ev.url;
    let begin, end, allDay;
    if (tm) {
      begin = new Date(day); begin.setHours(tm.sh, tm.sm, 0, 0);
      if (tm.eh != null) { end = new Date(day); end.setHours(tm.eh, tm.em, 0, 0); }
      if (!end || end <= begin) end = new Date(+begin + 2 * 3600000);
      allDay = false;
    } else {
      begin = new Date(day); end = addDays(day, (!long && endOf(ev)) ? Math.round((endOf(ev) - s0) / DAY) + 1 : 1); allDay = true;
    }
    const A = window.SENAndroid;
    if (A && A.addEvent) { A.addEvent(ev.name, +begin, +end, allDay, where, details); return; }
    if (A && A.addToCalendar && allDay) { A.addToCalendar(ev.name, +begin, +end, where, details); return; }
    const dates = allDay ? toICSDate(begin) + '/' + toICSDate(end) : toICSDateTime(begin) + '/' + toICSDateTime(end);
    const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.name) +
      '&dates=' + dates + '&ctz=Europe/London&location=' + encodeURIComponent(where) + '&details=' + encodeURIComponent(details);
    window.open(url, '_blank', 'noopener');
  }
  const mapsUrl = ev => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue + ', ' + ev.town + ', Northern Ireland');

  function row(icon, label, value) {
    return value ? '<div class="info-row"><span class="k" aria-hidden="true">' + icon + '</span><div class="v"><span class="lbl">' + label + '</span>' + esc(value) + '</div></div>' : '';
  }
  function showDetail(id) {
    const ev = allEvents.find(x => x.id === id);
    if (!ev) { hideDetail(); return; }
    const dated = !!startOf(ev);
    els.detail.innerHTML =
      '<div class="detail-inner">' +
        '<div class="detail-top"><button class="icon-btn" data-back>← Back</button><div class="detail-actions">' +
          '<button class="icon-btn" data-heart="' + esc(ev.id) + '" aria-pressed="' + saved.has(ev.id) + '">' + (saved.has(ev.id) ? '♥ Saved' : '♡ Save') + '</button>' +
          (hidden.has(ev.id) ? '<button class="icon-btn" data-unhide="' + esc(ev.id) + '">' + EYE + ' Unhide</button>' : '<button class="icon-btn" data-hide="' + esc(ev.id) + '">' + EYE_OFF + ' Hide</button>') + '</div></div>' +
        '<div class="detail-hero"><div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div><h2>' + esc(ev.name) + '</h2></div>' +
        '<div class="pills">' + pills(ev) + '</div>' +
        (runBadge(ev) ? '<p class="run-badge run-badge-lg">📅 ' + esc(runBadge(ev)) + '</p>' : '') +
        (ev.soldOut ? '<p class="note">Sold out at last check. Returns sometimes come up on the booking page.</p>' : '') +
        '<div class="info">' +
          row('🗓️', ev.recurring ? 'Hours' : 'When', dateLabel(ev)) +
          (ev.recurring && ev.time ? row('⏰', 'Time', ev.time) : '') +
          row('📍', 'Where', ev.venue + ', ' + ev.town) +
          row('🧭', 'Area', ev.area) +
          row('💷', 'Price', ev.price) +
        '</div>' +
        '<div class="info"><div class="info-row"><span class="k" aria-hidden="true">💙</span><div class="v why"><span class="lbl">Why it suits / what to expect</span>' + esc(ev.description) + '</div></div></div>' +
        '<a class="btn btn-primary" href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer">Book / More info</a>' +
        '<div class="btn-row">' +
          (dated ? '<button class="btn btn-secondary" data-cal>🗓️ Add to calendar</button>' : '') +
          '<a class="btn btn-secondary" href="' + esc(mapsUrl(ev)) + '" target="_blank" rel="noopener noreferrer">🧭 Directions</a>' +
        '</div>' +
      '</div>';
    els.detail.hidden = false;
    els.detail.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    els.detail.querySelector('[data-cal]')?.addEventListener('click', () => addToCalendar(ev));
  }
  function hideDetail() { els.detail.hidden = true; els.detail.innerHTML = ''; document.body.style.overflow = ''; }
  function route() {
    const m = location.hash.match(/^#e\/(.+)$/);
    if (m) showDetail(decodeURIComponent(m[1])); else hideDetail();
  }

  // ---------- Events ----------
  function toggleSave(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    persistSaved();
    render();
    if (!els.detail.hidden) showDetail(id);
  }
  function setHidden(id, on) {
    if (on) hidden.add(id); else hidden.delete(id);
    persistHidden();
    const inDetail = !els.detail.hidden;
    render();
    if (inDetail) { if (on) { history.length > 1 ? history.back() : (location.hash = ''); } else showDetail(id); }
  }
  els.search.addEventListener('input', () => { state.query = els.search.value; render(); });
  els.searchClear.addEventListener('click', () => { els.search.value = ''; state.query = ''; render(); els.search.focus(); });
  els.search.addEventListener('keydown', e => { if (e.key === 'Escape') { els.search.value = ''; state.query = ''; render(); } });
  els.hiddenChip.addEventListener('click', () => { state.showHidden = !state.showHidden; render(); window.scrollTo(0,0); });
  document.addEventListener('click', e => {
    const hb = e.target.closest('[data-hide]');
    if (hb) { e.stopPropagation(); e.preventDefault(); setHidden(hb.dataset.hide, true); return; }
    const ub = e.target.closest('[data-unhide]');
    if (e.target.closest('[data-back-all]')) { e.preventDefault(); state.showHidden = false; render(); window.scrollTo(0,0); return; }
    if (ub) { e.stopPropagation(); e.preventDefault(); setHidden(ub.dataset.unhide, false); return; }
    const h = e.target.closest('[data-heart]');
    if (h) { e.stopPropagation(); e.preventDefault(); toggleSave(h.dataset.heart); return; }
    if (e.target.closest('[data-back]')) { history.length > 1 ? history.back() : (location.hash = ''); return; }
    const q = e.target.closest('[data-q]');
    if (q) { state[q.dataset.q] = !state[q.dataset.q]; if (q.dataset.q === 'near' && state.near) requestLocation(); syncChips(); render(); return; }
    const a = e.target.closest('[data-area]');
    if (a) { state.area = a.dataset.area; syncChips(); render(); return; }
    const t = e.target.closest('[data-type]');
    if (t) { state.type = t.dataset.type; syncChips(); render(); return; }
    const card = e.target.closest('.card[data-id]');
    if (card) location.hash = 'e/' + encodeURIComponent(card.dataset.id);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.card[data-id]')) location.hash = 'e/' + encodeURIComponent(e.target.dataset.id);
    if (e.key === 'Escape' && !els.detail.hidden && e.target !== els.search) history.back();
  });
  window.addEventListener('hashchange', route);

  // ---------- Data ----------
  function applyData(data, source) {
    allEvents = (data && data.events) || [];
    if (source === 'live') pruneHidden();
    persistHidden();
    chipRow(els.areas, 'area', AREAS, '🗺️ All areas');
    chipRow(els.types, 'type', [...new Set(allEvents.map(e => e.type))].sort(), '🔎 All types');
    syncChips();
    render();
    route();
    const when = data.updatedAt ? ' · updated ' + data.updatedAt.slice(0, 10) : '';
    statusText = allEvents.length + ' events & places' + when + (source === 'live' ? '' : ' (' + source + ')');
    render();
  }
  async function fetchRemote() {
    let last;
    for (const base of REMOTE_URLS) {
      try {
        const res = await fetch(base + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error(base + ' ' + res.status);
        return await res.json();
      } catch (e) { last = e; }
    }
    throw last || new Error('all remotes failed');
  }
  async function init() {
    try {
      const data = await fetchRemote();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
      applyData(data, 'live');
    } catch (e) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) {}
      if (cached) { applyData(cached, 'offline copy'); return; }
      try {
        const res = await fetch('events.json');
        applyData(await res.json(), 'bundled');
      } catch (err) {
        els.list.innerHTML = '<p class="empty">Could not load events. Check your connection and try again.</p>';
      }
    }
  }

  try {
    const p = new URLSearchParams(location.search);
    if (p.get('new') === '1' || location.hash === '#new') state.new = true;
  } catch (_) {}
  (function () {
    const b = $('notify-chip'), A = window.SENAndroid;
    if (!b || !A || !A.getNotifications) return;
    const paint = on => { b.textContent = on ? '🔔' : '🔕'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'New-event notifications on' : 'New-event notifications off'); };
    let on = !!A.getNotifications(); paint(on); b.hidden = false;
    b.addEventListener('click', () => { on = !on; A.setNotifications(on); paint(on); });
  })();
  window.senShowNew = function () { state.new = true; if (location.hash) location.hash = ''; syncChips(); render(); };
  syncChips();
  init();
})();
