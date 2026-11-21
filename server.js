#!/usr/bin/env node
// SirenSong live server. No dependencies. Needs Node.js 18 or newer.
//   node server.js            then open http://localhost:8080
//   PORT=3000 node server.js  to use another port
//   node server.js --debug    to print the first record of each upstream reply
//
// It serves the page and one endpoint, /api/ships?region=<key>, which fetches live AIS
// positions from Fintraffic's open Digitraffic service and trims them to the chart.
// Ship data: Source Fintraffic / Digitraffic, licence CC 4.0 BY.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');

const PORT = +process.env.PORT || 8080;
const BASE = (process.env.AIS_BASE || 'https://meri.digitraffic.fi/api/ais/v1').replace(/\/$/, '');
const DEBUG = process.argv.includes('--debug');
// Live underwater audio: Orcasound's public hydrophone streams in the Salish Sea (open data on AWS)
const HYDRO = (process.env.HYDRO_BASE || 'https://s3-us-west-2.amazonaws.com/streaming-orcasound-net').replace(/\/$/, '');
const HYDRO_NODES = { rpi_orcasound_lab: 'Orcasound Lab, Haro Strait', rpi_port_townsend: 'Port Townsend', rpi_bush_point: 'Bush Point, Whidbey Island', rpi_sunset_bay: 'Sunset Bay', rpi_north_sjc: 'North San Juan Channel' };
const HEADERS = { 'Digitraffic-User': 'SirenSong/hackathon-demo', 'Accept-Encoding': 'gzip', 'Accept': 'application/json' };
const REGIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'regions.json'), 'utf8'));
const MAX_AGE_MS = 20 * 60 * 1000, CACHE_MS = 10 * 1000, META_EVERY_MS = 6 * 3600 * 1000;

if (typeof fetch !== 'function') { console.error('This needs Node.js 18 or newer (your version: ' + process.version + ').'); process.exit(1); }

async function getJson(url) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!r.ok) throw new Error('upstream answered HTTP ' + r.status + ' for ' + url.replace(BASE, ''));
    return await r.json();
  } finally { clearTimeout(to); }
}
const num = v => (typeof v === 'number' && isFinite(v) ? v : undefined);

// ---- vessel names and types (changes rarely, so fetched once and refreshed every few hours) ----
const meta = new Map(); let metaAt = 0, metaBusy = null, metaError = null;
function readMeta(v) {
  const m = v && (v.properties || v); if (!m) return;
  const mmsi = num(v.mmsi) ?? num(m.mmsi); if (!mmsi) return;
  const a = num(m.referencePointA) ?? num(m.refA) ?? 0, b = num(m.referencePointB) ?? num(m.refB) ?? 0;
  meta.set(mmsi, { name: String(m.name || '').trim(), type: num(m.shipType) ?? num(m.type) ?? 0, len: a + b });
}
function loadMeta() {
  if (metaBusy) return metaBusy;
  metaBusy = getJson(BASE + '/vessels').then(body => {
    const list = Array.isArray(body) ? body : body.features || body.vessels || [];
    if (DEBUG && list[0]) console.log('[debug] first vessel record:', JSON.stringify(list[0]));
    for (const v of list) readMeta(v);
    metaAt = Date.now(); metaError = null; console.log(`Vessel names loaded: ${meta.size}`);
  }).catch(e => { metaError = e.message; console.warn('Could not load vessel names (' + e.message + '). Ships will show by MMSI number.'); }).finally(() => { metaBusy = null; });
  return metaBusy;
}

// ---- positions ----
function readLocation(f) {
  const p = f && (f.properties || f); if (!p) return null;
  const c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [num(p.lon) ?? num(p.longitude), num(p.lat) ?? num(p.latitude)];
  const mmsi = num(f.mmsi) ?? num(p.mmsi), lon = num(c[0]), lat = num(c[1]); if (!mmsi || lon === undefined || lat === undefined) return null;
  let sog = num(p.sog) ?? 0; if (sog >= 102.2) sog = 0;               // 102.3 means "not available" in AIS
  let cog = num(p.cog); if (cog === undefined || cog >= 360) cog = num(p.heading); if (cog === undefined || cog >= 360) cog = 0; // 360 and 511 mean "not available"
  const ts = num(p.timestampExternal) ?? (num(p.time) !== undefined ? p.time * 1000 : undefined);
  return { mmsi, lon, lat, sog, cog, ts };
}
const cache = new Map();
async function shipsFor(key) {
  const R = REGIONS[key]; if (!R) { const e = new Error('unknown region "' + key + '"'); e.status = 400; throw e; }
  const hit = cache.get(key), now = Date.now();
  if (hit && now - hit.at < CACHE_MS) return hit.body;
  if (now - metaAt > META_EVERY_MS) { if (!meta.size) await loadMeta(); else loadMeta(); }
  let body;
  try {
    // ask only for the chart's surroundings; if the service does not accept the filter, ask for everything
    body = await getJson(`${BASE}/locations?latitude=${R.clat}&longitude=${R.clon}&radius=${R.radiusKm}&from=${now - MAX_AGE_MS}`);
  } catch (e) {
    if (DEBUG) console.log('[debug] filtered request failed (' + e.message + '), trying the unfiltered one');
    try { body = await getJson(BASE + '/locations'); }
    catch (e2) { if (hit) return { ...hit.body, stale: true }; throw e2; }
  }
  const list = Array.isArray(body) ? body : body.features || body.locations || [];
  if (DEBUG && list[0]) console.log('[debug] first location record:', JSON.stringify(list[0]));
  const ships = [];
  for (const f of list) {
    const s = readLocation(f); if (!s) continue;
    if (s.lon < R.lon0 || s.lon > R.lon1 || s.lat < R.lat0 || s.lat > R.lat1) continue;
    if (s.ts !== undefined && now - s.ts > MAX_AGE_MS) continue;
    const m = meta.get(s.mmsi);
    ships.push({ mmsi: s.mmsi, name: m ? m.name : '', type: m ? m.type : 0, len: m ? m.len : 0, lon: +s.lon.toFixed(5), lat: +s.lat.toFixed(5), sog: s.sog, cog: s.cog, ts: s.ts });
  }
  const out = { ok: true, region: key, fetchedAt: now, source: 'Fintraffic / Digitraffic, licence CC 4.0 BY', namesLoaded: meta.size, ships };
  cache.set(key, { at: now, body: out });
  console.log(`${new Date(now).toISOString().slice(11, 19)}  ${R.name}: ${ships.length} ships on the chart (${list.length} received)`);
  return out;
}

// ---- live hydrophone proxy ----
// The stream's address has changed over the years, so several known locations are tried and the one that answers is kept.
const HYDRO_BASES = process.env.HYDRO_BASE ? [HYDRO] : ['https://s3-us-west-2.amazonaws.com/audio-orcasound-net', 'https://audio-orcasound-net.s3.amazonaws.com', 'https://s3-us-west-2.amazonaws.com/streaming-orcasound-net', 'https://streaming-orcasound-net.s3.amazonaws.com'];
const hydroLatest = new Map();
async function hydroGet(url) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (DEBUG) console.log('[debug] hydrophone', r.status, url); return r; } finally { clearTimeout(to); }
}
// Which folder is streaming now: read latest.txt, or failing that list the last few days of folders and take the newest
async function hydroFolder(node) {
  const hit = hydroLatest.get(node), now = Date.now(); if (hit && now - hit.at < 60000) return hit;
  let lastStatus = 0;
  for (const base of HYDRO_BASES) {
    try {
      let r = await hydroGet(`${base}/${node}/latest.txt`); lastStatus = r.status; let ts = r.ok ? (await r.text()).trim() : '';
      if (!/^[0-9]+$/.test(ts)) {
        const after = `${node}/hls/${Math.floor(now / 1000) - 4 * 86400}`;
        r = await hydroGet(`${base}?list-type=2&delimiter=/&prefix=${encodeURIComponent(node + '/hls/')}&start-after=${encodeURIComponent(after)}`); lastStatus = r.status || lastStatus;
        if (r.ok) { const found = [...(await r.text()).matchAll(/<Prefix>[^<]*\/hls\/([0-9]+)\/<\/Prefix>/g)].map(m => m[1]).sort(); ts = found.length ? found[found.length - 1] : ''; }
      }
      if (/^[0-9]+$/.test(ts)) { const out = { at: now, ts, base }; hydroLatest.set(node, out); console.log(`Hydrophone ${node}: streaming folder ${ts} at ${base}`); return out; }
    } catch (e) { if (DEBUG) console.log('[debug] hydrophone error at', base, e.message); }
  }
  throw new Error(lastStatus ? `the hydrophone stream could not be found (last answer HTTP ${lastStatus}); this station may be offline` : 'the hydrophone stream could not be reached');
}
async function hydroFile(node, file) {
  if (!HYDRO_NODES[node] || !/^(live\.m3u8|live[0-9]+\.ts)$/.test(file)) { const e = new Error('unknown hydrophone file'); e.status = 404; throw e; }
  const f = await hydroFolder(node), r = await hydroGet(`${f.base}/${node}/hls/${f.ts}/${file}`);
  if (!r.ok) { hydroLatest.delete(node); throw new Error(`hydrophone stream answered HTTP ${r.status} for ${file}`); }
  return { type: file.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl', body: Buffer.from(await r.arrayBuffer()) };
}

// ---- http ----
const PAGE = path.join(__dirname, 'public', 'index.html');
function send(res, status, type, body) { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/' || u.pathname === '/index.html') { fs.readFile(PAGE, (err, buf) => err ? send(res, 500, 'text/plain', 'public/index.html is missing') : send(res, 200, 'text/html; charset=utf-8', buf)); return; }
  if (u.pathname === '/api/ships') {
    try { send(res, 200, 'application/json', JSON.stringify(await shipsFor(u.searchParams.get('region') || 'gof'))); }
    catch (e) { console.warn('Ship feed error: ' + e.message); send(res, e.status || 502, 'application/json', JSON.stringify({ ok: false, error: e.name === 'AbortError' ? 'the ship feed did not answer in time' : e.message })); }
    return;
  }
  if (u.pathname === '/api/hydro') { send(res, 200, 'application/json', JSON.stringify({ ok: true, source: 'Orcasound', nodes: Object.entries(HYDRO_NODES).map(([id, name]) => ({ id, name })) })); return; }
  if (u.pathname.startsWith('/hydro/')) {
    const parts = u.pathname.split('/');
    try { const f = await hydroFile(parts[2], parts[3] || ''); send(res, 200, f.type, f.body); }
    catch (e) { if (DEBUG) console.log('[debug] hydrophone error:', e.message); send(res, e.status || 502, 'application/json', JSON.stringify({ ok: false, error: e.name === 'AbortError' ? 'the hydrophone stream did not answer in time' : e.message })); }
    return;
  }
  if (u.pathname === '/api/health') { send(res, 200, 'application/json', JSON.stringify({ ok: true, upstream: BASE, namesLoaded: meta.size, metaError, regions: Object.keys(REGIONS) })); return; }
  if (u.pathname.startsWith('/recordings/')) {
    const name = path.basename(u.pathname), type = name.endsWith('.json') ? 'application/json' : name.endsWith('.mp3') ? 'audio/mpeg' : name.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream';
    fs.readFile(path.join(__dirname, 'public', 'recordings', name), (err, buf) => err ? send(res, 404, 'text/plain', 'Not found') : send(res, 200, type, buf)); return;
  }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  send(res, 404, 'text/plain', 'Not found');
}).listen(PORT, () => {
  console.log(`SirenSong is running. Open http://localhost:${PORT}`);
  console.log(`Ship feed: ${BASE}  (Source: Fintraffic / Digitraffic, licence CC 4.0 BY)`);
  loadMeta();
});
