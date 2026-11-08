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
const roster = r => ({ t: 'room', host: r.host, players: [...r.p.values()].map(p => ({ id: p.id, n: p.n, car: p.car, col: p.col })) });
function sendRoster(r) { const o = roster(r); for (const p of r.p.values()) send(p.ws, Object.assign({ id: p.id }, o)); }
function broadcast(r, o, except) { for (const p of r.p.values()) if (p.ws !== except) send(p.ws, o); }
function leave(ws) {
  const r = ws.room; if (!r) return;
  r.p.delete(ws.pid); ws.room = null;
  if (!r.p.size) { rooms.delete(r.name); return; }
  if (r.host === ws.pid) r.host = r.p.keys().next().value;
  broadcast(r, { t: 'bye', id: ws.pid }); sendRoster(r);
}
wss.on('connection', ws => {
  ws.alive = true; ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join' && !ws.room) {
      const name = String(m.room || '').slice(0, 12).replace(/[^\w]/g, '') || 'lobby';
      let r = rooms.get(name);
      if (!r) { r = { name, p: new Map(), host: 0, racing: false, since: 0 }; rooms.set(name, r); }
      if (r.racing && Date.now() - r.since > 8 * 60 * 1000) r.racing = false;
      if (r.racing || r.p.size >= MAX) { send(ws, { t: 'busy' }); return; }
      ws.pid = nextId++; ws.room = r;
      const n = String(m.n || '???').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || '???';
      r.p.set(ws.pid, { id: ws.pid, ws, n, car: Math.max(0, Math.min(2, m.car | 0)), col: Math.max(0, Math.min(9, m.col | 0)) });
      if (!r.host) r.host = ws.pid;
      sendRoster(r);
    } else if (m.t === 'start' && ws.room) {
      const r = ws.room; if (r.host !== ws.pid || r.p.size < 2 || r.racing) return;
      r.racing = true; r.since = Date.now();
      broadcast(r, { t: 'go', slots: [...r.p.keys()] });
    } else if (m.t === 's' && ws.room && ws.room.racing) {
      broadcast(ws.room, { t: 's', id: ws.pid, z: +m.z || 0, x: +m.x || 0, sp: +m.sp || 0 }, ws);
    }
  });
  ws.on('close', () => { const r = ws.room; leave(ws); if (r && rooms.get(r.name) === r && r.racing && r.p.size < 2) r.racing = false; });
  ws.on('error', () => {});
});
setInterval(() => { wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }); }, 20000);
server.listen(PORT, () => console.log('Dust Sprint server on port ' + PORT));
