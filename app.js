(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var requestId = 0;
  var suggestId = 0;
  var state = null;
  var errState = null;
  var mode = 'name';
  var editMode = false;
  var draggedUid = null;

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function loadJson(k) { try { return JSON.parse(load(k)); } catch (e) { return null; } }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  var LOCALES = { ru: 'ru-RU', en: 'en-GB' };
  var SEARCH_LANGS = ['ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'tr', 'zh', 'ja'];
  var showHourly = load('showHourly') !== '0';
  var showHistory = load('showHistory') === '1';

  function detectLang() {
    var l = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^ru/i.test(l) ? 'ru' : 'en';
  }
  var savedLang = load('lang');
  var lang = savedLang === 'ru' || savedLang === 'en' ? savedLang : detectLang();
  if (savedLang !== lang) store('lang', lang);
  var savedSearchLang = load('searchLang');
  var searchLang = SEARCH_LANGS.indexOf(savedSearchLang) >= 0 ? savedSearchLang : detectLang();
  if (savedSearchLang !== searchLang) store('searchLang', searchLang);

  function t(key, params) {
    var s = (I18N[lang][key] !== undefined ? I18N[lang][key] : I18N.en[key]) || key;
    if (params) for (var p in params) s = s.replace('{' + p + '}', params[p]);
    return s;
  }

  var WX_ICON = {
    clear: 'wb_sunny', night: 'nights_stay', partly: 'cloud_queue', cloud: 'cloud', fog: 'blur_on', drizzle: 'grain',
    rain: 'water_drop', showers: 'shower', snow: 'ac_unit', thunder: 'flash_on', unknown: 'help_outline'
  };
  function describeWeather(code, isDay) {
    var night = isDay === 0;
    if (code === 0) return { k: 'w_clear', i: night ? WX_ICON.night : WX_ICON.clear };
    if (code === 1) return { k: 'w_mostly_clear', i: night ? WX_ICON.night : WX_ICON.clear };
    if (code === 2) return { k: 'w_partly', i: night ? WX_ICON.night : WX_ICON.partly };
    if (code === 3) return { k: 'w_overcast', i: WX_ICON.cloud };
    if (code === 45 || code === 48) return { k: 'w_fog', i: WX_ICON.fog };
    if (code >= 51 && code <= 55) return { k: 'w_drizzle', i: WX_ICON.drizzle };
    if (code === 56 || code === 57) return { k: 'w_fdrizzle', i: WX_ICON.drizzle };
    if (code === 61 || code === 63 || code === 65) return { k: 'w_rain', i: WX_ICON.rain };
    if (code === 66 || code === 67) return { k: 'w_frain', i: WX_ICON.rain };
    if (code >= 71 && code <= 77) return { k: 'w_snow', i: WX_ICON.snow };
    if (code >= 80 && code <= 82) return { k: 'w_showers', i: WX_ICON.showers };
    if (code === 85 || code === 86) return { k: 'w_snowshow', i: WX_ICON.snow };
    if (code === 95) return { k: 'w_thunder', i: WX_ICON.thunder };
    if (code === 96 || code === 99) return { k: 'w_hail', i: WX_ICON.thunder };
    return { k: 'w_unknown', i: WX_ICON.unknown };
  }
  function moonPhase(date) {
    var SYNODIC = 29.530588853;
    var days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    var frac = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
    var illum = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
    var idx = Math.floor(frac * 8 + 0.5) % 8;
    return { emoji: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][idx], key: 'moon_' + idx, illum: illum };
  }
  function round(n) { return Math.round(n); }
  function mul(k) { return function (v) { return v * k; }; }

  var UNIT_KINDS = ['temp', 'wind', 'pressure', 'precip'];
  var UNIT_DEFS = {
    temp: { key: 'unitTemp', def: 'c', opts: {
      c: { to: mul(1), label: '°C', letter: 'C', digits: 0 },
      f: { to: function (v) { return v * 9 / 5 + 32; }, label: '°F', letter: 'F', digits: 0 }
    } },
    wind: { key: 'unitWind', def: 'kmh', opts: {
      kmh: { to: mul(1), labelKey: 'u_kmh', digits: 0 },
      ms: { to: mul(1 / 3.6), labelKey: 'u_ms', digits: 1 },
      mph: { to: mul(0.621371), labelKey: 'u_mph', digits: 0 },
      kn: { to: mul(0.539957), labelKey: 'u_kn', digits: 0 }
    } },
    pressure: { key: 'unitPressure', def: 'hpa', opts: {
      hpa: { to: mul(1), labelKey: 'u_hpa', digits: 0 },
      mmhg: { to: mul(0.750062), labelKey: 'u_mmhg', digits: 0 },
      inhg: { to: mul(0.02953), labelKey: 'u_inhg', digits: 2 }
    } },
    precip: { key: 'unitPrecip', def: 'mm', opts: {
      mm: { to: mul(1), labelKey: 'u_mm', digits: 1 },
      'in': { to: mul(1 / 25.4), labelKey: 'u_in', digits: 2 }
    } }
  };
  var units = {};
  UNIT_KINDS.forEach(function (k) {
    var d = UNIT_DEFS[k], v = load(d.key);
    units[k] = v && Object.prototype.hasOwnProperty.call(d.opts, v) ? v : d.def;
  });
  function unitOpt(kind) { return UNIT_DEFS[kind].opts[units[kind]]; }
  function conv(kind, v) { return unitOpt(kind).to(v); }
  function unitLabel(kind) { var o = unitOpt(kind); return o.label || t(o.labelKey); }
  function unitOptionLabel(kind, key) { var o = UNIT_DEFS[kind].opts[key]; return o.label || I18N[lang]['uo_' + key] || t(o.labelKey); }
  function measure(kind) {
    return function (v) {
      var o = unitOpt(kind);
      return num(Number(o.to(v).toFixed(o.digits))) + ' ' + unitLabel(kind);
    };
  }
  function fmtSnow(v) {
    var inch = units.precip === 'in';
    return num(Number((inch ? v / 2.54 : v).toFixed(inch ? 2 : 1))) + ' ' + (inch ? t('u_in') : t('u_cm'));
  }
  function fmtTemp(n) { var r = round(conv('temp', n)); return (r > 0 ? '+' : '') + r + '°'; }
  function fmtTempU(n) { return fmtTemp(n) + unitOpt('temp').letter; }
  function num(n) { return n.toLocaleString(LOCALES[lang]); }
  function compass(deg) { return t('compass').split(',')[Math.round(deg / 45) % 8]; }
  function orDash(v, fn) { return v === null || v === undefined ? '—' : fn(v); }
  function withUnit(unit, digits) {
    return function (v) { return num(Number(v.toFixed(digits || 0))) + (unit ? (unit === '%' ? '' : ' ') + unit : ''); };
  }
  function aqiColor(v) { return v < 20 ? '#4CAF50' : v < 40 ? '#FBC02D' : v < 60 ? '#FB8C00' : '#E53935'; }
  function timeOf(iso) { return iso ? String(iso).split('T')[1] || '—' : '—'; }
  function dataTs(data) {
    var c = data && data.current, ms = c && c.time ? Date.parse(c.time + 'Z') : NaN;
    return isNaN(ms) || typeof data.utc_offset_seconds !== 'number' ? Date.now() : ms - data.utc_offset_seconds * 1000;
  }
  function cityTimeText(s) {
    if (!s || !s.data) return '—';
    try {
      var tz = s.data.timezone;
      var now = new Date();
      if (tz) {
        return new Intl.DateTimeFormat(LOCALES[lang], { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      }
      var offset = (s.data.utc_offset_seconds || 0) * 1000;
      var d = new Date(now.getTime() + offset);
      return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    } catch (e) { return '—'; }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function showError(key, params) {
    errState = { key: key, params: params };
    $('errorText').textContent = t(key, params);
    $('error').classList.add('show');
    $('results').classList.remove('show', 'visible');
  }
  function clearError() { errState = null; $('error').classList.remove('show'); }
  function setExpanded(btn, box, open) {
    btn.setAttribute('aria-expanded', open);
    box.classList.toggle('open', open);
  }
  function setLoading(on) {
    $('loader').classList.toggle('show', on);
    $('search').disabled = on;
    $('locate').disabled = on;
    if (on) {
      clearError();
      hideSuggest();
      $('results').classList.remove('show', 'visible');
      setExpanded($('placeBtn'), $('placeInfo'), false);
    }
  }
  function showToast(msg) {
    var toast = $('toast');
    if (!toast) {
      toast = el('div', 'toast');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('show'); }, 2400);
  }

  var DEFAULT_LAYOUT = [
    { uid: 'time', type: 'time', w: 2, h: 1 },
    { uid: 'humidity', type: 'humidity', w: 1, h: 1 },
    { uid: 'wind', type: 'wind', w: 1, h: 1 },
    { uid: 'pressure', type: 'pressure', w: 1, h: 1 },
    { uid: 'cloud', type: 'cloud', w: 1, h: 1 },
    { uid: 'visibility', type: 'visibility', w: 1, h: 1 },
    { uid: 'dew', type: 'dew', w: 1, h: 1 },
    { uid: 'euro_aqi', type: 'euro_aqi', w: 1, h: 1 },
    { uid: 'pm2_5', type: 'pm2_5', w: 1, h: 1 },
    { uid: 'uv', type: 'uv', w: 1, h: 1 },
    { uid: 'moon_phase', type: 'moon_phase', w: 1, h: 1 },
    { uid: 'sunrise', type: 'sunrise', w: 1, h: 1 },
    { uid: 'sunset', type: 'sunset', w: 1, h: 1 }
  ];

  var TILE_DEFS = {
    humidity: { cat: 'weather', render: function (s) { return { icon: 'water_drop', value: orDash(s.data.current.relative_humidity_2m, withUnit('%')), label: t('humidity') }; } },
    wind: { cat: 'weather', render: function (s) { return { icon: 'air', value: orDash(s.data.current.wind_speed_10m, measure('wind')), label: t('wind') }; } },
    gusts: { cat: 'weather', render: function (s) { return { icon: 'waves', value: orDash(s.data.current.wind_gusts_10m, measure('wind')), label: t('gusts') }; } },
    direction: { cat: 'weather', render: function (s) { return { icon: 'explore', value: orDash(s.data.current.wind_direction_10m, function (v) { return round(v) + '° (' + compass(v) + ')'; }), label: t('direction') }; } },
    pressure: { cat: 'weather', render: function (s) { return { icon: 'speed', value: orDash(s.data.current.pressure_msl, measure('pressure')), label: t('pressure') }; } },
    pressure_surface: { cat: 'weather', render: function (s) { return { icon: 'terrain', value: orDash(s.data.current.surface_pressure, measure('pressure')), label: t('pressure_surface') }; } },
    dew: { cat: 'weather', render: function (s) { return { icon: 'opacity', value: orDash(s.data.current.dew_point_2m, fmtTempU), label: t('dew') }; } },
    cloud: { cat: 'weather', render: function (s) { return { icon: 'cloud', value: orDash(s.data.current.cloud_cover, withUnit('%')), label: t('cloud') }; } },
    visibility: { cat: 'weather', render: function (s) { return { icon: 'visibility', value: orDash(s.data.current.visibility, function (v) { return withUnit(t('u_km'), 1)(v / 1000); }), label: t('visibility') }; } },
    precip: { cat: 'weather', render: function (s) { return { icon: 'grain', value: orDash(s.data.current.precipitation, measure('precip')), label: t('precip') }; } },
    rain: { cat: 'weather', render: function (s) { return { icon: 'beach_access', value: orDash(s.data.current.rain, measure('precip')), label: t('rain') }; } },
    showers: { cat: 'weather', render: function (s) { return { icon: 'shower', value: orDash(s.data.current.showers, measure('precip')), label: t('showers') }; } },
    snowfall: { cat: 'weather', render: function (s) { return { icon: 'ac_unit', value: orDash(s.data.current.snowfall, fmtSnow), label: t('snowfall') }; } },
    daylight: { cat: 'weather', render: function (s) {
      var isDay = s.data.current.is_day === 1;
      return { icon: isDay ? 'light_mode' : 'dark_mode', value: orDash(s.data.current.is_day, function () { return isDay ? t('day') : t('night'); }), label: t('daylight') };
    } },
    precip_day: { cat: 'weather', render: function (s) { return { icon: 'invert_colors', value: orDash(s.data.daily.precipitation_sum && s.data.daily.precipitation_sum[0], measure('precip')), label: t('precip_day') }; } },
    wind_max: { cat: 'weather', render: function (s) { return { icon: 'trending_up', value: orDash(s.data.daily.wind_speed_10m_max && s.data.daily.wind_speed_10m_max[0], measure('wind')), label: t('wind_max') }; } },
    gusts_max: { cat: 'weather', render: function (s) { return { icon: 'flash_on', value: orDash(s.data.daily.wind_gusts_10m_max && s.data.daily.wind_gusts_10m_max[0], measure('wind')), label: t('gusts_max') }; } },

    time: { cat: 'custom', render: function (s) { return { icon: 'schedule', value: cityTimeText(s), label: t('city_time') }; } },

    euro_aqi: { cat: 'air', render: function (s) {
      var v = s.air && s.air.european_aqi;
      return { icon: 'eco', value: orDash(v, withUnit('')), label: t('euro_aqi'), color: v == null ? null : aqiColor(v) };
    } },
    us_aqi: { cat: 'air', render: function (s) { return { icon: 'flag', value: orDash(s.air && s.air.us_aqi, withUnit('')), label: t('us_aqi') }; } },
    pm2_5: { cat: 'air', render: function (s) { return { icon: 'masks', value: orDash(s.air && s.air.pm2_5, withUnit(t('u_ug'), 1)), label: t('pm2_5') }; } },
    pm10: { cat: 'air', render: function (s) { return { icon: 'blur_on', value: orDash(s.air && s.air.pm10, withUnit(t('u_ug'), 1)), label: t('pm10') }; } },
    uv: { cat: 'air', render: function (s) { return { icon: 'wb_sunny', value: orDash(s.air && s.air.uv_index, withUnit('', 1)), label: t('uv') }; } },
    ozone: { cat: 'air', render: function (s) { return { icon: 'layers', value: orDash(s.air && s.air.ozone, withUnit(t('u_ug'))), label: t('ozone') }; } },
    no2: { cat: 'air', render: function (s) { return { icon: 'factory', value: orDash(s.air && s.air.nitrogen_dioxide, withUnit(t('u_ug'))), label: t('no2') }; } },
    so2: { cat: 'air', render: function (s) { return { icon: 'whatshot', value: orDash(s.air && s.air.sulphur_dioxide, withUnit(t('u_ug'))), label: t('so2') }; } },
    co: { cat: 'air', render: function (s) { return { icon: 'directions_car', value: orDash(s.air && s.air.carbon_monoxide, withUnit(t('u_ug'))), label: t('co') }; } },
    dust: { cat: 'air', render: function (s) { return { icon: 'filter_drama', value: orDash(s.air && s.air.dust, withUnit(t('u_ug'))), label: t('dust') }; } },

    moon_phase: { cat: 'astro', render: function () { var m = moonPhase(new Date()); return { emoji: m.emoji, value: t(m.key), label: t('moon_phase') }; } },
    illumination: { cat: 'astro', render: function () { return { icon: 'brightness_3', value: moonPhase(new Date()).illum + '%', label: t('illumination') }; } },
    sunrise: { cat: 'astro', render: function (s) { return { icon: 'brightness_5', value: timeOf(s.data.daily.sunrise && s.data.daily.sunrise[0]), label: t('sunrise') }; } },
    sunset: { cat: 'astro', render: function (s) { return { icon: 'nights_stay', value: timeOf(s.data.daily.sunset && s.data.daily.sunset[0]), label: t('sunset') }; } },

    filler_transparent: { cat: 'filler', isFiller: true, render: function () { return null; } },
    filler_opaque: { cat: 'filler', isFiller: true, render: function () { return null; } }
  };

  function loadProfiles() {
    var raw = load('tileProfiles');
    try {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    } catch (e) {}
    return [];
  }
  function saveProfiles(profiles) {
    store('tileProfiles', JSON.stringify(profiles));
  }
  function getActiveProfile() {
    var name = load('activeProfile') || 'Default';
    if (name === 'Default') return { name: 'Default', layout: DEFAULT_LAYOUT, readOnly: true };
    var profiles = loadProfiles();
    var p = profiles.filter(function (x) { return x.name === name; })[0];
    if (p) return { name: p.name, layout: p.layout, readOnly: false };
    return { name: 'Default', layout: DEFAULT_LAYOUT, readOnly: true };
  }
  function setActiveProfileName(name) { store('activeProfile', name); }
  function createProfile(name, layout) {
    var profiles = loadProfiles();
    var finalName = name, n = 1;
    while (finalName === 'Default' || profiles.some(function (p) { return p.name === finalName; })) {
      finalName = name + ' (' + (++n) + ')';
    }
    profiles.push({ name: finalName, layout: JSON.parse(JSON.stringify(layout)) });
    saveProfiles(profiles);
    return finalName;
  }
  function saveProfile(profile) {
    if (profile.readOnly) return;
    var profiles = loadProfiles();
    var idx = profiles.findIndex(function (p) { return p.name === profile.name; });
    if (idx >= 0) {
      profiles[idx].layout = profile.layout;
      saveProfiles(profiles);
    }
  }
  function deleteProfile(name) {
    var profiles = loadProfiles().filter(function (p) { return p.name !== name; });
    saveProfiles(profiles);
    if (getActiveProfile().name === name) setActiveProfileName('Default');
  }
  function renameProfile(oldName, newName) {
    if (oldName === 'Default' || !newName || newName === 'Default') return;
    var profiles = loadProfiles();
    var p = profiles.filter(function (x) { return x.name === oldName; })[0];
    if (!p) return;
    if (profiles.some(function (x) { return x.name === newName; })) return;
    p.name = newName;
    saveProfiles(profiles);
    if ((load('activeProfile') || '') === oldName) setActiveProfileName(newName);
  }

  function gridCols() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--grid-cols');
    var n = parseInt(v, 10);
    return n > 0 ? n : (window.innerWidth < 768 ? 2 : 4);
  }

  function buildSizeOptions(select, w, h, cols) {
    select.innerHTML = '';
    var maxW = Math.max(cols, w);
    var order = [];
    for (var hh = 1; hh <= 2; hh++) {
      for (var ww = 1; ww <= maxW; ww++) order.push([ww, hh]);
    }
    order.forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0] + 'x' + pair[1];
      o.textContent = pair[0] + '×' + pair[1];
      if (pair[0] === w && pair[1] === h) o.selected = true;
      select.appendChild(o);
    });
  }

  function makeTileBtn(icon, title, handler, extraClass) {
    var b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.innerHTML = '<span class="material-icons">' + icon + '</span>';
    if (extraClass) b.className = extraClass;
    b.addEventListener('click', function (e) { e.stopPropagation(); handler(); });
    return b;
  }

  function buildTileEl(item, def, s) {
    var tileEl = document.createElement('div');
    tileEl.className = 'tile';
    tileEl.dataset.uid = item.uid;
    tileEl.dataset.type = item.type;
    var cols = gridCols();
    var w = Math.min(item.w || 1, cols);
    var h = Math.min(item.h || 1, 2);
    tileEl.style.setProperty('--w', w);
    tileEl.style.setProperty('--h', h);

    if (def.isFiller) {
      tileEl.classList.add(item.type);
    } else {
      var info = def.render(s);
      if (info.color) {
        tileEl.classList.add('colored');
        tileEl.style.setProperty('--c', info.color);
      }
      if (info.emoji) tileEl.appendChild(el('span', 'emoji', info.emoji));
      else if (info.icon) tileEl.appendChild(el('span', 'material-icons', info.icon));
      tileEl.appendChild(el('span', 'tile-v', info.value));
      tileEl.appendChild(el('span', 'tile-l', info.label));
    }

    if (editMode) {
      var bar = el('div', 'tile-edit-toolbar');
      bar.appendChild(makeTileBtn('arrow_upward', t('move_up'), function () { moveTile(item.uid, -1); }));
      bar.appendChild(makeTileBtn('arrow_downward', t('move_down'), function () { moveTile(item.uid, 1); }));
      bar.appendChild(makeTileBtn('close', t('remove'), function () { removeTile(item.uid); }, 'danger'));
      tileEl.appendChild(bar);

      var sel = document.createElement('select');
      sel.className = 'tile-size-select';
      sel.title = t('size');
      buildSizeOptions(sel, item.w || 1, item.h || 1, cols);
      sel.addEventListener('change', function (e) {
        var parts = e.target.value.split('x');
        resizeTile(item.uid, parseInt(parts[0], 10), parseInt(parts[1], 10));
      });
      tileEl.appendChild(sel);

      tileEl.draggable = true;
      tileEl.addEventListener('dragstart', function (e) {
        draggedUid = item.uid;
        e.dataTransfer.setData('text/plain', item.uid);
        e.dataTransfer.effectAllowed = 'move';
        tileEl.classList.add('dragging');
      });
      tileEl.addEventListener('dragend', function () {
        draggedUid = null;
        tileEl.classList.remove('dragging');
      });
    }

    return tileEl;
  }

  function renderTiles() {
    var grid = $('tiles');
    if (!grid) return;
    grid.innerHTML = '';
    grid.classList.toggle('edit-mode', editMode);
    if (!state) return;
    var profile = getActiveProfile();
    profile.layout.forEach(function (item) {
      var def = TILE_DEFS[item.type];
      if (!def) return;
      grid.appendChild(buildTileEl(item, def, state));
    });
  }

  function getEditableProfile() {
    var p = getActiveProfile();
    if (p.readOnly) return null;
    return p;
  }
  function removeTile(uid) {
    var p = getEditableProfile();
    if (!p) return;
    p.layout = p.layout.filter(function (t) { return t.uid !== uid; });
    saveProfile(p);
    renderTiles();
  }
  function resizeTile(uid, w, h) {
    var p = getEditableProfile();
    if (!p) return;
    var t = p.layout.filter(function (x) { return x.uid === uid; })[0];
    if (!t) return;
    t.w = w; t.h = h;
    saveProfile(p);
    renderTiles();
  }
  function moveTile(uid, dir) {
    var p = getEditableProfile();
    if (!p) return;
    var idx = p.layout.findIndex(function (x) { return x.uid === uid; });
    if (idx < 0) return;
    var ni = idx + dir;
    if (ni < 0 || ni >= p.layout.length) return;
    var tmp = p.layout[idx];
    p.layout[idx] = p.layout[ni];
    p.layout[ni] = tmp;
    saveProfile(p);
    renderTiles();
  }
  function reorderTile(fromUid, toUid) {
    var p = getEditableProfile();
    if (!p) return;
    var fromIdx = p.layout.findIndex(function (x) { return x.uid === fromUid; });
    var toIdx = p.layout.findIndex(function (x) { return x.uid === toUid; });
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    var item = p.layout.splice(fromIdx, 1)[0];
    p.layout.splice(toIdx, 0, item);
    saveProfile(p);
    renderTiles();
  }
  function addTile(type) {
    var def = TILE_DEFS[type];
    if (!def) return;
    var p = getEditableProfile();
    if (!p) { showToast(t('default_readonly_hint')); return; }
    if (!def.isFiller && p.layout.some(function (x) { return x.type === type; })) return;
    var uid = def.isFiller
      ? 'filler_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      : type;
    p.layout.push({ uid: uid, type: type, w: 1, h: 1 });
    saveProfile(p);
    renderTiles();
  }

  function updateEditUI() {
    $('editToolbar').hidden = !editMode;
    var p = getActiveProfile();
    var isCustom = !p.readOnly;
    $('renameProfileBtn').hidden = !editMode || !isCustom;
    $('deleteProfileBtn').hidden = !editMode || !isCustom;
    $('editTilesBtn').querySelector('.material-icons').textContent = editMode ? 'check' : 'dashboard_customize';
    $('profileSelect').value = p.name;
  }
  function toggleEditMode() {
    if (!editMode) {
      var p = getActiveProfile();
      if (p.readOnly) {
        var name = createProfile(t('new_profile'), p.layout);
        setActiveProfileName(name);
        showToast(t('created_profile', { name: name }));
        renderProfileSelect();
      }
    }
    editMode = !editMode;
    renderTiles();
    updateEditUI();
  }
  function exitEditMode() {
    editMode = false;
    renderTiles();
    updateEditUI();
  }

  function renderProfileSelect() {
    var sel = $('profileSelect');
    if (!sel) return;
    sel.innerHTML = '';
    var defOpt = document.createElement('option');
    defOpt.value = 'Default';
    defOpt.textContent = t('profile_default');
    sel.appendChild(defOpt);
    loadProfiles().forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    var sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '─────';
    sel.appendChild(sep);
    var nw = document.createElement('option');
    nw.value = '__new__';
    nw.textContent = '＋ ' + t('new_profile');
    sel.appendChild(nw);
    sel.value = getActiveProfile().name;
  }

  function openAddTileModal() {
    var grid = $('addTileGrid');
    grid.innerHTML = '';
    var p = getActiveProfile();
    var current = {};
    p.layout.forEach(function (x) { current[x.type] = true; });
    var CATS = [
      { key: 'weather', label: t('category_weather') },
      { key: 'custom', label: t('category_custom') },
      { key: 'air', label: t('category_air') },
      { key: 'astro', label: t('category_astro') },
      { key: 'filler', label: t('category_fillers') }
    ];
    CATS.forEach(function (cat) {
      var items = Object.keys(TILE_DEFS).filter(function (k) { return TILE_DEFS[k].cat === cat.key; });
      if (!items.length) return;
      grid.appendChild(el('div', 'add-tile-section-title', cat.label));
      items.forEach(function (type) {
        var def = TILE_DEFS[type];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'add-tile-btn';
        var icon, label;
        if (def.isFiller) {
          icon = type === 'filler_transparent' ? 'check_box_outline_blank' : 'check_box';
          label = t(type);
        } else {
          var info = state ? def.render(state) : { icon: 'help_outline', label: type };
          icon = info.emoji ? null : (info.icon || 'help_outline');
          label = info.label || type;
        }
        var iconEl = document.createElement('span');
        iconEl.className = 'material-icons';
        iconEl.textContent = icon || 'circle';
        btn.appendChild(iconEl);
        btn.appendChild(document.createTextNode(label));
        if (!def.isFiller && current[type]) {
          btn.disabled = true;
        }
        btn.addEventListener('click', function () {
          addTile(type);
          closeAddTileModal();
          showToast(label);
        });
        grid.appendChild(btn);
      });
    });
    $('addTileModal').classList.add('open');
    $('addTileClose').focus();
  }
  function closeAddTileModal() {
    $('addTileModal').classList.remove('open');
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var fromCache = r.headers.get('X-From-Cache');
      return r.json().then(function (d) {
        if (fromCache && d && typeof d === 'object') d.__fromCache = true;
        return d;
      });
    });
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
  }
  function toError(err) {
    if (err && err.key) return err;
    return { key: (err instanceof TypeError || !navigator.onLine) ? 'err_offline' : 'err_server' };
  }
  function placeFrom(r) {
    return { lat: r.latitude, lon: r.longitude, label: r.name + (r.country ? ', ' + r.country : ''), raw: r };
  }
  function searchPlaces(query, count) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) +
      '&count=' + count + '&language=' + searchLang + '&format=json';
    return getJson(url).then(function (data) { return (data.results || []).map(placeFrom); });
  }
  function fetchWeather(lat, lon) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,' +
      'weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,' +
      'dew_point_2m,visibility' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&timezone=auto&forecast_days=5';
    return getJson(url);
  }
  function fetchAir(lat, lon) {
    var url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + lat + '&longitude=' + lon +
      '&current=european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,uv_index,dust&timezone=auto';
    return getJson(url).then(function (d) { return d.current || null; });
  }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fetchHistory(lat, lon) {
    var end = new Date(); end.setDate(end.getDate() - 1);
    var start = new Date(); start.setDate(start.getDate() - 30);
    var url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon +
      '&start_date=' + ymd(start) + '&end_date=' + ymd(end) +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto';
    return getJson(url).then(function (d) {
      var x = d.daily, days = [];
      if (!x || !x.time) return null;
      x.time.forEach(function (iso, i) {
        if (x.temperature_2m_max[i] != null && x.temperature_2m_min[i] != null) {
          days.push({ date: iso, max: x.temperature_2m_max[i], min: x.temperature_2m_min[i], code: x.weather_code[i] });
        }
      });
      return days.length ? days : null;
    });
  }
  function fetchAll(lat, lon) {
    var air = withTimeout(fetchAir(lat, lon), 8000).catch(function () { return null; });
    var hist = showHistory ? withTimeout(fetchHistory(lat, lon), 10000).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([fetchWeather(lat, lon), air, hist]).then(function (r) {
      return { data: r[0], air: r[1], history: r[2], stale: !!r[0].__fromCache };
    });
  }
  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject({ key: 'err_geo_unsupported' });
      navigator.geolocation.getCurrentPosition(resolve, function (e) {
        reject({ key: 'err_geo_' + (e.code || 0) });
      }, { timeout: 10000 });
    });
  }

  function placeLabel() {
    if (state.kind === 'coords') return t('coords_label', { lat: Number(state.coords.lat.toFixed(4)), lon: Number(state.coords.lon.toFixed(4)) });
    if (state.kind === 'geo') return t('your_location');
    return state.label;
  }
  function isDayAt(iso, daily) {
    var i = daily.time.indexOf(iso.slice(0, 10));
    if (i < 0 || !daily.sunrise || !daily.sunset || !daily.sunrise[i] || !daily.sunset[i]) return true;
    return iso >= daily.sunrise[i] && iso < daily.sunset[i];
  }
  function infoItem(label, value) {
    var d = el('div', 'info-item');
    d.appendChild(el('small', null, label));
    d.appendChild(el('span', null, value));
    return d;
  }

  function renderHourly() {
    var h = state.data.hourly, d = state.data.daily, card = $('hourlyCard'), box = $('hourly');
    card.hidden = !showHourly || !h || !h.time;
    box.innerHTML = '';
    if (card.hidden) return;
    var from = state.data.current.time ? state.data.current.time.slice(0, 13) + ':00' : h.time[0];
    var start = h.time.findIndex(function (x) { return x >= from; });
    if (start < 0) start = 0;
    for (var i = start; i < Math.min(start + 24, h.time.length); i++) {
      var w = describeWeather(h.weather_code[i], isDayAt(h.time[i], d) ? 1 : 0);
      var item = el('div', 'hour');
      item.title = t(w.k);
      var p = h.precipitation_probability && h.precipitation_probability[i];
      item.appendChild(el('div', 'hour-time', h.time[i].slice(11, 16)));
      item.appendChild(el('span', 'material-icons', w.i));
      item.appendChild(el('div', 'hour-t', orDash(h.temperature_2m[i], fmtTemp)));
      item.appendChild(el('div', 'hour-p', p > 0 ? p + '%' : ''));
      item.appendChild(el('div', 'hour-w', orDash(h.wind_speed_10m && h.wind_speed_10m[i], measure('wind'))));
      box.appendChild(item);
    }
  }
  function tempColor(v) { return v < 0 ? '#42A5F5' : v < 10 ? '#26A69A' : v < 20 ? '#FFA726' : '#EF5350'; }
  function fmtDateShort(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' }); }
  function renderHistory() {
    var days = state.history, card = $('histCard'), box = $('hist');
    card.hidden = !showHistory || !days || !days.length;
    box.innerHTML = '';
    if (card.hidden) return;
    var lo = Math.min.apply(null, days.map(function (x) { return x.min; }));
    var hi = Math.max.apply(null, days.map(function (x) { return x.max; }));
    var span = hi - lo || 1;
    days.forEach(function (x) {
      var col = el('div', 'hist-col');
      col.title = fmtDateShort(x.date) + ': ' + fmtTemp(x.min) + ' / ' + fmtTemp(x.max) + ', ' + t(describeWeather(x.code).k);
      var bar = el('div', 'hist-bar');
      bar.style.bottom = ((x.min - lo) / span * 100) + '%';
      bar.style.height = ((x.max - x.min) / span * 100) + '%';
      bar.style.background = tempColor(x.max);
      col.appendChild(bar);
      box.appendChild(col);
    });
    $('histFrom').textContent = fmtDateShort(days[0].date);
    $('histTo').textContent = fmtDateShort(days[days.length - 1].date);
    $('histSum').textContent = t('hist_min') + ' ' + fmtTempU(lo) + ' · ' + t('hist_max') + ' ' + fmtTempU(hi);
  }

  function render() {
    if (!state) return;
    var c = state.data.current, d = state.data.daily;
    var w = describeWeather(c.weather_code, c.is_day);
    $('place').textContent = placeLabel();
    $('nowIcon').textContent = w.i;
    $('nowTemp').textContent = fmtTempU(c.temperature_2m);
    $('nowDesc').textContent = t(w.k);
    $('nowFeels').textContent = t('feels') + ' ' + fmtTempU(c.apparent_temperature);

    var p = state.place, fc = state.data;
    var pg = $('placeGrid');
    pg.innerHTML = '';
    $('placeBtn').hidden = false;
    if (p) {
      var elev = typeof p.elevation === 'number' ? p.elevation : fc.elevation;
      if (p.country) pg.appendChild(infoItem(t('country'), p.country));
      if (p.admin1) pg.appendChild(infoItem(t('region'), p.admin1));
      if (p.admin2) pg.appendChild(infoItem(t('district'), p.admin2));
      if (typeof elev === 'number') pg.appendChild(infoItem(t('elevation'), num(round(elev)) + ' ' + t('u_m')));
      if (p.population) pg.appendChild(infoItem(t('population'), num(p.population)));
      if (p.timezone || fc.timezone) pg.appendChild(infoItem(t('timezone'), p.timezone || fc.timezone));
    } else {
      pg.appendChild(infoItem(t('coordinates'), Number(state.lat).toFixed(4) + ', ' + Number(state.lon).toFixed(4)));
      pg.appendChild(infoItem(t('country'), t('not_available')));
      pg.appendChild(infoItem(t('region'), t('not_available')));
      if (typeof fc.elevation === 'number') pg.appendChild(infoItem(t('elevation'), num(round(fc.elevation)) + ' ' + t('u_m')));
      if (fc.timezone) pg.appendChild(infoItem(t('timezone'), fc.timezone));
    }

    var box = $('forecast');
    box.innerHTML = '';
    d.time.forEach(function (iso, idx) {
      var date = new Date(iso + 'T00:00:00');
      var dw = describeWeather(d.weather_code[idx]);
      var row = el('div', 'day');
      var n = el('div', 'day-name');
      n.textContent = idx === 0 ? t('today') : date.toLocaleDateString(LOCALES[lang], { weekday: 'long' });
      n.appendChild(el('small', null, date.toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'long' })));
      var ic = el('div', 'day-icon material-icons', dw.i);
      var ds = el('div', 'day-desc', t(dw.k));
      var tm = el('div', 'day-temp', fmtTemp(d.temperature_2m_max[idx]) + ' / ' + fmtTemp(d.temperature_2m_min[idx]));
      row.appendChild(n); row.appendChild(ic); row.appendChild(ds); row.appendChild(tm);
      box.appendChild(row);
    });

    $('staleBadge').hidden = !state.stale;
    if (state.ts) $('staleBadge').title = new Date(state.ts).toLocaleString(LOCALES[lang]);
    var upd = $('updated');
    upd.hidden = !state.ts;
    if (state.ts) {
      var updTime = new Date(state.ts).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit' });
      upd.textContent = t('updated') + ': ' + updTime + (state.stale ? ' ' + t('cached') : '');
    }

    renderTiles();
    renderHourly();
    renderHistory();

    var res = $('results');
    res.classList.add('show');
    requestAnimationFrame(function () { requestAnimationFrame(function () { res.classList.add('visible'); }); });
  }

  function run(task, opts) {
    var silent = opts && opts.silent;
    var id = ++requestId;
    if (!silent) setLoading(true);
    task().then(function (res) {
      if (id !== requestId) return;
      if (!silent) setLoading(false);
      state = res;
      if (res.persist) res.persist();
      if (!res.stale) store('lastWeatherData', JSON.stringify(res));
      render();
    }).catch(function (err) {
      if (id !== requestId) return;
      if (silent) { if (state) state.stale = true; render(); return; }
      setLoading(false);
      var e = toError(err);
      showError(e.key, e.params);
    });
  }

  function placeTask(place) {
    return fetchAll(place.lat, place.lon).then(function (r) {
      return {
        kind: 'city', label: place.label, place: place.raw, lat: place.lat, lon: place.lon,
        data: r.data, air: r.air, history: r.history, stale: r.stale, ts: r.stale ? dataTs(r.data) : Date.now(),
        persist: function () {
          store('lastPlace', JSON.stringify(place));
          store('lastCity', (place.raw && place.raw.name) || place.label);
          store('lastSearchType', 'place');
        }
      };
    });
  }
  function loadPlace(place) { run(function () { return placeTask(place); }); }
  function searchCity(city) {
    city = city.trim();
    if (!city) { showError('err_empty'); return; }
    run(function () {
      return searchPlaces(city, 1).then(function (list) {
        if (!list.length) throw { key: 'err_notfound', params: { city: city } };
        return placeTask(list[0]);
      });
    });
  }
  function loadCoords(kind, getCoords) {
    run(function () {
      return getCoords().then(function (c) {
        return fetchAll(c.latitude, c.longitude).then(function (r) {
          return {
            kind: kind, label: null, coords: { lat: c.latitude, lon: c.longitude }, place: null, lat: c.latitude, lon: c.longitude,
            data: r.data, air: r.air, history: r.history, stale: r.stale, ts: r.stale ? dataTs(r.data) : Date.now(),
            persist: function () {
              store('lastLocation', JSON.stringify({ lat: c.latitude, lon: c.longitude }));
              store('lastSearchType', kind);
            }
          };
        });
      });
    });
  }
  function searchByLocation() {
    loadCoords('geo', function () { return getPosition().then(function (p) { return p.coords; }); });
  }
  function parseNum(s) {
    s = s.trim().replace(',', '.');
    return s !== '' && isFinite(s) ? Number(s) : NaN;
  }
  function searchByInputCoords() {
    var lat = parseNum($('lat').value), lon = parseNum($('lon').value);
    if (isNaN(lat) || isNaN(lon)) return showError('err_coords_invalid');
    if (lat < -90 || lat > 90) return showError('err_lat_range');
    if (lon < -180 || lon > 180) return showError('err_lon_range');
    loadCoords('coords', function () { return Promise.resolve({ latitude: lat, longitude: lon }); });
  }
  function submit() {
    cancelSuggest();
    if (mode === 'coords') searchByInputCoords(); else searchCity($('city').value);
  }

  var refreshTimer = null;
  function setupAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    var mins = parseInt(load('refreshInterval') || '30', 10);
    if (!mins || mins <= 0) return;
    refreshTimer = setInterval(function () {
      if (!state || document.hidden) return;
      refresh();
    }, mins * 60000);
  }
  function refresh() {
    var s = state;
    if (!s) return;
    run(function () {
      return fetchAll(s.lat, s.lon).then(function (r) {
        return Object.assign({}, s, { data: r.data, air: r.air, history: r.history || s.history, stale: r.stale, ts: r.stale ? dataTs(r.data) : Date.now() });
      });
    }, { silent: true });
  }

  function labelRefreshSelect() {
    var sel = $('refreshSelect');
    if (!sel) return;
    Array.from(sel.options).forEach(function (o) {
      var v = parseInt(o.value, 10);
      o.textContent = v === 0 ? t('refresh_off') : t('refresh_min', { n: v });
    });
  }

  var suggestTimer = null, suggestions = [], activeIdx = -1;
  function hideSuggest() {
    suggestions = []; activeIdx = -1;
    $('suggest').hidden = true;
    $('suggest').innerHTML = '';
    $('city').setAttribute('aria-expanded', 'false');
  }
  function cancelSuggest() { clearTimeout(suggestTimer); suggestId++; hideSuggest(); }
  function renderSuggest(list) {
    suggestions = list; activeIdx = -1;
    var ul = $('suggest');
    ul.innerHTML = '';
    if (!list.length) { hideSuggest(); return; }
    list.forEach(function (p, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = i;
      li.appendChild(el('span', 'material-icons', 'location_on'));
      var box = document.createElement('div');
      box.appendChild(el('div', null, p.raw.name));
      box.appendChild(el('small', null, [p.raw.admin1, p.raw.country].filter(Boolean).join(', ')));
      li.appendChild(box);
      ul.appendChild(li);
    });
    ul.hidden = false;
    $('city').setAttribute('aria-expanded', 'true');
  }
  function setActive(i) {
    var items = $('suggest').children;
    if (activeIdx >= 0 && items[activeIdx]) items[activeIdx].classList.remove('active');
    activeIdx = i;
    if (i >= 0 && items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
  }
  function chooseSuggestion(i) {
    var p = suggestions[i];
    if (!p) return;
    cancelSuggest();
    $('city').value = p.raw.name;
    loadPlace(p);
  }

  function switchModePanel(box, show) {
    box.hidden = !show;
  }
  function setMode(m) {
    mode = m;
    cancelSuggest();
    switchModePanel($('nameBox'), m === 'name');
    switchModePanel($('coordsBox'), m === 'coords');
    document.querySelectorAll('.tab').forEach(function (tab) {
      var on = tab.dataset.mode === m;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on);
    });
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $('langSelect').value = lang;
    $('welcomeLang').value = lang;
    labelUnitSelects();
    labelRefreshSelect();
    labelSwatches();
    renderProfileSelect();
    updateEditUI();
    if (errState) showError(errState.key, errState.params);
    render();
  }

  var themeManual = false;
  function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function isThemeManual() { var s = load('theme'); return themeManual || s === 'dark' || s === 'light'; }
  function applyTheme(dark) {
    document.body.classList.toggle('dark-theme', dark);
    document.documentElement.classList.toggle('dark-theme', dark);
    $('darkSwitch').checked = dark;
    $('welcomeDark').checked = dark;
    applyAccent();
    renderTiles();
  }
  function setTheme(dark) { themeManual = true; applyTheme(dark); store('theme', dark ? 'dark' : 'light'); }

  var ACCENTS = [
    { id: 'blue', c: '#1976D2', d: '#64B5F6' }, { id: 'green', c: '#388E3C', d: '#81C784' },
    { id: 'purple', c: '#7B1FA2', d: '#BA68C8' }, { id: 'orange', c: '#F57C00', d: '#FFB74D' },
    { id: 'red', c: '#D32F2F', d: '#E57373' }, { id: 'teal', c: '#00796B', d: '#4DB6AC' }
  ];
  var accent = (function () {
    var s = load('accentColor');
    return ACCENTS.some(function (a) { return a.c === s; }) ? s : ACCENTS[0].c;
  })();
  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function applyAccent() {
    var a = ACCENTS.filter(function (x) { return x.c === accent; })[0] || ACCENTS[0];
    var dark = document.body.classList.contains('dark-theme');
    var shown = dark ? a.d : a.c, s = document.body.style;
    s.setProperty('--primary', a.c);
    s.setProperty('--primary-dark', 'rgb(' + hexRgb(a.c).map(function (x) { return Math.round(x * 0.88); }).join(',') + ')');
    s.setProperty('--accent', shown);
    s.setProperty('--hover', 'rgba(' + hexRgb(shown).join(',') + ',' + (dark ? 0.12 : 0.08) + ')');
    s.setProperty('--track-on', 'rgba(' + hexRgb(a.c).join(',') + ',.5)');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', a.c);
    document.querySelectorAll('.swatch').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.color === a.c); });
  }
  function setAccent(c) { accent = c; store('accentColor', c); applyAccent(); }
  function buildSwatches() {
    var box = $('swatches');
    ACCENTS.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.dataset.color = a.c; b.dataset.id = a.id;
      b.setAttribute('role', 'radio');
      b.style.setProperty('--sw', a.c);
      b.appendChild(el('span', 'material-icons', 'check'));
      b.addEventListener('click', function () { setAccent(a.c); });
      box.appendChild(b);
    });
  }
  function labelSwatches() {
    document.querySelectorAll('.swatch').forEach(function (b) {
      b.title = t('c_' + b.dataset.id);
      b.setAttribute('aria-label', t('c_' + b.dataset.id));
    });
  }

  var unitSelects = [];
  function buildUnitSelects() {
    ['unitRows', 'welcomeUnitRows'].forEach(function (boxId) {
      UNIT_KINDS.forEach(function (kind) {
        var row = el('div', 'row'), lab = document.createElement('label'), sel = document.createElement('select');
        sel.id = boxId + '-' + kind;
        lab.htmlFor = sel.id;
        Object.keys(UNIT_DEFS[kind].opts).forEach(function (k) {
          var o = document.createElement('option'); o.value = k; sel.appendChild(o);
        });
        sel.addEventListener('change', function () { setUnit(kind, sel.value); });
        row.appendChild(lab); row.appendChild(sel);
        $(boxId).appendChild(row);
        unitSelects.push({ kind: kind, sel: sel, lab: lab });
      });
    });
  }
  function labelUnitSelects() {
    unitSelects.forEach(function (u) {
      u.lab.textContent = t('unit_' + u.kind);
      Array.prototype.forEach.call(u.sel.options, function (o) { o.textContent = unitOptionLabel(u.kind, o.value); });
      u.sel.value = units[u.kind];
    });
  }
  function setUnit(kind, v) { units[kind] = v; store(UNIT_DEFS[kind].key, v); labelUnitSelects(); render(); }

  var STORAGE_KEYS = [
    'lang', 'theme', 'searchLang', 'unitTemp', 'unitWind', 'unitPressure', 'unitPrecip',
    'onboarded', 'lastCity', 'lastPlace', 'lastLocation', 'lastWeatherData', 'lastSearchType',
    'accentColor', 'showHourly', 'showHistory', 'refreshInterval', 'tileProfiles', 'activeProfile'
  ];
  function storageRead(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storedObject(raw) {
    if (raw === null) return null;
    try {
      var value = JSON.parse(raw);
      return value !== null && typeof value === 'object' ? value : null;
    } catch (e) { return null; }
  }
  function storageButton(label, onClick) {
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-outlined storage-btn';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
  function renderStorageRows(message) {
    var root = $('storageRows');
    if (!root) return;
    root.innerHTML = '';
    var status = $('storageStatus');
    if (status) status.textContent = message || '';
    var keys = STORAGE_KEYS.slice();
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var extra = localStorage.key(i);
        if (extra && keys.indexOf(extra) < 0) keys.push(extra);
      }
    } catch (e) {}
    var extras = keys.slice(STORAGE_KEYS.length).sort();
    keys = STORAGE_KEYS.concat(extras);
    keys.forEach(function (key) {
      var raw = storageRead(key);
      var obj = storedObject(raw);
      var row = el('div', 'storage-admin-row');
      var field = el('div', 'storage-field');
      var label = el('label', 'storage-key', key);
      label.htmlFor = 'storage-key-' + root.children.length;
      field.appendChild(label);
      if (obj !== null) {
        field.appendChild(el('span', 'storage-json-note', t('stored_json')));
        var actions = el('div', 'storage-actions');
        actions.appendChild(storageButton(t('view_json'), function () { openJsonViewer(key, obj); }));
        actions.appendChild(storageButton(t('clear'), function () { deleteStorageKey(key); }));
        row.appendChild(field); row.appendChild(actions);
      } else {
        var input = document.createElement('input');
        input.type = 'text'; input.className = 'storage-input'; input.id = label.htmlFor;
        input.autocomplete = 'off'; input.spellcheck = false;
        input.value = raw === null ? '' : raw;
        input.setAttribute('aria-label', key);
        field.appendChild(input);
        var actions2 = el('div', 'storage-actions');
        actions2.appendChild(storageButton(t('save'), function () { saveStorageKey(key, input.value); }));
        actions2.appendChild(storageButton(t('delete'), function () { deleteStorageKey(key); }));
        row.appendChild(field); row.appendChild(actions2);
      }
      root.appendChild(row);
    });
  }
  function openJsonViewer(key, value) {
    $('jsonTitle').textContent = t('json_title') + ': ' + key;
    try { $('jsonContent').textContent = JSON.stringify(value, null, 2); }
    catch (e) { $('jsonContent').textContent = String(value); }
    $('modal').inert = true;
    $('jsonModal').classList.add('open');
    $('jsonClose').focus();
  }
  function closeJsonViewer() {
    $('jsonModal').classList.remove('open');
    $('modal').inert = false;
    var summary = $('advancedDetails').querySelector('summary');
    if (summary) summary.focus();
  }
  function applyStorageChange(key, raw, removed) {
    if (key === 'lang') { lang = !removed && (raw === 'ru' || raw === 'en') ? raw : detectLang(); applyLang(); return; }
    if (key === 'theme') { themeManual = !removed && (raw === 'dark' || raw === 'light'); applyTheme(themeManual ? raw === 'dark' : systemDark()); return; }
    if (key === 'searchLang') { searchLang = !removed && SEARCH_LANGS.indexOf(raw) >= 0 ? raw : detectLang(); $('searchLangSelect').value = searchLang; cancelSuggest(); return; }
    var unitKind = UNIT_KINDS.filter(function (kind) { return UNIT_DEFS[kind].key === key; })[0];
    if (unitKind) {
      var def = UNIT_DEFS[unitKind];
      units[unitKind] = !removed && Object.prototype.hasOwnProperty.call(def.opts, raw) ? raw : def.def;
      labelUnitSelects(); render(); return;
    }
    if (key === 'accentColor') { accent = !removed && ACCENTS.some(function (a) { return a.c === raw; }) ? raw : ACCENTS[0].c; applyAccent(); return; }
    if (key === 'showHourly') { showHourly = removed || raw !== '0'; $('hourlySwitch').checked = showHourly; render(); return; }
    if (key === 'showHistory') { showHistory = !removed && raw === '1'; $('historySwitch').checked = showHistory; if (showHistory) ensureHistory(); render(); return; }
    if (key === 'lastCity') $('city').value = removed ? '' : raw;
    if (key === 'refreshInterval') { $('refreshSelect').value = removed ? '30' : raw; setupAutoRefresh(); return; }
    if (key === 'tileProfiles' || key === 'activeProfile') { renderProfileSelect(); renderTiles(); return; }
  }
  function saveStorageKey(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) { renderStorageRows(t('storage_error')); return; }
    applyStorageChange(key, value, false);
    renderStorageRows(t('storage_saved'));
  }
  function deleteStorageKey(key) {
    try { localStorage.removeItem(key); }
    catch (e) { renderStorageRows(t('storage_error')); return; }
    applyStorageChange(key, null, true);
    renderStorageRows(t('storage_deleted'));
  }

  function openWelcome() {
    $('welcome').hidden = false;
    document.querySelector('.container').inert = true;
    $('modal').inert = true;
    document.body.style.overflow = 'hidden';
    $('startBtn').focus();
  }
  function closeWelcome() {
    store('lang', lang);
    UNIT_KINDS.forEach(function (kind) { store(UNIT_DEFS[kind].key, units[kind]); });
    if (themeManual) store('theme', $('welcomeDark').checked ? 'dark' : 'light');
    store('onboarded', '1');
    document.querySelector('.container').inert = false;
    $('modal').inert = false;
    $('jsonModal').inert = false;
    document.body.style.overflow = '';
    document.body.classList.add('reloading');
    setTimeout(function () { window.location.reload(); }, 300);
  }

  document.querySelectorAll('.btn, .icon-btn, .tab').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(span);
      span.addEventListener('animationend', function () { span.remove(); });
    });
  });

  $('search').addEventListener('click', submit);
  $('locate').addEventListener('click', function () { cancelSuggest(); searchByLocation(); });
  $('placeBtn').addEventListener('click', function () {
    setExpanded($('placeBtn'), $('placeInfo'), $('placeBtn').getAttribute('aria-expanded') !== 'true');
  });
  $('city').addEventListener('input', function () {
    clearTimeout(suggestTimer);
    var q = $('city').value.trim();
    if (q.length < 2) { suggestId++; hideSuggest(); return; }
    suggestTimer = setTimeout(function () {
      var id = ++suggestId;
      searchPlaces(q, 10).then(function (list) { if (id === suggestId) renderSuggest(list); })
        .catch(function () { if (id === suggestId) hideSuggest(); });
    }, 300);
  });
  $('suggest').addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (li) chooseSuggestion(Number(li.dataset.index));
  });
  document.addEventListener('click', function (e) { if (!$('nameBox').contains(e.target)) hideSuggest(); });
  $('city').addEventListener('keydown', function (e) {
    var n = suggestions.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive((activeIdx + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive((activeIdx - 1 + n) % n); }
    else if (e.key === 'Escape') hideSuggest();
    else if (e.key === 'Enter') { if (activeIdx >= 0) chooseSuggestion(activeIdx); else submit(); }
  });
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setMode(tab.dataset.mode); });
  });
  ['lat', 'lon'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  });

  var modal = $('modal');
  var jsonModal = $('jsonModal');
  var addTileModal = $('addTileModal');
  function openModal() { modal.classList.add('open'); $('closeBtn').focus(); }
  function closeModal() { modal.classList.remove('open'); $('settingsBtn').focus(); }
  $('jsonClose').addEventListener('click', closeJsonViewer);
  jsonModal.addEventListener('click', function (e) { if (e.target === jsonModal) closeJsonViewer(); });
  $('addTileClose').addEventListener('click', closeAddTileModal);
  addTileModal.addEventListener('click', function (e) { if (e.target === addTileModal) closeAddTileModal(); });
  $('settingsBtn').addEventListener('click', openModal);
  $('closeBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (addTileModal.classList.contains('open')) closeAddTileModal();
    else if (jsonModal.classList.contains('open')) closeJsonViewer();
    else if (modal.classList.contains('open')) closeModal();
    else if (editMode) exitEditMode();
  });
  $('advancedDetails').addEventListener('toggle', function () {
    if ($('advancedDetails').open) renderStorageRows();
  });

  $('darkSwitch').addEventListener('change', function (e) { setTheme(e.target.checked); });
  function setLang(v) { lang = v === 'ru' ? 'ru' : 'en'; store('lang', lang); applyLang(); renderStorageRows(); }
  $('langSelect').addEventListener('change', function (e) { setLang(e.target.value); });
  $('welcomeLang').addEventListener('change', function (e) { setLang(e.target.value); });
  $('welcomeDark').addEventListener('change', function (e) { setTheme(e.target.checked); });
  $('startBtn').addEventListener('click', closeWelcome);
  $('searchLangSelect').addEventListener('change', function (e) { searchLang = e.target.value; store('searchLang', searchLang); cancelSuggest(); });
  $('hourlySwitch').addEventListener('change', function (e) { showHourly = e.target.checked; store('showHourly', showHourly ? '1' : '0'); render(); });
  $('historySwitch').addEventListener('change', function (e) {
    showHistory = e.target.checked;
    store('showHistory', showHistory ? '1' : '0');
    ensureHistory();
    render();
  });
  $('refreshSelect').addEventListener('change', function (e) {
    store('refreshInterval', e.target.value);
    setupAutoRefresh();
  });

  $('editTilesBtn').addEventListener('click', toggleEditMode);
  $('doneEditBtn').addEventListener('click', exitEditMode);
  $('addTileBtn').addEventListener('click', openAddTileModal);
  $('profileSelect').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v === '__new__') {
      var name = prompt(t('new_profile_prompt'), t('new_profile'));
      if (!name || !name.trim()) { renderProfileSelect(); return; }
      var finalName = createProfile(name.trim(), getActiveProfile().layout);
      setActiveProfileName(finalName);
      editMode = false;
      renderProfileSelect();
      renderTiles();
      updateEditUI();
      showToast(t('created_profile', { name: finalName }));
      return;
    }
    setActiveProfileName(v);
    editMode = false;
    renderProfileSelect();
    renderTiles();
    updateEditUI();
  });
  $('renameProfileBtn').addEventListener('click', function () {
    var p = getActiveProfile();
    if (p.readOnly) return;
    var name = prompt(t('rename_profile_prompt'), p.name);
    if (!name || !name.trim() || name === p.name) return;
    renameProfile(p.name, name.trim());
    renderProfileSelect();
    renderTiles();
    updateEditUI();
  });
  $('deleteProfileBtn').addEventListener('click', function () {
    var p = getActiveProfile();
    if (p.readOnly) return;
    if (!confirm(t('delete_profile_confirm', { name: p.name }))) return;
    deleteProfile(p.name);
    editMode = false;
    renderProfileSelect();
    renderTiles();
    updateEditUI();
  });
  $('tiles').addEventListener('dragover', function (e) {
    if (!editMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  $('tiles').addEventListener('drop', function (e) {
    if (!editMode) return;
    e.preventDefault();
    var fromUid = draggedUid || e.dataTransfer.getData('text/plain');
    var target = e.target.closest ? e.target.closest('.tile') : null;
    if (!target || !fromUid) return;
    reorderTile(fromUid, target.dataset.uid);
  });

  $('refreshBtn').addEventListener('click', function () {
    if (!state) return;
    var btn = $('refreshBtn');
    if (btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');
    var s = state;
    fetchAll(s.lat, s.lon).then(function (r) {
      Object.assign(s, { data: r.data, air: r.air, history: r.history || s.history, stale: r.stale, ts: r.stale ? dataTs(r.data) : Date.now() });
      if (!r.stale) store('lastWeatherData', JSON.stringify(s));
      render();
    }).catch(function () {
      showToast(t('err_server'));
    }).finally(function () {
      btn.classList.remove('spinning');
    });
  });

  var lastMinuteKey = '';
  setInterval(function () {
    if (!state) return;
    var now = new Date();
    var key = now.getUTCFullYear() + '-' + now.getUTCMonth() + '-' + now.getUTCDate() + '-' + now.getUTCHours() + '-' + now.getUTCMinutes();
    if (key === lastMinuteKey) return;
    lastMinuteKey = key;
    document.querySelectorAll('.tile[data-type="time"] .tile-v').forEach(function (node) {
      node.textContent = cityTimeText(state);
    });
  }, 5000);

  window.addEventListener('resize', debounce(renderTiles, 150));

  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !state || !state.ts) return;
    var mins = parseInt(load('refreshInterval') || '30', 10);
    if (!mins) return;
    if (Date.now() - state.ts > mins * 60000) refresh();
  });

  function ensureHistory() {
    var s = state;
    if (!showHistory || !s || s.history || s.lat == null) return;
    withTimeout(fetchHistory(s.lat, s.lon), 10000).then(function (h) {
      if (state !== s) return;
      s.history = h;
      store('lastWeatherData', JSON.stringify(s));
      render();
    }).catch(function () {});
  }

  buildUnitSelects();
  buildSwatches();
  applyTheme(isThemeManual() ? load('theme') === 'dark' : systemDark());
  (function () {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) { if (!isThemeManual()) applyTheme(e.matches); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  })();

  $('hourlySwitch').checked = showHourly;
  $('historySwitch').checked = showHistory;
  $('searchLangSelect').value = searchLang;
  $('refreshSelect').value = load('refreshInterval') || '30';
  labelRefreshSelect();
  applyLang();
  renderStorageRows();
  renderProfileSelect();
  updateEditUI();
  setupAutoRefresh();

  if (!load('onboarded')) openWelcome();

  var savedCity = load('lastCity');
  var type = load('lastSearchType');
  var savedPlace = loadJson('lastPlace');
  var loc = loadJson('lastLocation');
  var cached = loadJson('lastWeatherData');
  if (savedCity) $('city').value = savedCity;
  if (type === 'coords' && loc && isFinite(loc.lat) && isFinite(loc.lon)) { $('lat').value = loc.lat; $('lon').value = loc.lon; setMode('coords'); }
  if (cached && cached.data && cached.data.current && cached.data.daily && cached.lat != null) {
    state = cached;
    render();
    ensureHistory();
    refresh();
  } else if (type === 'place' && savedPlace && isFinite(savedPlace.lat) && isFinite(savedPlace.lon)) {
    loadPlace(savedPlace);
  } else if ((type === 'geo' || type === 'coords') && loc && isFinite(loc.lat) && isFinite(loc.lon)) {
    loadCoords(type, function () { return Promise.resolve({ latitude: loc.lat, longitude: loc.lon }); });
  } else if (savedCity) {
    searchCity(savedCity);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  }
})();