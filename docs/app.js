(function () {
  'use strict';
  const REMOTE_URLS = [
    'https://malexander88.github.io/sen-events-ni/events.json',
    'https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json'
  ];
  const CACHE_KEY = 'sen-events-ni-cache-v1';
  const SAVED_KEY = 'sen-events-ni-saved-v1';
  const HIDDEN_KEY = 'sen-events-ni-hidden-v1';
  // Belfast first, then counties by population. The area filter uses ev.county (falls back to ev.area).
  const AREAS = ['Belfast', 'County Antrim', 'County Down', 'County Armagh', 'County Londonderry', 'County Tyrone', 'County Fermanagh'];
  const AREA_ORDER = Object.fromEntries(AREAS.map((a, i) => [a, i]));
  const HOME = { lat: 54.65823, lng: -5.90542 }; // Newtownabbey: "Near me" fallback when location is unavailable
  const countyOf = ev => ev.county || ev.area || '';
  const placeOf = ev => { const c = countyOf(ev); return (ev.town && ev.town !== c) ? ev.town + ', ' + c : (ev.town || c); };
  const TYPE_ICONS = {
    'Halloween': '🎃', 'Christmas': '🎄', 'Theatre': '🎭', 'Cinema': '🎬', 'Sensory play': '🫧',
    'Swim/Leisure': '🏊', 'Library/Storytime': '📚', 'Museum/Attraction': '🏛️', 'Outdoors': '🌳',
    'Disco/Party': '🪩', 'Soft play (SEN hours)': '🧸', 'Place to visit': '📍',
    'Theatre/Show': '🎭', 'Farm': '🐑', 'Soft play': '🧸', 'Play café': '☕', 'Workshop': '🎨', 'Park/Playground': '🛝',
    'Sport': '⚽', 'Trampoline/Inflatables': '🤸', 'Kids class': '🖍️', 'Festival/Market': '🎪', 'Music/Sensory': '🎵'
  };
  const EYE_OFF = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const EYE = '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const typeIcon = t => TYPE_ICONS[t] || '⭐';

  const $ = id => document.getElementById(id);
  const els = { list: $('list'), status: $('status'), quick: $('quick-chips'), whereBtn: $('where-btn'), whereList: $('where-list'), whereVal: $('where-val'),
    menu: $('menu'), menuBtn: $('menu-btn'), radius: $('radius-row'), expandAll: $('expand-all'), clear: $('clear-chip'), detail: $('detail'), search: $('search'), searchClear: $('search-clear'), hiddenChip: $('hidden-chip') };

  const state = { near: false, weekend: false, free: false, sen: false, general: false, new: false, saved: false, area: 'all', town: 'all', type: 'all', query: '', showHidden: false };
  let allEvents = [];
  let saved = new Set();
  try { saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch (_) {}
  // v1.9.0: a copy of each saved item is kept on the device so My plan still opens offline / after an item leaves the feed
  const SAVED_ITEMS_KEY = 'sen-events-ni-saved-items-v1', REMIND_KEY = 'sen-events-ni-reminders-v1';
  let savedItems = {};
  try { savedItems = JSON.parse(localStorage.getItem(SAVED_ITEMS_KEY) || '{}') || {}; } catch (_) {}
  let remindOn = true;
  try { remindOn = localStorage.getItem(REMIND_KEY) !== 'off'; } catch (_) {}
  const persistSaved = () => {
    for (const id of Object.keys(savedItems)) if (!saved.has(id)) delete savedItems[id];
    allEvents.forEach(ev => { if (saved.has(ev.id)) savedItems[ev.id] = ev; });
    try { localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])); localStorage.setItem(SAVED_ITEMS_KEY, JSON.stringify(savedItems)); } catch (_) {}
    syncReminders();
  };
  const findEvent = id => allEvents.find(x => x.id === id) || savedItems[id] || null;
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
    const hay = norm([ev.name, ev.description, ev.venue, ev.town, countyOf(ev)].join(' '));
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
  // v1.8.0: chosen "Near me" radius (miles; 0 = any distance), remembered on the device
  const RADIUS_KEY = 'sen-events-ni-radius-v1', RADII = [5, 10, 25, 50, 0];
  let radius = 10;
  try { const r = parseInt(localStorage.getItem(RADIUS_KEY), 10); if (RADII.indexOf(r) >= 0) radius = r; } catch (_) {}
  const radiusText = () => radius ? 'within ' + radius + ' miles' : 'at any distance';
  const origin = () => userPos || HOME;
  let userPos = null, geoNotice = '';
  function hasCoords(ev) { return typeof ev.lat === 'number' && typeof ev.lng === 'number'; }
  function distMi(ev, from) {
    const p = from || userPos;
    if (!p || !hasCoords(ev)) return null;
    const r = Math.PI / 180, dLat = (ev.lat - p.lat) * r, dLng = (ev.lng - p.lng) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(ev.lat * r) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }
  function requestLocation() {
    geoNotice = 'Finding your location…';
    const fail = () => { userPos = null; geoNotice = 'Location unavailable, so showing places ' + radiusText() + ' of Newtownabbey instead, nearest first.'; render(); };
    if (!navigator.geolocation) return fail();
    navigator.geolocation.getCurrentPosition(p => {
      userPos = { lat: p.coords.latitude, lng: p.coords.longitude }; geoNotice = ''; render();
    }, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }
  // v1.8.4: Free = the price text says the item itself is free ("Free", "Free entry", "Free (booking required)", "£0", "No charge"),
  // not just carers/under-2s/members ("Carers free", "Free with zoo admission" and "£5 + £0.25 fee" don't count).
  function isFree(ev) {
    const p = String(ev.price || '').trim();
    return /^free\b(?!\s+(with|for)\b)/i.test(p) || /^£\s?0(\.00)?(?![\d.])/.test(p) || /^(no charge|free of charge)\b/i.test(p) ||
      /\bfree (entry|admission|event|to (visit|attend|enter))\b/i.test(p) && !/£\s?[1-9]/.test(p);
  }
  function overlaps(ev, from, to) { const s = startOf(ev); if (!s) return false; const e = endOf(ev) || s; return s <= to && e >= from; }
  function weekendRange() {
    const t = today(); const dow = t.getDay();
    const sat = dow === 0 ? addDays(t, -1) : addDays(t, 6 - dow);
    return [dow === 0 ? t : sat, addDays(sat, 1)];
  }
  // v1.8.4: This weekend = runs on the coming Sat/Sun (today and tomorrow if it's already Saturday, today if Sunday).
  // Dated items must overlap that weekend; if their schedule names weekdays only (e.g. "Mondays 8pm") they're left out.
  // Undated/ongoing items count when their schedule mentions Sat/Sun, weekends or daily opening.
  const WKND_RE = /\b(sat(urday)?s?|sun(day)?s?|weekends?|daily|every ?day|7 days|seven days|open daily)\b/i;
  const WKDAY_RE = /\b(mon|tues?|wed(nes)?|thu(rs)?|fri)(day)?s?\b/i;
  function isWeekend(ev) {
    const [a, b] = weekendRange();
    const sched = (ev.recurring || '') + ' ' + (ev.time || '');
    if (startOf(ev)) {
      if (!overlaps(ev, a, b)) return false;
      if (ev.recurring && WKDAY_RE.test(sched) && !WKND_RE.test(sched)) return false;
      return true;
    }
    return WKND_RE.test(sched);
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
      state.area !== 'all' || state.town !== 'all' || state.type !== 'all' || (state.query && state.query.trim()));
  }
  function filtered(wantHidden, ignoreTown) {
    return allEvents.filter(ev => {
      if (isPast(ev)) return false;
      if (hidden.has(ev.id) !== !!wantHidden) return false;
      if (!matchesQuery(ev)) return false;
      if (state.near) {
        const d = distMi(ev, origin()); if (radius && d !== null && d > radius) return false;
      }
      if (state.weekend && !isWeekend(ev)) return false;
      if (state.free && !isFree(ev)) return false;
      if (state.sen && !ev.senSpecific) return false;
      if (state.general && ev.senSpecific) return false;
      if (state.new && !isNew(ev)) return false;
      if (state.saved && !saved.has(ev.id)) return false;
      if (state.area !== 'all' && countyOf(ev) !== state.area) return false;
      if (!ignoreTown && state.town !== 'all' && countyOf(ev) + '|' + ev.town !== state.town) return false;
      if (state.type !== 'all' && ev.type !== state.type) return false;
      return true;
    }).sort((a, b) => {
      if (state.near) {
        const d1 = distMi(a, origin()), d2 = distMi(b, origin());
        if (d1 !== d2) return (d1 === null ? 9e9 : d1) - (d2 === null ? 9e9 : d2);
      }
      const s1 = startOf(a), s2 = startOf(b);
      const k = [(AREA_ORDER[countyOf(a)] ?? 9) - (AREA_ORDER[countyOf(b)] ?? 9), (s1 ? +s1 : 9e15) - (s2 ? +s2 : 9e15)];
      for (const v of k) if (v) return v;
      return a.name.localeCompare(b.name);
    });
  }

  const hideBtn = ev => '<button class="hide-btn" data-hide="' + esc(ev.id) + '" aria-label="Hide" title="Hide">' + EYE_OFF + '</button>';
  function hiddenCard(ev) {
    return '<article class="card card-hidden" data-id="' + esc(ev.id) + '" tabindex="0">' +
      '<div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div>' +
      '<div class="card-body"><h2 class="h2-hidden">' + esc(ev.name) + '</h2>' +
        '<p class="meta">' + esc(ev.venue) + ' · ' + esc(placeOf(ev)) + '</p></div>' +
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
  // ---------- v1.9.2 Map view (Leaflet + OpenStreetMap tiles; Leaflet is bundled, tiles need a connection) ----------
  const VIEW_KEY = 'sen-events-ni-view-v1';
  let view = 'list';
  try { if (sessionStorage.getItem(VIEW_KEY) === 'map') view = 'map'; } catch (_) {}
  let map = null, pinLayer = null, meLayer = null, lastPinSig = '';
  function setView(v) {
    view = v; try { sessionStorage.setItem(VIEW_KEY, v); } catch (_) {}
    render(); window.scrollTo(0, 0);
  }
  function pinColour(list) {
    const sen = list.filter(ev => ev.senSpecific).length;
    return sen === list.length ? { fillColor: '#FDC722', color: '#173766' } : sen === 0 ? { fillColor: '#173766', color: '#ffffff' } : { fillColor: '#173766', color: '#FDC722' };
  }
  function renderMap(items) {
    const wrap = $('map-wrap'); if (!wrap) return;
    if (!window.L) { wrap.innerHTML = '<p class="empty">The map could not load.</p>'; return; }
    if (!map) {
      map = L.map('map', { zoomSnap: 0.25, zoomDelta: 0.5, zoomControl: true, attributionControl: true, tap: true }).setView([54.65, -6.6], 8);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      pinLayer = L.layerGroup().addTo(map); meLayer = L.layerGroup().addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 0);
    const byPlace = new Map();
    items.forEach(ev => { if (!hasCoords(ev)) return; const k = ev.lat.toFixed(4) + ',' + ev.lng.toFixed(4); if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(ev); });
    const sig = items.map(ev => ev.id).join('|') + (state.near ? '|near' + radius : '');
    if (sig === lastPinSig) return;
    lastPinSig = sig;
    pinLayer.clearLayers(); meLayer.clearLayers();
    const pts = [];
    byPlace.forEach(list => {
      const ev0 = list[0], c = pinColour(list);
      const m = L.circleMarker([ev0.lat, ev0.lng], Object.assign({ radius: list.length > 1 ? 10 : 8, weight: 2.5, fillOpacity: .95 }, c));
      const head = list.length > 1 ? '<p class="mp-venue">' + esc(ev0.venue) + ' · ' + list.length + ' items</p>' : '';
      m.bindPopup('<div class="map-pop">' + head + list.slice(0, 30).map(ev => '<a class="mp-item" href="#e/' + encodeURIComponent(ev.id) + '"><span class="mp-ico" aria-hidden="true">' + typeIcon(ev.type) + '</span><span><b>' + esc(ev.name) + '</b><br><small>' +
        esc(runBadge(ev) || dateLabel(ev)) + (list.length > 1 ? '' : ' · ' + esc(ev.venue)) + '</small><br>' + pills(ev) + '</span></a>').join('') + (list.length > 30 ? '<p class="mp-venue">…and ' + (list.length - 30) + ' more</p>' : '') + '</div>', { maxWidth: 290, minWidth: 220, autoPanPadding: [20, 20] });
      m.addTo(pinLayer); pts.push([ev0.lat, ev0.lng]);
    });
    if (state.near) {
      const o = origin();
      L.circleMarker([o.lat, o.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2f7de1', fillOpacity: 1 }).bindTooltip(userPos ? 'You' : 'Newtownabbey (location unavailable)').addTo(meLayer);
      if (radius) L.circle([o.lat, o.lng], { radius: radius * 1609.34, color: '#2f7de1', weight: 1.5, fillOpacity: .05 }).addTo(meLayer);
      pts.push([o.lat, o.lng]);
    }
    map.invalidateSize();
    const fit = () => { if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 14, animate: false }); };
    fit(); setTimeout(() => { map.invalidateSize(); fit(); }, 60);
  }
  function render() {
    updateHiddenChip();
    renderWhere();
    renderChipRow();
    els.expandAll.hidden = true;
    const vt = $('view-toggle');
    if (vt) { vt.hidden = state.showHidden; vt.textContent = view === 'map' ? '☰ List' : '🗺️ Map'; vt.setAttribute('aria-label', view === 'map' ? 'Show as list' : 'Show on a map'); }
    const mw = $('map-wrap'), inMap = view === 'map' && !state.showHidden;
    if (mw) mw.hidden = !inMap;
    els.list.hidden = inMap;
    document.body.classList.toggle('view-map', inMap);
    if (inMap) {
      const items = filtered(false);
      const all = allEvents.filter(ev => !isPast(ev) && !hidden.has(ev.id)).length;
      const noLoc = items.filter(ev => !hasCoords(ev)).length;
      els.status.textContent = (anyFilter() ? items.length + ' of ' + all : items.length) + ' on the map' + (noLoc ? ' (' + noLoc + ' without a location)' : '');
      renderMap(items);
      return;
    }
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
    } else if (statusText) els.status.textContent = items.length + ' ' + statusText;
    const notice = state.near && geoNotice ? '<p class="geo-notice">' + esc(geoNotice) + '</p>' : (state.near && userPos ? '<p class="geo-notice geo-ok">📍 Places ' + radiusText() + ' of you, nearest first</p>' : '');
    if (!items.length) {
      els.list.innerHTML = notice + '<p class="empty">' + (state.query ? 'No matches for “' + esc(state.query.trim()) + '”.' : state.saved ? 'Nothing saved yet. Tap ♡ on anything you like.' : 'Nothing matches these filters right now.') + '</p>';
      return;
    }
    // v1.8.0: collapsible sections by type, biggest first (Found today on top when there is any)
    const byType = new Map();
    items.forEach(ev => { const t = ev.type || 'Other'; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(ev); });
    const sections = [...byType.entries()].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))
      // v1.8.1: items found today go to the top of their own section (stable, keeps the usual order otherwise)
      .map(([t, list]) => ({ key: 't:' + t, icon: typeIcon(t), name: t, list: list.filter(isNew).concat(list.filter(ev => !isNew(ev))), fresh: list.filter(isNew).length }));
    // auto-expand: search, type chip or Found today filter active, or only one section to show
    const forced = !!(state.query && state.query.trim()) || state.type !== 'all' || state.new || sections.length === 1;
    const isOpen = sec => forced || expanded.has(sec.key);
    let html = notice;
    sections.forEach((sec, i) => {
      const open = isOpen(sec), id = 'sec-' + i;
      html += '<section class="tsec' + (open ? ' open' : '') + '" data-sec="' + esc(sec.key) + '">' +
        '<h3 class="tsec-h"><button class="tsec-head" type="button" aria-expanded="' + open + '" aria-controls="' + id + '" data-sec-toggle="' + esc(sec.key) + '">' +
          '<span class="tsec-ico" aria-hidden="true">' + sec.icon + '</span><span class="tsec-name">' + esc(sec.name).replace(/\//g, '/<wbr>') + '</span>' +
          '<span class="tsec-count">' + sec.list.length + '</span>' + (sec.fresh ? '<span class="tsec-new" aria-label="' + sec.fresh + ' new today"><span class="tsec-new-star" aria-hidden="true">✦\uFE0E</span> ' + sec.fresh + ' new</span>' : '') + '<span class="tsec-chev" aria-hidden="true"></span></button></h3>' +
        '<div class="tsec-body" id="' + id + '"' + (open ? '' : ' inert') + '><div class="tsec-inner">' + sec.list.map(cardHtml).join('') + '</div></div></section>';
    });
    els.expandAll.hidden = forced || sections.length < 2;
    const allOpen = sections.every(isOpen);
    els.expandAll.textContent = allOpen ? 'Collapse all' : 'Expand all';
    els.expandAll.dataset.mode = allOpen ? 'collapse' : 'expand';
    lastSections = sections.map(x => x.key);
    els.list.innerHTML = html;
  }

  function cardHtml(ev) {
    return '<article class="card' + (ev.soldOut ? ' sold-out' : '') + '" data-id="' + esc(ev.id) + '" tabindex="0">' +
      '<div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div>' +
      '<div class="card-body">' +
        '<h2>' + esc(ev.name) + '</h2>' +
        (runBadge(ev) ? '<p class="run-badge">📅 ' + esc(runBadge(ev)) + '</p>' : '<p class="meta">' + esc(dateLabel(ev)) + '</p>') +
        '<p class="meta">' + (state.near && distMi(ev, origin()) !== null ? '<span class="dist">' + distMi(ev, origin()).toFixed(1) + ' mi</span> · ' : '') + esc(ev.venue) + ' · <span class="place">' + esc(placeOf(ev)) + '</span>' + (ev.price ? ' · ' + esc(ev.price) : '') + '</p>' +
        '<div class="pills">' + pills(ev) + '</div>' +
      '</div>' + heartBtn(ev) + hideBtn(ev) +
    '</article>';
  }
  // ---- v1.8.0 section expand state (kept for this session) ----
  const EXP_KEY = 'sen-events-ni-expanded-v1';
  let expanded = new Set(), expandedTouched = new Set(), lastSections = [];
  try { const o = JSON.parse(sessionStorage.getItem(EXP_KEY) || '{}'); expanded = new Set(o.open || []); expandedTouched = new Set(o.touched || []); } catch (_) {}
  const persistExpanded = () => { try { sessionStorage.setItem(EXP_KEY, JSON.stringify({ open: [...expanded], touched: [...expandedTouched] })); } catch (_) {} };
  function setSection(secEl, open) {
    secEl.classList.toggle('open', open);
    const btn = secEl.querySelector('.tsec-head'), body = secEl.querySelector('.tsec-body');
    btn.setAttribute('aria-expanded', String(open));
    if (open) body.removeAttribute('inert'); else body.setAttribute('inert', '');
  }
  function toggleSection(key) {
    const secEl = [...els.list.querySelectorAll('.tsec')].find(x => x.dataset.sec === key); if (!secEl) return;
    const open = !secEl.classList.contains('open');
    if (open) expanded.add(key); else expanded.delete(key);
    expandedTouched.add(key); persistExpanded();
    setSection(secEl, open);
    syncExpandAll();
  }
  function syncExpandAll() {
    const secs = [...els.list.querySelectorAll('.tsec')];
    const allOpen = secs.length && secs.every(x => x.classList.contains('open'));
    els.expandAll.textContent = allOpen ? 'Collapse all' : 'Expand all';
    els.expandAll.dataset.mode = allOpen ? 'collapse' : 'expand';
  }
  // ---- v1.8.0 single chip row: active chips first, then quick filters | types ----
  // v1.8.4: the chip row holds exactly these five, in this fixed order
  const QUICK = [['near', '📍 Near me'], ['weekend', '📅 This weekend'], ['free', '🆓 Free'], ['sen', '💙 SEN only'], ['general', '🎈 General only']];
  let allTypes = [];
  function renderChipRow() {
    const k = activeFilterCount();
    const qBtn = (key, label) => '<button class="chip" data-q="' + key + '" aria-pressed="' + !!state[key] + '">' + label + '</button>';
        const h = QUICK.map(([key, l]) => qBtn(key, l)).join('');
    els.clear.hidden = !k; els.clear.textContent = 'Clear filters (' + k + ')';
    els.quick.innerHTML = h;
    els.radius.hidden = !state.near;
    els.radius.querySelectorAll('[data-radius]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.radius === radius)));
  }
  // Town dropdown: every NI city/town/main village (NISRA settlements of 1,000+ people, from Wikipedia's
  // list of localities by population) plus any town used in events.json, with live counts.
  const NI_TOWNS = {"Belfast": ["Belfast", "Dunmurry"], "County Antrim": ["Aghagallon", "Ahoghill", "Antrim", "Ballycarry", "Ballycastle", "Ballyclare", "Ballymena", "Ballymoney", "Ballynure", "Broughshane", "Bushmills", "Carnlough", "Carrickfergus", "Clogh Mills", "Cogry / Kilbride", "Crumlin", "Cullybackey", "Cushendall", "Doagh", "Dunloy", "Glenariff", "Glenarm", "Glenavy", "Glengormley", "Greenisland", "Islandmagee", "Kells / Connor", "Larne", "Lisburn", "Maghaberry", "Milltown", "Newtownabbey", "Portglenone", "Portrush", "Randalstown", "Rasharkin", "Templepatrick", "Toome", "Whitehead"], "County Down": ["Annahilt", "Annalong", "Ardglass", "Ballygowan", "Ballyhalbert", "Ballynahinch", "Ballywalter", "Banbridge", "Bangor", "Bleary", "Carrowdore", "Carryduff", "Castlewellan", "Clough", "Cloughey", "Comber", "Crawfordsburn", "Crossgar", "Dollingstown", "Donaghadee", "Donaghcloney", "Downpatrick", "Dromara", "Dromore (Down)", "Drumaness", "Dundonald", "Dundrum", "Gilford", "Groomsport", "Helen's Bay", "Hillsborough", "Hilltown", "Holywood", "Kilkeel", "Killyleagh", "Kinallen", "Kircubbin", "Magheralin", "Mayobridge", "Millisle", "Moira", "Moneyreagh", "Newcastle", "Newry", "Newtownards", "Portaferry", "Portavogie", "Rathfriland", "Rostrevor", "Saintfield", "Seahill", "Waringstown", "Warrenpoint"], "County Armagh": ["Armagh", "Bessbrook", "Camlough", "Craigavon", "Crossmaglen", "Drumnacanvy", "Hamiltonsbawn", "Keady", "Laurelvale / Mullavilly", "Lurgan", "Markethill", "Portadown", "Richhill", "Tandragee"], "County Londonderry": ["Ballykelly", "Bellaghy", "Castledawson", "Castlerock", "Claudy", "Coleraine", "Culmore", "Derry~Londonderry", "Draperstown", "Dungiven", "Eglinton", "Garvagh", "Greysteel", "Kilrea", "Limavady", "Maghera", "Magherafelt", "Moneymore", "Newbuildings", "Portstewart", "Strathfoyle"], "County Tyrone": ["Annaghmore", "Aughnacloy", "Castlederg", "Coalisland", "Cookstown", "Donaghmore", "Dromore (Tyrone)", "Dungannon", "Fintona", "Fivemiletown", "Killyman", "Moy", "Newtownstewart", "Omagh", "Sion Mills", "Strabane"], "County Fermanagh": ["Ballinamallard", "Enniskillen", "Irvinestown", "Kesh", "Lisbellaw", "Lisnaskea", "Maguiresbridge"]};
  // ---- v1.8.0: merged "Where" (area + town) ----
  function whereCounts() {
    const keep = [state.area, state.town]; state.area = 'all'; state.town = 'all';
    const list = filtered(state.showHidden, true);
    state.area = keep[0]; state.town = keep[1];
    const c = {}, t = {};
    list.forEach(ev => { const k = countyOf(ev); c[k] = (c[k] || 0) + 1; const tk = k + '|' + ev.town; t[tk] = (t[tk] || 0) + 1; });
    return { all: list.length, c, t };
  }
  function townsOf(c) {
    const set = new Set(NI_TOWNS[c] || []);
    allEvents.forEach(ev => { if (countyOf(ev) === c && ev.town && !/\//.test(ev.town)) set.add(ev.town); });
    set.delete(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }
  function whereLabel() {
    if (state.town !== 'all') { const [c, t] = state.town.split('|'); return t + ', ' + c.replace('County ', 'Co. '); }
    if (state.area !== 'all') return state.area;
    return 'All of NI';
  }
  function renderWhere() {
    const n = whereCounts();
    els.whereVal.textContent = whereLabel() + ' (' + (state.town !== 'all' ? (n.t[state.town] || 0) : state.area !== 'all' ? (n.c[state.area] || 0) : n.all) + ')';
    els.whereBtn.classList.toggle('active', state.area !== 'all' || state.town !== 'all');
    const opt = (lvl, val, label, cnt, sel) => '<button class="wopt lvl' + lvl + (sel ? ' sel' : '') + (cnt ? '' : ' zero') + '" data-where="' + esc(val) + '" role="option" aria-selected="' + sel + '">' +
      '<span>' + esc(label) + '</span><span class="n">' + cnt + '</span></button>';
    let h = opt(0, 'all', '🗺️ All of NI', n.all, state.area === 'all' && state.town === 'all') + '<div class="wsep"></div>';
    AREAS.forEach(c => {
      h += opt(1, 'c:' + c, c, n.c[c] || 0, state.area === c && state.town === 'all');
      townsOf(c).forEach(t => { const k = c + '|' + t; if (n.t[k] || state.town === k) h += opt(2, 't:' + k, t, n.t[k] || 0, state.town === k); });
    });
    els.whereList.innerHTML = h;
  }
  function activeFilterCount() {
    return ['near', 'weekend', 'free', 'sen', 'general', 'new', 'saved'].filter(k => state[k]).length +
      (state.area !== 'all' || state.town !== 'all' ? 1 : 0) + (state.type !== 'all' ? 1 : 0) + (state.query && state.query.trim() ? 1 : 0);
  }
  function setWhere(v) {
    if (v === 'all') { state.area = 'all'; state.town = 'all'; }
    else if (v.startsWith('c:')) { state.area = v.slice(2); state.town = 'all'; }
    else { const k = v.slice(2); state.town = k; state.area = k.split('|')[0]; }
  }
  function syncChips() {
    document.querySelectorAll('.menu [data-q]').forEach(b => b.setAttribute('aria-pressed', String(!!state[b.dataset.q])));
    if (allTypes.length || els.quick.children.length) renderChipRow();
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
    const where = ev.venue + ', ' + placeOf(ev);
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
    downloadIcs([{ ev, begin, end, allDay, where, details }], ev.name);
  }
  // v1.9.0: .ics file (works with Google, Apple, Outlook calendars) for the web version
  function calSpec(ev) {
    const s0 = startOf(ev); if (!s0) return null;
    const long = isLong(ev), day = long && s0 < today() ? today() : s0, tm = parseTimes(ev.time);
    let begin, end, allDay;
    if (tm) { begin = new Date(day); begin.setHours(tm.sh, tm.sm, 0, 0); if (tm.eh != null) { end = new Date(day); end.setHours(tm.eh, tm.em, 0, 0); } if (!end || end <= begin) end = new Date(+begin + 2 * 3600000); allDay = false; }
    else { begin = new Date(day); end = addDays(day, (!long && endOf(ev)) ? Math.round((endOf(ev) - s0) / DAY) + 1 : 1); allDay = true; }
    return { ev, begin, end, allDay, where: ev.venue + ', ' + placeOf(ev), details: (ev.time ? 'Time: ' + ev.time + '\n' : '') + (ev.description || '') + '\n' + (ev.url || '') };
  }
  const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  function downloadIcs(specs, name) {
    const stamp = toICSDateTime(new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Out & About NI//EN', 'CALSCALE:GREGORIAN'];
    specs.filter(Boolean).forEach(c => {
      lines.push('BEGIN:VEVENT', 'UID:' + c.ev.id + '@out-and-about-ni', 'DTSTAMP:' + stamp,
        c.allDay ? 'DTSTART;VALUE=DATE:' + toICSDate(c.begin) : 'DTSTART;TZID=Europe/London:' + toICSDateTime(c.begin),
        c.allDay ? 'DTEND;VALUE=DATE:' + toICSDate(c.end) : 'DTEND;TZID=Europe/London:' + toICSDateTime(c.end),
        'SUMMARY:' + icsEsc(c.ev.name), 'LOCATION:' + icsEsc(c.where), 'DESCRIPTION:' + icsEsc(c.details), 'URL:' + (c.ev.url || ''), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
    a.download = (name || 'my-plan').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.ics';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // ---------- v1.9.0 My plan ----------
  const fmtLong = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  function nextDate(ev) { const s = startOf(ev); if (!s) return null; if (s >= today()) return s; const e = endOf(ev); return e && e >= today() ? today() : null; }
  function reminderList() {
    const out = [], now = Date.now(), A = window.SENAndroid;
    Object.values(savedItems).forEach(ev => {
      const s = startOf(ev);
      if (remindOn && s && s > today()) {
        const at = addDays(s, -1); at.setHours(18, 0, 0, 0);
        if (+at > now) out.push({ key: ev.id + '|eve', id: ev.id, at: +at, title: 'Tomorrow: ' + ev.name, text: [ev.time, ev.venue + ', ' + placeOf(ev)].filter(Boolean).join(' · ') });
      }
      const bo = parseDate(ev.bookingOpens);
      if (bo) { const at = new Date(bo); at.setHours(9, 0, 0, 0); if (+at > now) out.push({ key: ev.id + '|book', id: ev.id, at: +at, title: 'Booking opens today: ' + ev.name, text: 'Tap to open the booking link' + (ev.venue ? ' · ' + ev.venue : '') }); }
    });
    return out;
  }
  function syncReminders() { try { const A = window.SENAndroid; if (A && A.setReminders) A.setReminders(JSON.stringify(reminderList())); } catch (_) {} }
  function planItem(ev) {
    const nd = nextDate(ev), past = startOf(ev) && !nd && !ev.recurring;
    const when = runBadge(ev) || dateLabel(ev);
    return '<article class="card plan-card' + (past ? ' plan-past' : '') + '" data-id="' + esc(ev.id) + '" tabindex="0">' +
      '<div class="type-icon" aria-hidden="true">' + typeIcon(ev.type) + '</div><div class="card-body"><h2>' + esc(ev.name) + '</h2>' +
      '<p class="meta">' + (past ? 'Finished · ' : '') + esc(when) + '</p><p class="meta">' + esc(ev.venue) + ' · <span class="place">' + esc(placeOf(ev)) + '</span></p>' +
      '<div class="pills">' + pills(ev) + '</div>' +
      (!past && startOf(ev) ? '<button class="plan-cal" data-plan-cal="' + esc(ev.id) + '">🗓️ Add to calendar</button>' : '') +
      '</div>' + heartBtn(ev) + '</article>';
  }
  function showPlan() {
    const list = Object.values(savedItems);
    const dated = list.filter(ev => nextDate(ev)).sort((a, b) => (startOf(a) < today() ? 0 : 1) - (startOf(b) < today() ? 0 : 1) || nextDate(a) - nextDate(b) || a.name.localeCompare(b.name));
    const undated = list.filter(ev => !startOf(ev)).sort((a, b) => a.name.localeCompare(b.name));
    const past = list.filter(ev => startOf(ev) && !nextDate(ev));
    const A = window.SENAndroid, native = !!(A && A.setReminders);
    let h = '<div class="detail-inner plan"><div class="detail-top"><button class="icon-btn" data-back>← Back</button>' +
      (dated.length && !native ? '<button class="icon-btn" data-plan-ics>🗓️ All to calendar (.ics)</button>' : '') + '</div>' +
      '<h2 class="plan-title">♥ My plan</h2>' +
      (native ? '<label class="plan-remind"><input type="checkbox" id="plan-remind"' + (remindOn ? ' checked' : '') + '> 🔔 Remind me the evening before (6pm)</label>'
              : '<p class="plan-note">Reminders the evening before work in the Android app. Here you can add items to your calendar instead.</p>');
    if (!list.length) h += '<p class="empty">Nothing saved yet. Tap ♡ on any event or place to add it to your plan.</p>';
    let lastDay = '';
    dated.forEach(ev => { const on = startOf(ev) < today(), d = on ? 'On now' : fmtLong(nextDate(ev));
      if (d !== lastDay) { h += '<h3 class="plan-day">' + (on ? '' : +nextDate(ev) === +today() ? 'Today · ' : +nextDate(ev) === +addDays(today(), 1) ? 'Tomorrow · ' : '') + esc(d) + '</h3>'; lastDay = d; } h += planItem(ev); });
    if (undated.length) h += '<h3 class="plan-day">Any time · no fixed date</h3>' + undated.map(planItem).join('');
    if (past.length) h += '<h3 class="plan-day">Finished</h3>' + past.map(planItem).join('');
    els.detail.innerHTML = h + '</div>';
    els.detail.hidden = false; els.detail.scrollTop = 0; document.body.style.overflow = 'hidden';
    const cb = $('plan-remind'); if (cb) cb.addEventListener('change', () => { remindOn = cb.checked; try { localStorage.setItem(REMIND_KEY, remindOn ? 'on' : 'off'); } catch (_) {} syncReminders(); });
  }
  function updatePlanBtn() { const b = $('plan-btn'); if (b) { const n = Object.keys(savedItems).length; b.querySelector('.plan-n').textContent = n ? n : ''; b.setAttribute('aria-label', 'My plan, ' + n + ' saved'); } }
  const mapsUrl = ev => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue + ', ' + placeOf(ev) + ', Northern Ireland');

  function row(icon, label, value) {
    return value ? '<div class="info-row"><span class="k" aria-hidden="true">' + icon + '</span><div class="v"><span class="lbl">' + label + '</span>' + esc(value) + '</div></div>' : '';
  }
  function showDetail(id) {
    const ev = findEvent(id);
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
          row('📍', 'Where', ev.venue + ', ' + placeOf(ev)) +
          row('🧭', 'County', countyOf(ev)) +
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
    if (m) showDetail(decodeURIComponent(m[1])); else if (location.hash === '#plan') showPlan(); else hideDetail();
  }

  // ---------- Events ----------
  function toggleSave(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    persistSaved();
    render(); updatePlanBtn();
    if (!els.detail.hidden) { if (location.hash === '#plan') showPlan(); else showDetail(id); }
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
  els.hiddenChip.addEventListener('click', () => { els.menu.hidden = true; state.showHidden = !state.showHidden; render(); window.scrollTo(0,0); });
  document.addEventListener('click', e => {
    const hb = e.target.closest('[data-hide]');
    if (hb) { e.stopPropagation(); e.preventDefault(); setHidden(hb.dataset.hide, true); return; }
    const ub = e.target.closest('[data-unhide]');
    if (e.target.closest('[data-back-all]')) { e.preventDefault(); state.showHidden = false; render(); window.scrollTo(0,0); return; }
    if (ub) { e.stopPropagation(); e.preventDefault(); setHidden(ub.dataset.unhide, false); return; }
    const h = e.target.closest('[data-heart]');
    if (h) { e.stopPropagation(); e.preventDefault(); toggleSave(h.dataset.heart); return; }
    const pc = e.target.closest('[data-plan-cal]');
    if (pc) { e.stopPropagation(); e.preventDefault(); const ev = findEvent(pc.dataset.planCal); if (ev) addToCalendar(ev); return; }
    if (e.target.closest('[data-plan-ics]')) { downloadIcs(Object.values(savedItems).filter(nextDate).map(calSpec), 'my-plan'); return; }
    if (e.target.closest('#view-toggle')) { setView(view === 'map' ? 'list' : 'map'); return; }
    if (e.target.closest('#plan-btn')) { location.hash = 'plan'; return; }
    if (e.target.closest('[data-back]')) { history.length > 1 ? history.back() : (location.hash = ''); return; }
    const q = e.target.closest('[data-q]');
    if (q) { if (q.closest('.menu')) { els.menu.hidden = true; els.menuBtn.setAttribute('aria-expanded', 'false'); } state[q.dataset.q] = !state[q.dataset.q];
      if (state[q.dataset.q] && q.dataset.q === 'sen') state.general = false; // SEN only / General only are mutually exclusive
      if (state[q.dataset.q] && q.dataset.q === 'general') state.sen = false; if (q.dataset.q === 'near' && state.near) requestLocation(); syncChips(); render(); return; }
    const a = e.target.closest('[data-area]');
    if (a) { state.area = a.dataset.area; state.town = 'all'; syncChips(); render(); return; }
    const t = e.target.closest('[data-type]');
    if (t) { state.type = state.type === t.dataset.type ? 'all' : t.dataset.type; syncChips(); render(); return; }
    const card = e.target.closest('.card[data-id]');
    if (card) location.hash = 'e/' + encodeURIComponent(card.dataset.id);
  });
  const closePops = () => { els.whereList.hidden = true; els.whereBtn.setAttribute('aria-expanded', 'false'); els.menu.hidden = true; els.menuBtn.setAttribute('aria-expanded', 'false'); };
  els.whereBtn.addEventListener('click', e => { e.stopPropagation(); const open = els.whereList.hidden; closePops(); els.whereList.hidden = !open; els.whereBtn.setAttribute('aria-expanded', String(open)); });
  els.menuBtn.addEventListener('click', e => { e.stopPropagation(); const open = els.menu.hidden; closePops(); els.menu.hidden = !open; els.menuBtn.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', e => {
    const st = e.target.closest('[data-sec-toggle]');
    if (st) { toggleSection(st.dataset.secToggle); return; }
    if (e.target.closest('#expand-all')) {
      const open = els.expandAll.dataset.mode === 'expand';
      els.list.querySelectorAll('.tsec').forEach(x => { const key = x.dataset.sec; if (open) expanded.add(key); else expanded.delete(key); expandedTouched.add(key); setSection(x, open); });
      persistExpanded(); syncExpandAll(); return;
    }
    const rb = e.target.closest('[data-radius]');
    if (rb) { radius = +rb.dataset.radius; try { localStorage.setItem(RADIUS_KEY, String(radius)); } catch (_) {} if (!userPos && geoNotice && geoNotice.indexOf('unavailable') >= 0) geoNotice = 'Location unavailable, so showing places ' + radiusText() + ' of Newtownabbey instead, nearest first.'; render(); return; }
    const w = e.target.closest('[data-where]');
    if (w) { setWhere(w.dataset.where); closePops(); render(); return; }
    if (e.target.closest('#clear-chip')) { ['near','weekend','free','sen','general','new','saved'].forEach(k => state[k] = false); state.area = 'all'; state.town = 'all'; state.type = 'all'; state.query = ''; els.search.value = ''; syncChips(); render(); return; }
    if (!e.target.closest('.menu, .where-list')) closePops();
  }, true);
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
    persistSaved(); updatePlanBtn(); // refresh saved copies with the latest data, re-arm reminders
    allTypes = [...new Set(allEvents.map(e => e.type).filter(Boolean))].sort();
    syncChips();
    render();
    route();
    const when = data.updatedAt ? ' · updated ' + data.updatedAt.slice(0, 10) : '';
    statusText = 'events & places' + when;
    render();
  }
  async function fetchRemote() {
    let last;
    for (const base of REMOTE_URLS) {
      try {
        const res = await fetch(base + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error(base + ' ' + res.status);
        if (res.headers.get('X-OA-Offline')) throw new Error('offline (service worker copy)');
        return await res.json();
      } catch (e) { last = e; }
    }
    throw last || new Error('all remotes failed');
  }
  // v1.9.1 offline mode: the last good download is kept on the device (with the time it was fetched) and used when offline
  const CACHE_TIME_KEY = 'sen-events-ni-cache-time-v1';
  function offlineBanner(source, data) {
    const b = $('offline-banner'); if (!b) return;
    if (source === 'live') { b.hidden = true; return; }
    let t = null; try { t = source === 'offline copy' ? +localStorage.getItem(CACHE_TIME_KEY) : 0; } catch (_) {}
    const when = t ? new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : (data && data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' (copy built into the app)' : 'an earlier copy');
    b.innerHTML = '<span aria-hidden="true">📴</span> Offline — showing data from ' + esc(when) + '. Saved items in My plan still open. <button class="offline-retry" type="button" data-retry>Retry</button>';
    b.hidden = false;
  }
  let lastSource = '';
  async function init() {
    try {
      const data = await fetchRemote();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); localStorage.setItem(CACHE_TIME_KEY, String(Date.now())); } catch (_) {}
      lastSource = 'live'; applyData(data, 'live'); offlineBanner('live');
    } catch (e) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) {}
      if (cached) { lastSource = 'offline copy'; applyData(cached, 'offline copy'); offlineBanner('offline copy', cached); return; }
      try {
        const res = await fetch('events.json');
        const data = await res.json(); lastSource = 'bundled'; applyData(data, 'bundled'); offlineBanner('bundled', data);
      } catch (err) {
        els.list.innerHTML = '<p class="empty">Could not load events. Check your connection and try again.</p>' +
          (Object.keys(savedItems).length ? '<p class="empty empty-sm"><a href="#plan">Open My plan (' + Object.keys(savedItems).length + ' saved)</a></p>' : '');
      }
    }
  }
  window.addEventListener('online', () => { if (lastSource && lastSource !== 'live') init(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) { e.preventDefault(); init(); } });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) { window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); }); }

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
  (function () {
    // v1.7.3 theme toggle: Auto (system) -> Light -> Dark. Saved in localStorage; mirrored to Android for bars/background.
    const KEY = 'sen-events-ni-theme-v1', ORDER = ['auto', 'light', 'dark'];
    const ICON = { auto: '🌓', light: '☀️', dark: '🌙' };
    const LABEL = { auto: 'Auto (follows device)', light: 'Light', dark: 'Dark' };
    const b = $('theme-btn'), root = document.documentElement, mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    let mode = 'auto'; try { mode = localStorage.getItem(KEY) || 'auto'; } catch (_) {}
    if (ORDER.indexOf(mode) < 0) mode = 'auto';
    const apply = () => {
      if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
      const dark = mode === 'dark' || (mode === 'auto' && !!(mq && mq.matches));
      root.style.backgroundColor = dark ? '#0f1726' : '#fffaf0';
      const tc = $('theme-color'); if (tc) tc.setAttribute('content', '#173766');
      if (b) { b.innerHTML = '<span aria-hidden="true">' + ICON[mode] + '</span>'; b.setAttribute('aria-label', 'Theme: ' + LABEL[mode] + '. Tap to change'); b.title = 'Theme: ' + LABEL[mode]; }
      try { window.SENAndroid && window.SENAndroid.setTheme && window.SENAndroid.setTheme(mode, dark); } catch (_) {}
    };
    if (b) b.addEventListener('click', () => {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, mode); } catch (_) {}
      apply();
    });
    if (mq) { const f = () => { if (mode === 'auto') apply(); }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener && mq.addListener(f); }
    apply();
  })();
  window.senShowNew = function () { state.new = true; if (location.hash) location.hash = ''; syncChips(); render(); };
  syncChips();
  init();
})();
