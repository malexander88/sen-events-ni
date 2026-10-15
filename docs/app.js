(function () {
  const REMOTE_URLS = [
    'https://malexander88.github.io/sen-events-ni/events.json',
    'https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json'
  ];
  const CACHE_KEY = 'sen-events-ni-cache-v1';
  const AREA_ORDER = {
    'Newtownabbey & North Belfast': 0,
    'Belfast': 1,
    'Rest of Antrim': 2,
    'County Down': 3
  };

  const els = {
    list: document.getElementById('list'),
    status: document.getElementById('status'),
    area: document.getElementById('filter-area'),
    type: document.getElementById('filter-type'),
    sen: document.getElementById('filter-sen'),
    hidePast: document.getElementById('filter-hide-past')
  };

  let allEvents = [];

  function todayLocal() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function isPast(ev) {
    if (ev.recurring) return false;
    const end = parseDate(ev.endDate) || parseDate(ev.startDate);
    if (!end) return false;
    return end < todayLocal();
  }

  function sortKey(ev) {
    const area = AREA_ORDER[ev.area] ?? 9;
    const start = parseDate(ev.startDate);
    const t = start ? start.getTime() : (ev.recurring ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER);
    return [area, t, ev.name];
  }

  function cmp(a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }

  function dateLabel(ev) {
    if (ev.recurring) return ev.recurring;
    const parts = [];
    if (ev.startDate && ev.endDate && ev.startDate !== ev.endDate) {
      parts.push(ev.startDate + ' → ' + ev.endDate);
    } else if (ev.startDate) {
      parts.push(ev.startDate);
    }
    if (ev.time) parts.push(ev.time);
    return parts.join(' · ') || 'See booking page';
  }

  function fillTypes(events) {
    const types = [...new Set(events.map(e => e.type))].sort();
    const current = els.type.value;
    els.type.innerHTML = '<option value="all">All types</option>' +
      types.map(t => '<option value="' + escapeAttr(t) + '">' + escapeHtml(t) + '</option>').join('');
    if (types.includes(current)) els.type.value = current;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function filtered() {
    return allEvents
      .filter(ev => {
        if (els.hidePast.checked && isPast(ev)) return false;
        if (els.area.value !== 'all' && ev.area !== els.area.value) return false;
        if (els.type.value !== 'all' && ev.type !== els.type.value) return false;
        if (els.sen.value === 'sen' && !ev.senSpecific) return false;
        if (els.sen.value === 'suitable' && ev.senSpecific) return false;
        return true;
      })
      .sort(cmp);
  }

  function render() {
    const items = filtered();
    if (!items.length) {
      els.list.innerHTML = '<p class="empty">No events match these filters.</p>';
      return;
    }
    els.list.innerHTML = items.map(ev => {
      const senBadge = ev.senSpecific
        ? '<span class="badge badge-sen">SEN / autism-specific</span>'
        : '<span class="badge badge-suitable">Generally suitable</span>';
      const sold = ev.soldOut ? '<span class="badge badge-sold">Sold out</span>' : '';
      return (
        '<a class="card' + (ev.soldOut ? ' sold-out' : '') + '" href="' + escapeAttr(ev.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<div class="card-top">' + senBadge +
            '<span class="badge badge-type">' + escapeHtml(ev.type) + '</span>' + sold +
          '</div>' +
          '<h2>' + escapeHtml(ev.name) + '</h2>' +
          '<p class="meta">' + escapeHtml(dateLabel(ev)) + '</p>' +
          '<p class="meta">' + escapeHtml(ev.venue) + ', ' + escapeHtml(ev.town) +
            ' · ' + escapeHtml(ev.area) + '</p>' +
          '<p class="desc">' + escapeHtml(ev.description) + '</p>' +
          '<p class="price">' + escapeHtml(ev.price) + '</p>' +
          '<p class="cta">Open booking →</p>' +
        '</a>'
      );
    }).join('');
  }

  function setStatus(msg) { els.status.textContent = msg; }

  function applyData(data, source) {
    allEvents = (data && data.events) || [];
    fillTypes(allEvents);
    render();
    const when = data.updatedAt ? ' · updated ' + data.updatedAt.slice(0, 10) : '';
    setStatus(allEvents.length + ' events' + when + ' (' + source + ')');
  }

  async function loadFallback() {
    const res = await fetch('events.json');
    if (!res.ok) throw new Error('fallback ' + res.status);
    return res.json();
  }

  async function fetchRemote() {
    let lastErr;
    for (const base of REMOTE_URLS) {
      try {
        const res = await fetch(base + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error(base + ' ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all remotes failed');
  }

  async function init() {
    let used = null;
    try {
      const data = await fetchRemote();
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      applyData(data, 'live');
      used = 'live';
    } catch (e) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          applyData(JSON.parse(cached), 'cached');
          used = 'cached';
        }
      } catch (_) {}
      if (!used) {
        try {
          const data = await loadFallback();
          applyData(data, 'bundled');
        } catch (err) {
          setStatus('Could not load events. Check your connection and try again.');
        }
      } else {
        setStatus(els.status.textContent + ' · live update unavailable');
      }
    }
  }

  ['change', 'input'].forEach(ev => {
    els.area.addEventListener(ev, render);
    els.type.addEventListener(ev, render);
    els.sen.addEventListener(ev, render);
    els.hidePast.addEventListener(ev, render);
  });

  init();
})();
