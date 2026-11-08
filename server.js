// Dust Sprint online relay. Rooms are named by mode+stage, up to 4 players per room.
// Run: npm install && npm start   (PORT env var is respected by Render/Railway/Fly/etc.)
const { WebSocketServer } = require('ws');
const http = require('http');
const PORT = process.env.PORT || 8080, MAX = 4;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('Dust Sprint server OK\n'); });
const wss = new WebSocketServer({ server, maxPayload: 512 });
const rooms = new Map();
let nextId = 1;
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const roster = r => ({ t: 'room', host: r.host, pick: r.pick, nst: r.nst, players: [...r.p.values()].map(p => ({ id: p.id, n: p.n, car: p.car, col: p.col })) });
function sendRoster(r) { const o = roster(r); for (const p of r.p.values()) send(p.ws, Object.assign({ id: p.id }, o)); }
function broadcast(r, o, except) { for (const p of r.p.values()) if (p.ws !== except) send(p.ws, o); }
function check(r) {
  if (!r.racing || r.stageDone || !r.p.size) return;
  for (const id of r.p.keys()) if (!r.done.has(id)) return;
  r.stageDone = true;
  const rows = [...r.p.values()].map(p => ({ id: p.id, n: p.n, s: r.sc.get(p.id) || 0, total: r.tot.get(p.id) || 0 }))
    .sort((a, b) => b.total - a.total || b.s - a.s);
  const fin = r.stage >= r.last;
  broadcast(r, { t: 'board', stage: r.stage, final: fin, board: rows, in: fin ? 0 : 9 });
  if (fin) { r.tm = setTimeout(() => { r.racing = false; r.tm = null; }, 60000); }
  else r.tm = setTimeout(() => {
    r.tm = null; if (!r.racing || !r.p.size) return;
    r.stage++; r.done.clear(); r.sc.clear(); r.stageDone = false;
    broadcast(r, { t: 'next', stage: r.stage });
  }, 9000);
}
function leave(ws) {
  const r = ws.room; if (!r) return;
  r.p.delete(ws.pid); ws.room = null;
  if (!r.p.size) { if (r.tm) clearTimeout(r.tm); rooms.delete(r.name); return; }
  if (r.host === ws.pid) r.host = r.p.keys().next().value;
  broadcast(r, { t: 'bye', id: ws.pid }); sendRoster(r); check(r);
}
wss.on('connection', ws => {
  ws.alive = true; ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join' && !ws.room) {
      const name = String(m.room || '').slice(0, 12).replace(/[^\w]/g, '') || 'lobby';
      let r = rooms.get(name);
      if (!r) { r = { name, p: new Map(), host: 0, racing: false, since: 0, stage: 0, last: 0, pick: 0, nst: 7, mode: /^m2/.test(name) ? 2 : 0, done: new Set(), sc: new Map(), tot: new Map(), stageDone: false, tm: null }; rooms.set(name, r); }
      if (r.racing && Date.now() - r.since > 40 * 60 * 1000) r.racing = false;
      if (r.racing || r.p.size >= MAX) { send(ws, { t: 'busy' }); return; }
      ws.pid = nextId++; ws.room = r;
      let n = String(m.n || '???').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || '???';
      const used = new Set([...r.p.values()].map(p => p.n));
      if (used.has(n)) for (let d = 2; d < 10; d++) { const c = n.slice(0, 2) + d; if (!used.has(c)) { n = c; break; } }
      r.p.set(ws.pid, { id: ws.pid, ws, n, car: Math.max(0, Math.min(2, m.car | 0)), col: Math.max(0, Math.min(9, m.col | 0)) });
      if (!r.host) r.host = ws.pid;
      sendRoster(r);
    } else if (m.t === 'start' && ws.room) {
      const r = ws.room; if (r.host !== ws.pid || r.p.size < 2 || r.racing) return;
      r.racing = true; r.since = Date.now(); r.stage = r.mode === 2 ? 0 : r.pick; r.last = r.mode === 2 ? r.nst - 1 : r.pick; r.done.clear(); r.sc.clear(); r.tot.clear(); r.stageDone = false;
      broadcast(r, { t: 'go', slots: [...r.p.keys()], stage: r.stage });
    } else if (m.t === 'pick' && ws.room && !ws.room.racing && ws.room.host === ws.pid) {
      const r = ws.room; r.nst = Math.max(7, Math.min(10, m.nst | 0)); r.pick = Math.max(0, Math.min(r.nst - 1, m.stage | 0));
      sendRoster(r);
    } else if (m.t === 'done' && ws.room && ws.room.racing) {
      const r = ws.room; if (r.stageDone || r.done.has(ws.pid)) return;
      const s = Math.max(0, Math.min(99999, m.s | 0));
      r.done.add(ws.pid); r.sc.set(ws.pid, s); r.tot.set(ws.pid, (r.tot.get(ws.pid) || 0) + s); check(r);
    } else if (m.t === 's' && ws.room && ws.room.racing) {
      broadcast(ws.room, { t: 's', id: ws.pid, z: +m.z || 0, x: +m.x || 0, sp: +m.sp || 0 }, ws);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});
setInterval(() => { wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }); }, 20000);
server.listen(PORT, () => console.log('Dust Sprint server on port ' + PORT));
