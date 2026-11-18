'use strict';
(() => {
const $ = id => document.getElementById(id);
const stored = (() => { try { return JSON.parse(localStorage.getItem('swarmCfg') || '{}'); } catch (e) { return {}; } })();
const CFG = Object.assign({ GOOGLE_MAPS_API_KEY: '', MAP_PROVIDER: 'auto', BASE_LAT: 37.7749, BASE_LNG: -122.4194 }, window.SWARM_CONFIG || {}, stored);
const mk = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/* ---------------- state ---------------- */
const S = { running: false, missionActive: false, recall: false, complete: false, time: 0, simSpeed: 1, view: 'tpv', terrain: 'urban', tod: 'day', weather: 'clear',
  n: 50, formation: 'grid', mode: 'leader', speed: 5, spacing: 10, latency: 50, loss: 0, wSep: 1.5, wAli: 1, wCoh: 1, wGoal: 2,
  commDown: 0, lossBoost: 0, selected: 0, collisions: 0, hits: 0, reached: 0, wpIndex: 0, waypoints: [], battery: 100, frame: 0, fwd: [0, -1],
  anchor: [0, 40, 0], frozen: [0, 40, 0], placeMode: false, snapHead: 0, snapT: 0, recT: 0, recovered: false };
const BASE_ALT = 40, K = 12, H = 8192;
let P, V, ST, alive, cool, offs, offsH, YAW, SE, CN, CS, nxt, SN = [], rec = [], dp, dv;
const head = new Int32Array(H);
const hash = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) % H;
const replay = { on: false, playing: false, idx: 0, speed: 1, cur: null };
const events = [];
const fmt = t => { t = Math.floor(t); return [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60].map(v => String(v).padStart(2, '0')).join(':'); };
function log(msg, sev = 'info') {
  const e = { t: +S.time.toFixed(1), time: fmt(S.time), severity: sev, message: msg }; events.push(e);
  const d = document.createElement('div'); d.className = 'ev ' + sev; d.innerHTML = `<time>${e.time}</time><span></span>`; d.lastChild.textContent = msg;
  const box = $('eventLog'); box.prepend(d); while (box.children.length > 200) box.lastChild.remove();
  $('systemMessage').textContent = msg;
}

/* ---------------- three.js scene ---------------- */
const canvas = $('droneCanvas'), stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(), root = new THREE.Group(); scene.add(root);
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000); rig.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1), sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(200, 400, 150); scene.add(hemi, sun);
const stars = (() => { const g = new THREE.BufferGeometry(), a = new Float32Array(1800), r = mk(3); for (let i = 0; i < 600; i++) { const th = r() * 6.28, ph = Math.acos(r() * 1.6 - .6), R = 1800; a[3 * i] = R * Math.sin(ph) * Math.cos(th); a[3 * i + 1] = Math.abs(R * Math.cos(ph)) + 50; a[3 * i + 2] = R * Math.sin(ph) * Math.sin(th); } g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false })); })();
scene.add(stars);
const rainG = new THREE.BufferGeometry(), rainA = new Float32Array(2400 * 3 * 2), rr = mk(9);
for (let i = 0; i < 2400; i++) { const x = (rr() - .5) * 400, y = rr() * 220, z = (rr() - .5) * 400; rainA.set([x, y, z, x, y - 6, z], i * 6); }
rainG.setAttribute('position', new THREE.BufferAttribute(rainA, 3));
const rain = new THREE.LineSegments(rainG, new THREE.LineBasicMaterial({ color: 0x9aa4b0, transparent: true, opacity: .45 })); rain.frustumCulled = false; rain.visible = false; root.add(rain);
let envG = null, bodyM, ringM; const wpG = new THREE.Group(); root.add(wpG);
let obstacles = [];
const TOD = { day: { bg: 0x3b4048, hemi: 1.0, sun: 1.1 }, dusk: { bg: 0x2b1d17, hemi: .6, sun: .55 }, night: { bg: 0x020203, hemi: .3, sun: .18 } };
const GROUND = { urban: 0x16171b, desert: 0x30291b, mountain: 0x1b2025 };
const heightAt = (x, z) => S.terrain === 'desert' ? 4 * Math.sin(x * .01) * Math.cos(z * .013) + 2 * Math.sin(x * .03 + z * .02)
  : S.terrain === 'mountain' ? 12 * Math.sin(x * .008 + 1) * Math.cos(z * .006) + 5 * Math.sin(x * .02) * Math.sin(z * .017) + 12 : 0;
const isAR = () => XR.active && XR.type === 'ar';
function applyAtmos() {
  const t = TOD[S.tod], bg = new THREE.Color(t.bg), fogFar = { clear: 1500, fog: 320, rain: 800, storm: 500 }[S.weather];
  scene.background = isAR() ? null : bg; scene.fog = isAR() ? null : new THREE.Fog(bg, S.weather === 'fog' ? 15 : 120, fogFar);
  hemi.intensity = t.hemi; sun.intensity = t.sun; stars.visible = S.tod === 'night' && !isAR();
  rain.visible = S.weather === 'rain' || S.weather === 'storm';
  $('terrainType').textContent = S.terrain[0].toUpperCase() + S.terrain.slice(1); $('timeOfDay').textContent = S.tod[0].toUpperCase() + S.tod.slice(1); $('weather').textContent = S.weather[0].toUpperCase() + S.weather.slice(1);
}
function buildEnv() {
  if (envG) { root.remove(envG); envG.traverse(o => { o.geometry && o.geometry.dispose(); }); }
  envG = new THREE.Group(); root.add(envG); obstacles = [];
  const r = mk({ urban: 11, desert: 22, mountain: 33 }[S.terrain]);
  const gg = new THREE.PlaneGeometry(3000, 3000, 70, 70); gg.rotateX(-Math.PI / 2);
  const pa = gg.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, heightAt(pa.getX(i), pa.getZ(i)) - .3); gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: GROUND[S.terrain], roughness: 1 })); ground.name = 'ground'; envG.add(ground);
  const grid = new THREE.GridHelper(3000, 60, 0x3a3a3a, 0x1d1d1d); grid.position.y = .15; grid.name = 'grid'; if (S.terrain === 'urban') envG.add(grid);
  const pad = new THREE.Mesh(new THREE.RingGeometry(14, 17, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd400 })); pad.position.y = heightAt(0, 0) + .4; envG.add(pad);
  const edge = new THREE.LineBasicMaterial({ color: 0x777c86 });
  const place = (cnt, fn) => { for (let i = 0; i < cnt; i++) { let x, z; do { x = (r() - .5) * 1000; z = (r() - .5) * 1000; } while (Math.hypot(x, z) < 70); fn(x, z); } };
  if (S.terrain === 'urban') place(30, (x, z) => { const w = 14 + r() * 22, h = 25 + r() * 70, g = new THREE.BoxGeometry(w, h, w), m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x25282e, roughness: .8 }));
    m.position.set(x, h / 2, z); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edge)); envG.add(m); obstacles.push({ k: 'cyl', x, z, r: w * .72, h }); });
  if (S.terrain === 'desert') place(14, (x, z) => { const rad = 8 + r() * 12, h = 10 + r() * 22, g = new THREE.CylinderGeometry(rad * .6, rad, h, 7), m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a3f28, roughness: 1 }));
    const y = heightAt(x, z); m.position.set(x, y + h / 2, z); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edge)); envG.add(m); obstacles.push({ k: 'cyl', x, z, r: rad * 1.05, h: y + h }); });
  if (S.terrain === 'mountain') place(8, (x, z) => { const rad = 55 + r() * 40, h = 70 + r() * 50, g = new THREE.ConeGeometry(rad, h, 9), m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 1, flatShading: true }));
    m.position.set(x, h / 2 + heightAt(x, z), z); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edge)); envG.add(m); obstacles.push({ k: 'cone', x, z, r: rad, h: h + heightAt(x, z) }); });
  [[110, 55, -95], [-70, 60, -190], [-210, 55, -130]].forEach(([x, y, z]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(22, 22, 14), new THREE.MeshBasicMaterial({ color: 0xff3b30, wireframe: true, transparent: true, opacity: .55 })); m.position.set(x, y, z); envG.add(m); obstacles.push({ k: 'sph', x, y, z, r: 22 }); });
  if (isAR()) { ground.visible = false; grid.visible = false; }
}
function buildDroneMeshes() {
  if (bodyM) { root.remove(bodyM, ringM); bodyM.geometry.dispose(); ringM.geometry.dispose(); }
  bodyM = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, .8, 3.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, emissive: 0x111111 }), S.n);
  ringM = new THREE.InstancedMesh(new THREE.TorusGeometry(2.6, .22, 5, 14).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), S.n);
  ringM.instanceMatrix = bodyM.instanceMatrix; bodyM.setColorAt(0, new THREE.Color(1, 1, 1)); ringM.instanceColor = bodyM.instanceColor;
  bodyM.frustumCulled = ringM.frustumCulled = false; root.add(bodyM, ringM);
  CS = new Int8Array(S.n).fill(-1);
}

/* ---------------- formations ---------------- */
function formOffset(type, i, n, sp, r) {
  switch (type) {
    case 'grid': { const c = Math.ceil(Math.sqrt(n)); return [((i % c) - (c - 1) / 2) * sp, 0, Math.floor(i / c) * sp]; }
    case 'v': { const k = Math.ceil(i / 2), s = i % 2 ? 1 : -1; return [s * k * sp * .8, 0, k * sp * .8]; }
    case 'circle': { const R = Math.max(sp, sp * n / 6.283), a = 6.283 * i / n; return [R * Math.cos(a), 0, R * Math.sin(a)]; }
    case 'sphere': { const R = Math.max(sp * 1.5, sp * Math.sqrt(n) / 2.2), y = 1 - 2 * (i + .5) / n, q = Math.sqrt(1 - y * y), th = i * 2.39996; return [R * q * Math.cos(th), R * y, R * q * Math.sin(th)]; }
    case 'line': return [(i - (n - 1) / 2) * sp, 0, 0];
    default: { const R = sp * Math.cbrt(n) * 1.3; let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1); return [x * R, y * R * .6, z * R]; }
  }
}
function computeOffsets() {
  const n = S.n, r = mk(5), ng = Math.ceil(n / 8), r2 = mk(6);
  offs = new Float32Array(3 * n); offsH = new Float32Array(3 * ng);
  for (let i = 0; i < n; i++) offs.set(formOffset(S.formation, i, n, S.spacing, r), 3 * i);
  for (let g = 0; g < ng; g++) offsH.set(formOffset(S.formation, g, ng, S.spacing * 3.4, r2), 3 * g);
}

/* ---------------- swarm creation ---------------- */
function createSwarm(silent) {
  const n = S.n; P = new Float32Array(3 * n); V = new Float32Array(3 * n); ST = new Float32Array(3 * n); alive = new Uint8Array(n).fill(1);
  cool = new Float32Array(n); YAW = new Float32Array(n); SE = new Float32Array(n).fill(-1); CN = new Float32Array(n); nxt = new Int32Array(n);
  computeOffsets();
  replay.on = false; replay.playing = false;
  for (let i = 0; i < n; i++) { const dx = offs[3 * i], dy = offs[3 * i + 1], dz = offs[3 * i + 2]; P[3 * i] = dx; P[3 * i + 1] = Math.max(BASE_ALT + dy, heightAt(dx, dz) + 8); P[3 * i + 2] = dz + 40; }
  S.snapHead = 0; SN = []; for (let k = 0; k < K; k++) SN.push({ p: Float32Array.from(P), v: new Float32Array(3 * n), t: -1 });
  rec = []; S.selected = 0; S.collisions = 0; S.hits = 0; S.battery = 100; S.recovered = false; coverage.clear(); heat.getContext('2d').clearRect(0, 0, 300, 300);
  S.anchor = [0, BASE_ALT, 40]; buildDroneMeshes();
  if (!silent) log(`Swarm created: ${n} drones, ${S.formation} formation, ${S.mode} mode`);
  syncTimeline();
}
const leaderIdx = () => { for (let i = 0; i < S.n; i++) if (alive[i]) return i; return -1; };
const aliveCount = () => { let c = 0; for (let i = 0; i < S.n; i++) c += alive[i]; return c; };

/* ---------------- simulation step ---------------- */
const BASE_T = [0, 30, 0];
function delayed() { const tg = S.time - S.latency / 1000; for (let j = 0; j < K; j++) { const k = (S.snapHead - j + K) % K; if (SN[k].t <= tg) return SN[k]; } return SN[(S.snapHead + 1) % K]; }
function step(dt) {
  const n = S.n, sp = S.speed, maxF = Math.max(6, sp * 2.5), per = Math.max(30, S.spacing * 2.5), sepR = Math.max(5, S.spacing * .85);
  S.time += dt; S.frame++;
  if ((S.snapT += dt) >= .05) { S.snapT = 0; S.snapHead = (S.snapHead + 1) % K; const s = SN[S.snapHead]; s.p.set(P); s.v.set(V); s.t = S.time; }
  if (S.commDown > 0 && (S.commDown -= dt) <= 0) log('Communication restored', 'info');
  if (S.lossBoost > 0 && (S.lossBoost -= dt) <= 0) log('Packet loss burst ended', 'info');
  const D = delayed(); dp = D.p; dv = D.v; head.fill(-1);
  let cx = 0, cy = 0, cz = 0, ac = 0;
  for (let i = 0; i < n; i++) if (alive[i]) { const i3 = 3 * i; nxt[i] = head[hash(Math.floor(dp[i3] / per), Math.floor(dp[i3 + 1] / per), Math.floor(dp[i3 + 2] / per))]; head[hash(Math.floor(dp[i3] / per), Math.floor(dp[i3 + 1] / per), Math.floor(dp[i3 + 2] / per))] = i; cx += P[i3]; cy += P[i3 + 1]; cz += P[i3 + 2]; ac++; }
  if (!ac) return; cx /= ac; cy /= ac; cz /= ac;
  const L = leaderIdx(), lm = S.mode === 'leader' || S.mode === 'hier';
  let T0 = null; if (S.recall && !S.recovered) T0 = BASE_T; else if (S.missionActive && S.wpIndex < S.waypoints.length) T0 = S.waypoints[S.wpIndex];
  const ref = lm ? [P[3 * L], P[3 * L + 1], P[3 * L + 2]] : [cx, cy, cz];
  if (T0) { const d = Math.hypot(T0[0] - ref[0], T0[1] - ref[1], T0[2] - ref[2]);
    if (d < 22 + S.spacing) { if (S.recall) { S.recovered = true; S.missionActive = false; log('Swarm recovered at base', 'info'); } else { S.reached++; S.wpIndex++; log(`Waypoint ${S.wpIndex} reached`); if (S.wpIndex >= S.waypoints.length) { S.complete = true; log('Mission complete: all waypoints reached'); } renderWps(); } } }
  let fx = S.fwd[0], fz = S.fwd[1], nfx = fx, nfz = fz;
  if (lm && Math.hypot(V[3 * L], V[3 * L + 2]) > .6) { nfx = V[3 * L]; nfz = V[3 * L + 2]; } else if (T0) { nfx = T0[0] - cx; nfz = T0[2] - cz; }
  { const l = Math.hypot(nfx, nfz); if (l > .5) { fx += (nfx / l - fx) * Math.min(1, dt * 2); fz += (nfz / l - fz) * Math.min(1, dt * 2); const m = Math.hypot(fx, fz) || 1; fx /= m; fz /= m; } S.fwd = [fx, fz]; }
  if (S.mode === 'decentral') { const a = S.anchor; if (T0) { const dx = T0[0] - a[0], dy = T0[1] - a[1], dz = T0[2] - a[2], d = Math.hypot(dx, dy, dz) || 1;
      if (Math.hypot(a[0] - cx, a[2] - cz) < per * 1.5) { const m = Math.min(d, sp * .7 * dt) / d; a[0] += dx * m; a[1] += dy * m; a[2] += dz * m; } } }
  const Lp = S.commDown > 0 ? S.frozen : [dp[3 * L], dp[3 * L + 1], dp[3 * L + 2]];
  const ctx = { sp, maxF, per, sepR, L, T0, fx, fz, Lp, comm: S.commDown <= 0 };
  const stag = n > 600 ? 3 : n > 250 ? 2 : 1, pl = Math.min(.95, (S.loss + (S.lossBoost > 0 ? 50 : 0)) / 100);
  const wind = S.weather === 'storm' ? [3.2 * Math.sin(S.time * .4) + 2, 0, 1.2] : [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const i3 = 3 * i; cool[i] -= dt;
    if (!alive[i]) { V[i3 + 1] -= 9.8 * dt; V[i3] *= .98; V[i3 + 2] *= .98; P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt; const g = heightAt(P[i3], P[i3 + 2]) + .5; if (P[i3 + 1] < g) { P[i3 + 1] = g; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; } continue; }
    if ((i + S.frame) % stag === 0 && !(pl > 0 && Math.random() < pl)) steerFor(i, ctx);
    let ax = ST[i3], ay = ST[i3 + 1], az = ST[i3 + 2];
    let vx = V[i3] + ax * dt + wind[0] * dt, vy = V[i3 + 1] + ay * dt, vz = V[i3 + 2] + az * dt + wind[2] * dt;
    const vm = Math.hypot(vx, vy, vz), vmax = sp * 1.15; if (vm > vmax) { const k = vmax / vm; vx *= k; vy *= k; vz *= k; }
    let x = P[i3] + vx * dt, y = P[i3 + 1] + vy * dt, z = P[i3 + 2] + vz * dt;
    const gmin = heightAt(x, z) + 6; if (y < gmin) { y = gmin; if (vy < 0) vy = 0; } if (y > 300) { y = 300; if (vy > 0) vy = 0; }
    for (const o of obstacles) { // hard constraint: never pass through
      if (o.k === 'sph') { const dx = x - o.x, dy = y - o.y, dz = z - o.z, d = Math.hypot(dx, dy, dz); if (d < o.r + 1 && d > .01) { const k = (o.r + 1) / d; x = o.x + dx * k; y = o.y + dy * k; z = o.z + dz * k; } }
      else if (y < o.h + 2) { const rr2 = o.k === 'cone' ? o.r * Math.max(.05, 1 - y / o.h) : o.r, dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz); if (d < rr2 + 1 && d > .01) { const k = (rr2 + 1) / d; x = o.x + dx * k; z = o.z + dz * k; } } }
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    if (vx * vx + vz * vz > .25) YAW[i] = Math.atan2(vx, vz);
  }
  if (S.running && (S.missionActive || S.recall)) { S.battery -= dt * .04; if (S.battery < 20 && S.battery + dt * .04 >= 20) log('Battery below 20%: consider recall', 'warning'); if (S.battery <= 0) { S.battery = 0; if (!S.recall) { S.recall = true; log('Battery depleted: automatic recall', 'error'); } } }
  S.recT += dt; if (S.recT >= .2) { S.recT = 0; rec.push({ p: Float32Array.from(P), a: Uint8Array.from(alive), t: S.time }); if (rec.length > 1500) rec.shift(); syncTimeline(); }
}
function steerFor(i, c) {
  const i3 = 3 * i, x = P[i3], y = P[i3 + 1], z = P[i3 + 2], vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
  const per = c.per, per2 = per * per, sep2 = c.sepR * c.sepR, maxF = c.maxF, flock = S.mode === 'flock';
  let sx = 0, sy = 0, sz = 0, ns = 0, ax = 0, ay = 0, az = 0, qx = 0, qy = 0, qz = 0, cnt = 0, minD2 = 1e9;
  const gx = Math.floor(x / per), gy = Math.floor(y / per), gz = Math.floor(z / per);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
    let j = head[hash(gx + a, gy + b, gz + d)];
    while (j >= 0) {
      if (j !== i && alive[j]) { const j3 = 3 * j, dx = x - P[j3], dy = y - P[j3 + 1], dz = z - P[j3 + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < sep2 && d2 > 1e-6) { const w = 1 / d2; sx += dx * w; sy += dy * w; sz += dz * w; ns++; if (d2 < minD2) minD2 = d2; }
        if (c.comm) { const ex = dp[j3] - x, ey = dp[j3 + 1] - y, ez = dp[j3 + 2] - z; if (ex * ex + ey * ey + ez * ez < per2) { ax += dv[j3]; ay += dv[j3 + 1]; az += dv[j3 + 2]; qx += dp[j3]; qy += dp[j3 + 1]; qz += dp[j3 + 2]; cnt++; } } }
      j = nxt[j];
    }
  }
  let Fx = 0, Fy = 0, Fz = 0, l, k;
  if (ns) { l = Math.hypot(sx, sy, sz) || 1; k = maxF * S.wSep / l; Fx += sx * k; Fy += sy * k; Fz += sz * k; if (minD2 < sep2 * .3 && cool[i] <= 0) { S.collisions++; cool[i] = 1.5; } if (minD2 < 4) S.hits++; }
  CN[i] = cnt;
  if (cnt) {
    ax = ax / cnt - vx; ay = ay / cnt - vy; az = az / cnt - vz; l = Math.hypot(ax, ay, az) || 1; k = Math.min(1, maxF / l) * S.wAli * (flock ? 1.5 : .6); Fx += ax * k; Fy += ay * k; Fz += az * k;
    qx = qx / cnt - x; qy = qy / cnt - y; qz = qz / cnt - z; l = Math.hypot(qx, qy, qz); if (l > .01) { k = maxF * Math.min(1, l / per) / l * S.wCoh * (flock ? 1.2 : .4); Fx += qx * k; Fy += qy * k; Fz += qz * k; }
  }
  // goal
  const fx = c.fx, fz = c.fz; let tx = x, ty = y, tz = z, has = false, slot = true;
  const rx = (ox, oz) => ox * -fz + oz * -fx, rz = (ox, oz) => ox * fx + oz * -fz;
  const T0 = c.T0, L = c.L, Lp = c.Lp;
  if (S.mode === 'leader') {
    if (i === L) { if (T0) { tx = T0[0]; ty = T0[1]; tz = T0[2]; has = true; } slot = false; }
    else { const ox = offs[i3] - offs[3 * L], oy = offs[i3 + 1] - offs[3 * L + 1], oz = offs[i3 + 2] - offs[3 * L + 2]; tx = Lp[0] + rx(ox, oz); ty = Lp[1] + oy; tz = Lp[2] + rz(ox, oz); has = true; }
  } else if (S.mode === 'hier') {
    const g = i >> 3, sub = g * 8;
    if (i === L) { if (T0) { tx = T0[0]; ty = T0[1]; tz = T0[2]; has = true; } slot = false; }
    else if (i === sub) { const ox = offsH[3 * g] - offsH[0], oy = offsH[3 * g + 1] - offsH[1], oz = offsH[3 * g + 2] - offsH[2]; tx = Lp[0] + rx(ox, oz); ty = Lp[1] + oy; tz = Lp[2] + rz(ox, oz); has = true; }
    else { const ok = alive[sub] && c.comm; const sp3 = 3 * sub, bx = ok ? dp[sp3] : Lp[0], by = ok ? dp[sp3 + 1] : Lp[1], bz = ok ? dp[sp3 + 2] : Lp[2], j = i - sub, an = (j - 1) / 7 * 6.283, rr = S.spacing * 1.3;
      tx = bx + rx(rr * Math.cos(an), rr * Math.sin(an)); ty = by + (j % 2 ? 2 : -2); tz = bz + rz(rr * Math.cos(an), rr * Math.sin(an)); has = true; }
  } else if (S.mode === 'decentral') {
    const a = S.anchor; tx = a[0] + rx(offs[i3], offs[i3 + 2]); ty = a[1] + offs[i3 + 1]; tz = a[2] + rz(offs[i3], offs[i3 + 2]); has = true;
  } else if (T0) { tx = T0[0]; ty = T0[1]; tz = T0[2]; has = true; slot = false; }
  if (S.formation === 'random' || flock) slot = false;
  let dx = 0, dy = 0, dz = 0, dist = 0;
  if (has) { dx = tx - x; dy = ty - y; dz = tz - z; dist = Math.hypot(dx, dy, dz); }
  SE[i] = has && slot ? dist : -1;
  let desx = 0, desy = 0, desz = 0;
  if (has && dist > .05) { const ds = Math.min(c.sp, dist * .7) / dist; desx = dx * ds; desy = dy * ds; desz = dz * ds; }
  let gxF = desx - vx, gyF = desy - vy, gzF = desz - vz; l = Math.hypot(gxF, gyF, gzF); if (l > maxF) { k = maxF / l; gxF *= k; gyF *= k; gzF *= k; }
  const gw = S.wGoal * (flock ? .6 : 1); Fx += gxF * gw; Fy += gyF * gw; Fz += gzF * gw;
  // obstacle avoidance (lookahead grows with speed)
  const look = 12 + Math.hypot(vx, vz) * 1.4;
  for (const o of obstacles) {
    let ox, oy = 0, oz, d, R;
    if (o.k === 'sph') { ox = x - o.x; oy = y - o.y; oz = z - o.z; d = Math.hypot(ox, oy, oz); R = o.r + look; }
    else { if (y > o.h + look) continue; ox = x - o.x; oz = z - o.z; d = Math.hypot(ox, oz); R = (o.k === 'cone' ? o.r * Math.max(.05, 1 - y / o.h) : o.r) + look; }
    if (d < R && d > .01) { const w = (R - d) / R * maxF * 3 / d; Fx += ox * w; Fy += oy * w; Fz += oz * w; if (d < R * .75 && o.k !== 'sph' && y < o.h && cool[i] <= 0) { S.collisions++; cool[i] = 2; } else if (d < R * .75 && o.k === 'sph' && cool[i] <= 0) { S.collisions++; cool[i] = 2; }
      // slide around: add tangential push so drones route around rather than stall
      if (o.k !== 'sph') { Fx += -oz / d * w * d * .6; Fz += ox / d * w * d * .6; } }
  }
  l = Math.hypot(Fx, Fy, Fz); const cap = maxF * 2.5; if (l > cap) { k = cap / l; Fx *= k; Fy *= k; Fz *= k; }
  ST[i3] = Fx; ST[i3 + 1] = Fy; ST[i3 + 2] = Fz;
}

/* ---------------- rendering drones ---------------- */
const dummy = new THREE.Object3D(), col = [new THREE.Color(0xa6a6a6), new THREE.Color(0xff3b30), new THREE.Color(0xffd400), new THREE.Color(0xffffff), new THREE.Color(0xff8a00)];
function drawDrones(pa, aa) {
  const n = S.n, L = leaderIdx(); let cd = false;
  for (let i = 0; i < n; i++) {
    dummy.position.set(pa[3 * i], pa[3 * i + 1], pa[3 * i + 2]); dummy.rotation.set(0, YAW[i], 0); dummy.updateMatrix(); bodyM.setMatrixAt(i, dummy.matrix);
    const st = !aa[i] ? 1 : i === S.selected ? 3 : i === L ? 2 : S.commDown > 0 ? 4 : 0;
    if (CS[i] !== st) { CS[i] = st; bodyM.setColorAt(i, col[st]); cd = true; }
  }
  bodyM.count = ringM.count = n; bodyM.instanceMatrix.needsUpdate = true; if (cd) bodyM.instanceColor.needsUpdate = true;
}
function renderWps() {
  wpG.children.slice().forEach(c => { wpG.remove(c); c.geometry.dispose(); });
  S.waypoints.forEach((w, i) => {
    const cur = i === S.wpIndex && S.missionActive, done = i < S.wpIndex, c = done ? 0x555555 : cur ? 0xffffff : 0xffd400;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(cur ? 16 : 12, 1.2, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: c })); ring.position.set(w[0], w[1], w[2]); wpG.add(ring);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(w[0], w[1], w[2]), new THREE.Vector3(w[0], 0, w[2])]), new THREE.LineBasicMaterial({ color: c })); wpG.add(line);
  });
  const box = $('waypointList'); box.innerHTML = '';
  if (!S.waypoints.length) box.innerHTML = '<div class="wp">No waypoints. Add one to give the swarm a target.</div>';
  S.waypoints.forEach((w, i) => { const d = document.createElement('div'); d.className = 'wp' + (i === S.wpIndex && S.missionActive ? ' cur' : '') + (i < S.wpIndex ? ' done' : '');
    d.innerHTML = `<span>${i + 1}. ${w.map(v => Math.round(v)).join(', ')}</span><button title="Remove waypoint" aria-label="Remove waypoint ${i + 1}">✕</button>`;
    d.querySelector('button').onclick = () => { S.waypoints.splice(i, 1); if (S.wpIndex > i) S.wpIndex--; renderWps(); syncMapStatic(); log('Waypoint removed'); }; box.appendChild(d); });
  syncMapStatic();
}
function addWaypoint(x, y, z) { S.waypoints.push([x, y, z]); if (S.complete) { S.complete = false; } log(`Waypoint added: (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)})`); renderWps(); }

/* ---------------- map (Google Maps with automatic Esri/Leaflet fallback) ---------------- */
const MAP = { api: null, kind: '', drones: [], idxs: [], wp: [], busy: null };
const w2ll = (x, z) => [CFG.BASE_LAT - z / 111320, CFG.BASE_LNG + x / (111320 * Math.cos(CFG.BASE_LAT * Math.PI / 180))];
const ll2w = (la, ln) => [(ln - CFG.BASE_LNG) * 111320 * Math.cos(CFG.BASE_LAT * Math.PI / 180), -(la - CFG.BASE_LAT) * 111320];
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('script blocked or offline')); document.head.appendChild(s); });
function googleApi(el) {
  const map = new google.maps.Map(el, { center: { lat: CFG.BASE_LAT, lng: CFG.BASE_LNG }, zoom: 17, mapTypeId: 'satellite', tilt: 0, gestureHandling: 'greedy', streetViewControl: false, fullscreenControl: false, mapTypeControl: false });
  const info = new google.maps.InfoWindow(); let line = null;
  return { name: 'Google Maps', center: (a, b) => map.panTo({ lat: a, lng: b }), resize: () => google.maps.event.trigger(map, 'resize'),
    marker: (a, b, o) => { const m = new google.maps.Marker({ map, position: { lat: a, lng: b }, title: o.title || '', zIndex: o.z || 1, icon: { path: google.maps.SymbolPath.CIRCLE, scale: o.r, fillColor: o.color, fillOpacity: 1, strokeColor: '#000', strokeWeight: 1.5 } });
      if (o.pop) m.addListener('click', () => { info.setContent(o.pop()); info.open(map, m); }); return { move: (x, y) => m.setPosition({ lat: x, lng: y }), remove: () => m.setMap(null) }; },
    setLine: pts => { if (line) line.setMap(null); line = new google.maps.Polyline({ map, path: pts.map(p => ({ lat: p[0], lng: p[1] })), strokeColor: '#ffd400', strokeWeight: 3, strokeOpacity: .9 }); },
    onClick: cb => map.addListener('click', e => cb(e.latLng.lat(), e.latLng.lng())) };
}
function leafletApi(el) {
  const map = L.map(el, { zoomControl: false }).setView([CFG.BASE_LAT, CFG.BASE_LNG], 17); L.control.zoom({ position: 'bottomright' }).addTo(map); let line = null;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
  return { name: 'Esri satellite', center: (a, b) => map.panTo([a, b]), resize: () => map.invalidateSize(),
    marker: (a, b, o) => { const m = L.circleMarker([a, b], { radius: o.r, color: '#000', weight: 1.5, fillColor: o.color, fillOpacity: 1 }).addTo(map); if (o.pop) m.bindPopup(() => o.pop()); if (o.title) m.bindTooltip(o.title);
      return { move: (x, y) => m.setLatLng([x, y]), remove: () => m.remove() }; },
    setLine: pts => { if (line) line.remove(); line = L.polyline(pts, { color: '#ffd400', weight: 3 }).addTo(map); },
    onClick: cb => map.on('click', e => cb(e.latlng.lat, e.latlng.lng)) };
}
function useLeaflet() {
  const el = $('map'); el.innerHTML = ''; el.className = ''; MAP.drones = []; MAP.wp = [];
  if (typeof L === 'undefined') { log('Map library failed to load (check internet connection)', 'error'); return; }
  MAP.api = leafletApi(el); MAP.kind = 'leaflet'; MAP.api.onClick(onMapClick); $('mapBadge').textContent = 'Map: Esri satellite';
}
function onMapClick(la, ln) { if (!S.placeMode) return; const w = ll2w(la, ln); addWaypoint(w[0], 55, w[1]); }
function initMap() {
  if (MAP.api) return Promise.resolve(); if (MAP.busy) return MAP.busy;
  const el = $('map'), key = CFG.GOOGLE_MAPS_API_KEY, wantG = key && CFG.MAP_PROVIDER !== 'leaflet';
  MAP.busy = (async () => {
    if (wantG) {
      try {
        await new Promise((res, rej) => {
          window.__gmReady = res;
          window.gm_authFailure = () => { if (MAP.kind === 'google') { log('Google Maps rejected the API key (check key, billing, allowed referrers). Switched to Esri satellite.', 'error'); MAP.api = null; MAP.kind = ''; useLeaflet(); syncMapStatic(); } else rej(new Error('API key rejected')); };
          loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gmReady&v=weekly`).catch(rej);
          setTimeout(() => rej(new Error('timed out')), 12000);
        });
        MAP.api = googleApi(el); MAP.kind = 'google'; MAP.api.onClick(onMapClick); $('mapBadge').textContent = 'Map: Google satellite'; log('Google Maps ready');
      } catch (e) { log(`Google Maps unavailable (${e.message}). Using Esri satellite map.`, 'warning'); }
    }
    if (!MAP.api) { useLeaflet(); if (MAP.api) log('Satellite map ready (Esri imagery)'); }
    syncMapStatic();
  })(); return MAP.busy;
}
function syncMapStatic() {
  if (!MAP.api) return; MAP.wp.forEach(m => m.remove()); MAP.wp = [];
  S.waypoints.forEach((w, i) => { const p = w2ll(w[0], w[2]); MAP.wp.push(MAP.api.marker(p[0], p[1], { r: 9, color: '#ffd400', z: 5, title: 'Waypoint ' + (i + 1), pop: () => `<b>Waypoint ${i + 1}</b><br>x ${Math.round(w[0])} m, z ${Math.round(w[2])} m, alt ${Math.round(w[1])} m` })); });
  const pts = [w2ll(0, 0)].concat(S.waypoints.map(w => w2ll(w[0], w[2]))); MAP.api.setLine(pts);
}
function droneInfo(i) { const p = w2ll(P[3 * i], P[3 * i + 2]); return `<b>Drone #${i + 1}</b><br>Alt ${Math.round(P[3 * i + 1])} m<br>Speed ${Math.hypot(V[3 * i], V[3 * i + 1], V[3 * i + 2]).toFixed(1)} m/s<br>${p[0].toFixed(5)}, ${p[1].toFixed(5)}`; }
function updateMapMarkers() {
  if (!MAP.api || S.view !== 'map') return; const pa = replay.on ? replay.cur.p : P, al = replay.on ? replay.cur.a : alive, list = []; const stp = Math.max(1, Math.ceil(S.n / 120));
  const L = leaderIdx(); if (L >= 0) list.push(L); for (let i = 0; i < S.n && list.length < 120; i += stp) if (al[i] && i !== L) list.push(i);
  while (MAP.drones.length > list.length) MAP.drones.pop().remove();
  list.forEach((idx, k) => { const p = w2ll(pa[3 * idx], pa[3 * idx + 2]); if (!MAP.drones[k]) MAP.drones[k] = MAP.api.marker(p[0], p[1], { r: k === 0 ? 7 : 4, color: k === 0 ? '#ffd400' : '#ffffff', z: 3, title: 'Drone', pop: () => droneInfo(MAP.idxs[k]) }); else MAP.drones[k].move(p[0], p[1]); MAP.idxs[k] = idx; });
}
function centroid(pa) { let x = 0, y = 0, z = 0, c = 0; const al = replay.on ? replay.cur.a : alive; for (let i = 0; i < S.n; i++) if (al[i]) { x += pa[3 * i]; y += pa[3 * i + 1]; z += pa[3 * i + 2]; c++; } return c ? [x / c, y / c, z / c] : [0, 40, 0]; }

/* ---------------- VR / AR ---------------- */
const XR = { active: false, type: '', session: null, fallback: false, stream: null, yaw: 0, pitch: 0, dev: null };
const stereo = new THREE.StereoCamera(), zee = new THREE.Vector3(0, 0, 1), eu = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5)), qy = new THREE.Quaternion(), devQ = new THREE.Quaternion();
let controller = null;
function onOrient(e) { if (e.alpha == null) return; const D = Math.PI / 180, o = (screen.orientation && screen.orientation.angle || 0) * D;
  eu.set(e.beta * D, e.alpha * D, -e.gamma * D, 'YXZ'); devQ.setFromEuler(eu).multiply(q1).multiply(q0.setFromAxisAngle(zee, -o)); XR.dev = true; }
function setAR(on) {
  scene.background = null; root.scale.setScalar(on ? .02 : 1); root.position.set(0, on ? -.5 : 0, on ? -2 : 0);
  envG.children.forEach(c => { if (c.name === 'ground' || c.name === 'grid') c.visible = !on; }); applyAtmos(); renderer.setClearAlpha(on ? 0 : 1);
}
async function enterXR(type) {
  if (XR.active) await exitXR(true); XR.type = type; XR.active = true; stage.classList.add('xr');
  const mode = type === 'vr' ? 'immersive-vr' : 'immersive-ar'; let ok = false;
  try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported(mode)); } catch (e) { }
  if (type === 'ar') setAR(true); else applyAtmos();
  if (ok) {
    try {
      const sess = await navigator.xr.requestSession(mode, { optionalFeatures: ['local', 'local-floor'] });
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local'); await renderer.xr.setSession(sess); XR.session = sess; XR.fallback = false;
      sess.addEventListener('end', () => { if (XR.active) exitXR(false); });
      if (type === 'ar') { controller = renderer.xr.getController(0); scene.add(controller); controller.addEventListener('select', () => { const p = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(controller.matrixWorld); root.position.copy(p).addScaledVector(d, 1.5); root.position.y -= .3; log('Swarm repositioned'); }); }
      else { const f = S.fwd; rig.rotation.y = Math.atan2(-f[0], -f[1]); }
      log(`WebXR ${type.toUpperCase()} session started`); $('viewHint').style.display = 'block'; $('viewHint').textContent = type === 'ar' ? 'Tap to place the swarm in front of you.' : 'Looking from the selected drone.'; return;
    } catch (e) { log(`WebXR ${type.toUpperCase()} could not start (${e.message}). Using browser fallback.`, 'warning'); renderer.xr.enabled = false; }
  } else log(`WebXR ${type.toUpperCase()} not supported here. Using browser fallback.`, 'info');
  XR.fallback = true; XR.yaw = Math.atan2(-S.fwd[0], -S.fwd[1]); XR.pitch = 0; XR.dev = null;
  try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (e) { }
  window.addEventListener('deviceorientation', onOrient);
  if (type === 'vr') { stage.classList.add('stereo'); try { await $('viewPanel').requestFullscreen(); } catch (e) { } $('viewHint').textContent = 'Split-screen VR for a phone headset. Drag or tilt the device to look around.'; }
  else {
    $('viewHint').textContent = 'Camera passthrough AR. Drag or tilt the device to look around.';
    try { XR.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); const v = $('arVideo'); v.srcObject = XR.stream; v.style.display = 'block'; v.play().catch(() => { }); }
    catch (e) { log('Camera unavailable for AR passthrough (needs https or localhost, and permission). Showing virtual scene only.', 'warning'); setAR(true); scene.background = new THREE.Color(0x0a0a0a); renderer.setClearAlpha(1); }
  }
  $('viewHint').style.display = 'block'; onResize();
}
async function exitXR(keepView) {
  if (!XR.active) return; XR.active = false; if (XR.session) { try { await XR.session.end(); } catch (e) { } XR.session = null; }
  if (controller) { scene.remove(controller); controller = null; }
  renderer.xr.enabled = false; rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); camera.quaternion.identity();
  window.removeEventListener('deviceorientation', onOrient); if (XR.stream) { XR.stream.getTracks().forEach(t => t.stop()); XR.stream = null; } $('arVideo').style.display = 'none';
  if (document.fullscreenElement && document.fullscreenElement === $('viewPanel')) document.exitFullscreen().catch(() => { });
  stage.classList.remove('xr', 'stereo'); $('viewHint').style.display = 'none'; if (envG) setAR(false); renderer.setClearAlpha(1); XR.type = ''; onResize();
  if (!keepView) setView('tpv');
}
function renderStereo() { const sz = renderer.getSize(new THREE.Vector2()), w = sz.x / 2, h = sz.y; camera.updateMatrixWorld(); stereo.update(camera);
  renderer.setScissorTest(true); renderer.setScissor(0, 0, w, h); renderer.setViewport(0, 0, w, h); renderer.render(scene, stereo.cameraL);
  renderer.setScissor(w, 0, w, h); renderer.setViewport(w, 0, w, h); renderer.render(scene, stereo.cameraR); renderer.setScissorTest(false); renderer.setViewport(0, 0, sz.x, sz.y); }

/* ---------------- views / camera ---------------- */
const orb = { tpv: { yaw: .6, pitch: .45, dist: 150 }, swarm: { yaw: 0, pitch: 1.5, dist: 240 } };
function setView(v) {
  if ((v === 'vr' || v === 'ar')) { S.view = v; markView(); enterXR(v); return; }
  if (XR.active) exitXR(true); S.view = v; markView(); const m = v === 'map';
  $('mapWrap').style.display = m ? 'block' : 'none'; canvas.style.display = m ? 'none' : 'block'; stage.classList.toggle('map', m);
  $('viewHint').style.display = 'none'; camera.fov = v === 'fpv' ? 78 : 62; camera.updateProjectionMatrix();
  if (m) initMap().then(() => { if (MAP.api) { MAP.api.resize(); const c = centroid(P), p = w2ll(c[0], c[2]); MAP.api.center(p[0], p[1]); $('mapBadge').textContent = 'Map: ' + MAP.api.name; updateMapMarkers(); } });
}
const markView = () => document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
function updateCamera(pa) {
  if (XR.active && !XR.fallback) { // WebXR: move the rig, headset drives the camera
    const s = S.selected, c = centroid(pa);
    if (XR.type === 'vr') rig.position.lerp(new THREE.Vector3(pa[3 * s], pa[3 * s + 1] + 1.5, pa[3 * s + 2]), .15); return;
  }
  const c = centroid(pa), s = S.selected;
  if (XR.active && XR.fallback) {
    if (XR.type === 'vr') camera.position.set(pa[3 * s], pa[3 * s + 1] + 1.5, pa[3 * s + 2]); else camera.position.set(0, 0, 0);
    qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), XR.yaw);
    if (XR.dev) camera.quaternion.copy(qy).multiply(devQ); else { eu.set(XR.pitch, XR.yaw, 0, 'YXZ'); camera.quaternion.setFromEuler(eu); }
    return;
  }
  if (S.view === 'fpv') { const f = S.fwd, tx = V[3 * s], tz = V[3 * s + 2], sp = Math.hypot(tx, tz), fx = sp > .5 ? tx / sp : f[0], fz = sp > .5 ? tz / sp : f[1];
    camera.position.set(pa[3 * s] - fx * 2, pa[3 * s + 1] + 3, pa[3 * s + 2] - fz * 2); camera.lookAt(pa[3 * s] + fx * 40, pa[3 * s + 1] - 2, pa[3 * s + 2] + fz * 40); }
  else if (S.view === 'swarm' || S.view === 'tpv') { const o = orb[S.view]; camera.position.set(c[0] + Math.cos(o.pitch) * Math.sin(o.yaw) * o.dist, c[1] + Math.sin(o.pitch) * o.dist, c[2] + Math.cos(o.pitch) * Math.cos(o.yaw) * o.dist); camera.lookAt(c[0], c[1], c[2]); }
}
function onResize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h || (XR.active && !XR.fallback)) return; renderer.setSize(w, h, false); camera.aspect = XR.fallback && XR.type === 'vr' ? (w / 2) / h : w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(onResize).observe(stage); document.addEventListener('fullscreenchange', () => setTimeout(onResize, 80));
// pointer input: drag = orbit/look, wheel = zoom, click = place waypoint
let drag = null; const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -55);
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  if (XR.active && XR.fallback) { XR.yaw -= dx * .004; XR.pitch = Math.max(-1.4, Math.min(1.4, XR.pitch - dy * .004)); }
  else if (orb[S.view]) { orb[S.view].yaw -= dx * .006; if (S.view === 'tpv') orb.tpv.pitch = Math.max(.05, Math.min(1.45, orb.tpv.pitch + dy * .005)); } });
canvas.addEventListener('pointerup', e => { if (drag && drag.moved < 5 && S.placeMode && !XR.active) { const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = new THREE.Vector3(); if (ray.ray.intersectPlane(plane, hit) && hit.length() < 1500) addWaypoint(hit.x, 55, hit.z); else log('Click landed outside the area. Aim at the ground.', 'warning'); } drag = null; });
canvas.addEventListener('wheel', e => { const o = orb[S.view]; if (o) { e.preventDefault(); o.dist = Math.max(25, Math.min(1000, o.dist * (1 + Math.sign(e.deltaY) * .1))); } }, { passive: false });

/* ---------------- analytics ---------------- */
const coverage = new Set(), heat = $('heatmapCanvas'), mini = $('minimapCanvas').getContext('2d');
const vChart = new Chart($('velocityChart'), { type: 'line', data: { labels: [], datasets: [{ label: 'Average velocity (m/s)', data: [], borderColor: '#ffd400', backgroundColor: 'rgba(255,212,0,.12)', fill: true, tension: .3, pointRadius: 0, borderWidth: 3 }] },
  options: { animation: false, maintainAspectRatio: false, scales: { x: { display: false }, y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#999' } } }, plugins: { legend: { labels: { color: '#ddd' } } } } });
const pChart = new Chart($('positionChart'), { type: 'scatter', data: { datasets: [{ label: 'Drone positions (x, z)', data: [], backgroundColor: '#ffffff', pointRadius: 2 }] },
  options: { animation: false, maintainAspectRatio: false, scales: { x: { grid: { color: '#222' }, ticks: { color: '#999' } }, y: { grid: { color: '#222' }, ticks: { color: '#999' } } }, plugins: { legend: { labels: { color: '#ddd' } } } } });
let chartT = 0;
function signal() { const c = centroid(P); let s = 100 - S.latency / 500 * 25 - (S.loss + (S.lossBoost > 0 ? 50 : 0)) * .5 - Math.hypot(c[0], c[2]) / 1500 * 20 - (S.commDown > 0 ? 60 : 0); return Math.max(5, Math.min(100, s)); }
function analytics(dt) {
  const al = replay.on ? replay.cur.a : alive, pa = replay.on ? replay.cur.p : P; let ac = 0, sv = 0;
  for (let i = 0; i < S.n; i++) if (al[i]) { ac++; sv += Math.hypot(V[3 * i], V[3 * i + 1], V[3 * i + 2]); coverage.add(Math.floor(pa[3 * i] / 25) * 100003 + Math.floor(pa[3 * i + 2] / 25)); }
  const sg = Math.round(signal()), cov = coverage.size * 625 / 1e6;
  $('activeDrones').textContent = ac; $('signalStrength').textContent = sg + '%'; $('collisionsAvoided').textContent = S.collisions; $('coverageArea').textContent = cov.toFixed(2) + ' km²';
  const hc = heat.getContext('2d'); hc.fillStyle = 'rgba(255,212,0,.12)'; for (let i = 0; i < S.n; i += Math.ceil(S.n / 250)) if (al[i]) hc.fillRect(150 + pa[3 * i] * .35 - 2, 150 + pa[3 * i + 2] * .35 - 2, 4, 4);
  // scores
  let fa = 0, fc = 0; for (let i = 0; i < S.n; i++) if (al[i]) { if (SE[i] >= 0) { fa += Math.max(0, 1 - SE[i] / (S.spacing * 2)); fc++; } else { fa += Math.min(1, CN[i] / 4); fc++; } }
  fa = fc ? fa / fc * 100 : 0; const col2 = Math.max(0, 100 - S.hits / Math.max(1, S.n) * 100 - S.collisions * .02), comp = S.waypoints.length ? Math.round(S.reached / S.waypoints.length * 100) : 0;
  const tot = Math.round(fa * .3 + col2 * .3 + sg * .2 + comp * .2);
  $('formationScore').textContent = Math.round(fa) + '%'; $('collisionScore').textContent = Math.round(col2) + '%'; $('commScore').textContent = sg + '%'; $('completionScore').textContent = comp + '%'; $('missionScore').textContent = tot;
  chartT += dt; if (chartT >= .5) { chartT = 0; const d = vChart.data; d.labels.push(fmt(S.time)); d.datasets[0].data.push(+(ac ? sv / ac : 0).toFixed(2)); if (d.labels.length > 60) { d.labels.shift(); d.datasets[0].data.shift(); }
    const pts = [], st = Math.max(1, Math.ceil(S.n / 150)); for (let i = 0; i < S.n; i += st) if (al[i]) pts.push({ x: +pa[3 * i].toFixed(1), y: +pa[3 * i + 2].toFixed(1) }); pChart.data.datasets[0].data = pts; vChart.update('none'); pChart.update('none'); }
}
function hud() {
  const pa = replay.on ? replay.cur.p : P, s = S.selected, p = w2ll(pa[3 * s], pa[3 * s + 2]), sp = Math.hypot(V[3 * s], V[3 * s + 1], V[3 * s + 2]);
  $('droneId').textContent = '#' + (s + 1); $('altitude').textContent = Math.round(pa[3 * s + 1]) + ' m'; $('speed').textContent = sp.toFixed(1) + ' m/s'; $('battery').textContent = Math.max(0, Math.round(S.battery - (s % 7) * .3)) + '%'; $('gps').textContent = p[0].toFixed(4) + ', ' + p[1].toFixed(4);
  $('heading').textContent = String(Math.round((Math.atan2(S.fwd[0], -S.fwd[1]) * 180 / Math.PI + 360) % 360)).padStart(3, '0') + '°';
  const c = centroid(pa), T = S.recall && !S.recovered ? BASE_T : S.missionActive ? S.waypoints[S.wpIndex] : null, lk = T && Math.hypot(T[0] - c[0], T[2] - c[2]) < 80;
  $('targetLock').textContent = lk ? 'Locked' : 'No lock'; $('targetLock').classList.toggle('on', !!lk);
  const m = S.recall ? (S.recovered ? 'Recovered' : 'Recalling') : S.complete ? 'Complete' : S.running ? (S.missionActive ? 'Active' : 'Holding') : 'Paused'; $('missionName').textContent = replay.on ? 'Replay' : S.time === 0 && !S.running ? 'Standby' : m;
  // minimap
  const R = 300, k = 75 / R, g = mini; g.fillStyle = '#000'; g.fillRect(0, 0, 150, 150); g.strokeStyle = '#222'; g.beginPath(); g.moveTo(75, 0); g.lineTo(75, 150); g.moveTo(0, 75); g.lineTo(150, 75); g.stroke();
  const X = x => 75 + (x - c[0]) * k, Z = z => 75 + (z - c[2]) * k;
  g.fillStyle = '#444'; obstacles.forEach(o => { g.beginPath(); g.arc(X(o.x), Z(o.z), Math.max(1.5, o.r * k), 0, 6.28); g.fill(); }); g.strokeStyle = '#ff3b30'; obstacles.filter(o => o.k === 'sph').forEach(o => { g.beginPath(); g.arc(X(o.x), Z(o.z), o.r * k, 0, 6.28); g.stroke(); });
  g.fillStyle = '#ffd400'; S.waypoints.forEach((w, i) => { if (i >= S.wpIndex) g.fillRect(X(w[0]) - 3, Z(w[2]) - 3, 6, 6); });
  g.fillStyle = '#fff'; const st = Math.max(1, Math.ceil(S.n / 200)); const al = replay.on ? replay.cur.a : alive; for (let i = 0; i < S.n; i += st) if (al[i]) g.fillRect(X(pa[3 * i]) - 1, Z(pa[3 * i + 2]) - 1, 2, 2);
}

/* ---------------- replay ---------------- */
function syncTimeline() { const t = $('replayTimeline'); t.max = Math.max(1, rec.length - 1); if (!replay.on) t.value = rec.length - 1; }
function enterReplay(at) { if (rec.length < 2) { log('Nothing recorded yet. Start the mission first.', 'warning'); return false; } replay.on = true; replay.idx = at == null ? 0 : at; replay.cur = rec[Math.round(replay.idx)]; return true; }
function setReplaySpeed(s) { replay.speed = s; $('replaySpeed').textContent = s + 'x'; }
function leaveReplay() { if (!replay.on) return; replay.on = false; replay.playing = false; $('replayPlayBtn').textContent = '▶'; CS.fill(-1); }
function advanceReplay(dt) { if (replay.playing) { replay.idx += replay.speed * dt * 5; if (replay.idx >= rec.length - 1) { replay.idx = rec.length - 1; replay.playing = false; $('replayPlayBtn').textContent = '▶'; } if (replay.idx < 0) { replay.idx = 0; replay.playing = false; $('replayPlayBtn').textContent = '▶'; } $('replayTimeline').value = replay.idx; }
  replay.cur = rec[Math.max(0, Math.min(rec.length - 1, Math.round(replay.idx)))]; }

/* ---------------- UI wiring ---------------- */
const bind = (id, key, lbl, fmtv = v => v, after) => { const el = $(id); el.addEventListener('input', () => { S[key] = parseFloat(el.value); $(lbl).textContent = fmtv(S[key]); after && after(); }); };
bind('swarmSpeed', 'speed', 'swarmSpeedValue'); bind('spacing', 'spacing', 'spacingValue', v => v, computeOffsets); bind('commLatency', 'latency', 'commLatencyValue'); bind('packetLoss', 'loss', 'packetLossValue');
bind('separationWeight', 'wSep', 'separationWeightValue', v => v.toFixed(1)); bind('alignmentWeight', 'wAli', 'alignmentWeightValue', v => v.toFixed(1)); bind('cohesionWeight', 'wCoh', 'cohesionWeightValue', v => v.toFixed(1)); bind('goalWeight', 'wGoal', 'goalWeightValue', v => v.toFixed(1));
$('droneCount').addEventListener('input', e => $('droneCountValue').textContent = e.target.value);
$('droneCount').addEventListener('change', e => { S.n = parseInt(e.target.value); createSwarm(); });
$('formationType').onchange = e => { S.formation = e.target.value; computeOffsets(); S.anchor = centroid(P); log('Formation changed to ' + e.target.selectedOptions[0].text); };
$('behaviorMode').onchange = e => { S.mode = e.target.value; S.anchor = centroid(P); log('Behavior mode: ' + e.target.selectedOptions[0].text); };
$('startMissionBtn').onclick = () => { leaveReplay(); if (!S.waypoints.length) log('No waypoints set. The swarm will hold formation until you add one.', 'warning'); if (S.complete || S.wpIndex >= S.waypoints.length) { S.wpIndex = 0; S.reached = 0; S.complete = false; }
  S.running = true; S.missionActive = true; S.recall = false; S.recovered = false; S.anchor = centroid(P); renderWps(); log('Mission started'); };
$('pauseMissionBtn').onclick = () => { leaveReplay(); S.running = !S.running; log(S.running ? 'Mission resumed' : 'Mission paused', S.running ? 'info' : 'warning'); $('pauseMissionBtn').textContent = S.running ? 'Pause' : 'Resume'; };
$('recallBtn').onclick = () => { leaveReplay(); S.running = true; S.recall = true; S.recovered = false; S.missionActive = false; $('pauseMissionBtn').textContent = 'Pause'; log('Recall issued: all drones returning to base', 'warning'); };
$('regroupBtn').onclick = () => { leaveReplay(); S.running = true; S.recall = false; S.missionActive = false; S.anchor = centroid(P); $('pauseMissionBtn').textContent = 'Pause'; log('Regroup issued: reforming ' + S.formation + ' formation'); renderWps(); };
$('addWaypointBtn').onclick = () => addWaypoint((Math.random() - .5) * 600, 40 + Math.random() * 50, (Math.random() - .5) * 600);
$('placeWpBtn').onclick = e => { S.placeMode = !S.placeMode; e.target.textContent = 'Click to place: ' + (S.placeMode ? 'on' : 'off'); e.target.classList.toggle('on', S.placeMode); log(S.placeMode ? 'Waypoint placement on: click the 3D view (aim at the ground) or the map' : 'Waypoint placement off'); };
$('clearWpBtn').onclick = () => { S.waypoints = []; S.wpIndex = 0; S.reached = 0; S.complete = false; renderWps(); log('All waypoints cleared'); };
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll('#tabSeg button').forEach(b => b.onclick = () => { document.querySelectorAll('#tabSeg button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === b.dataset.tab)); });
$('terrainChip').onclick = () => { S.terrain = { urban: 'desert', desert: 'mountain', mountain: 'urban' }[S.terrain]; buildEnv(); applyAtmos(); log('Terrain: ' + S.terrain); };
$('todChip').onclick = () => { S.tod = { day: 'dusk', dusk: 'night', night: 'day' }[S.tod]; applyAtmos(); log('Time of day: ' + S.tod); };
$('weatherChip').onclick = () => { S.weather = { clear: 'fog', fog: 'rain', rain: 'storm', storm: 'clear' }[S.weather]; applyAtmos(); log('Weather: ' + S.weather + (S.weather === 'storm' ? ' (wind pushes the swarm)' : ''), S.weather === 'storm' ? 'warning' : 'info'); };
$('simSpeedBtn').onclick = () => { S.simSpeed = { .5: 1, 1: 2, 2: 4, 4: .5 }[S.simSpeed]; $('simSpeed').textContent = S.simSpeed.toFixed(1) + 'x'; };
$('recenterBtn').onclick = () => { if (MAP.api) { const c = centroid(P), p = w2ll(c[0], c[2]); MAP.api.center(p[0], p[1]); } };
$('exitXrBtn').onclick = () => exitXR(false);
$('fullscreenBtn').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { });
$('clearEventsBtn').onclick = () => { events.length = 0; $('eventLog').innerHTML = ''; };
$('exportEventsBtn').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ exported: new Date().toISOString(), events }, null, 2)], { type: 'application/json' })); a.download = 'swarm-events.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$('replayPlayBtn').onclick = () => { if (!replay.on && !enterReplay(0)) return; if (replay.playing) { replay.playing = false; $('replayPlayBtn').textContent = '▶'; } else { if (replay.idx >= rec.length - 1 && replay.speed > 0) replay.idx = 0; replay.playing = true; $('replayPlayBtn').textContent = '❚❚'; log('Replay playing. Press Start or Regroup to return to live.'); } };
$('replayBackBtn').onclick = () => { if (!replay.on && !enterReplay(rec.length - 1)) return; setReplaySpeed(replay.speed > 0 ? -1 : Math.max(-4, replay.speed * 2)); replay.playing = true; $('replayPlayBtn').textContent = '❚❚'; };
$('replayForwardBtn').onclick = () => { if (!replay.on && !enterReplay(0)) return; setReplaySpeed(replay.speed < 0 ? 1 : Math.min(4, replay.speed * 2)); replay.playing = true; $('replayPlayBtn').textContent = '❚❚'; };
$('replayTimeline').oninput = e => { if (!replay.on && !enterReplay(+e.target.value)) return; replay.idx = +e.target.value; replay.playing = false; $('replayPlayBtn').textContent = '▶'; };
$('simulateCommFailure').onclick = () => { const D = delayed(), L = leaderIdx(); S.frozen = [D.p[3 * L], D.p[3 * L + 1], D.p[3 * L + 2]]; S.commDown = 8; log('Communication failure injected (8 s). Drones fall back to onboard sensors.', 'error'); };
$('simulateNodeFailure').onclick = () => { let k = Math.max(1, Math.round(aliveCount() * .05)), c = 0; while (k > 0 && aliveCount() > 1) { const i = Math.floor(Math.random() * S.n); if (alive[i]) { alive[i] = 0; k--; c++; } } if (!alive[S.selected]) S.selected = leaderIdx(); log(`Node failure: ${c} drone(s) lost`, 'error'); };
$('simulatePacketLoss').onclick = () => { S.lossBoost = 8; log('Packet loss burst injected (50% for 8 s)', 'warning'); };
// settings dialog
const dlg = $('settingsDlg'); $('settingsBtn').onclick = () => { $('cfgKey').value = CFG.GOOGLE_MAPS_API_KEY; $('cfgProv').value = CFG.MAP_PROVIDER; $('cfgLat').value = CFG.BASE_LAT; $('cfgLng').value = CFG.BASE_LNG; dlg.showModal(); };
$('settingsForm').addEventListener('submit', e => { if (e.submitter && e.submitter.value === 'save') { localStorage.setItem('swarmCfg', JSON.stringify({ GOOGLE_MAPS_API_KEY: $('cfgKey').value.trim(), MAP_PROVIDER: $('cfgProv').value, BASE_LAT: parseFloat($('cfgLat').value) || 37.7749, BASE_LNG: parseFloat($('cfgLng').value) || -122.4194 })); setTimeout(() => location.reload(), 50); } });
window.addEventListener('keydown', e => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || dlg.open) return;
  const k = e.key; if (k === ' ') { e.preventDefault(); $('pauseMissionBtn').click(); } else if (k === 'Enter') $('startMissionBtn').click(); else if (k === 'r') $('recallBtn').click(); else if (k === 'g') $('regroupBtn').click();
  else if ('123456'.includes(k) && k) setView(['fpv', 'tpv', 'swarm', 'map', 'vr', 'ar'][+k - 1]); else if (k === ']' || k === '[') { let i = S.selected; for (let t = 0; t < S.n; t++) { i = (i + (k === ']' ? 1 : S.n - 1)) % S.n; if (alive[i]) break; } S.selected = i; CS.fill(-1); } else if (k === 'Escape' && XR.active) exitXR(false); });
setInterval(() => { $('timeDisplay').textContent = new Date().toLocaleTimeString('en-GB'); }, 1000); setInterval(updateMapMarkers, 250);

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock(); let accA = 0, accH = 0, frames = 0, fpsT = 0;
function loop() {
  const dt = Math.min(.05, clock.getDelta()); frames++; fpsT += dt; if (fpsT >= 1) { $('fpsCounter').textContent = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  if (S.running && !replay.on) { const sub = Math.ceil(S.simSpeed), d = dt * S.simSpeed / sub; for (let i = 0; i < sub; i++) step(d); } else if (replay.on) advanceReplay(dt);
  const pa = replay.on ? replay.cur.p : P, aa = replay.on ? replay.cur.a : alive;
  drawDrones(pa, aa); const c = centroid(pa);
  if (rain.visible) { rain.position.set(c[0], 0, c[2]); const a = rainG.attributes.position; for (let i = 0; i < 2400; i++) { let y = a.array[i * 6 + 1] - 110 * dt; if (y < 0) y += 220; a.array[i * 6 + 1] = y; a.array[i * 6 + 4] = y - 6; } a.needsUpdate = true; }
  updateCamera(pa);
  if (XR.fallback && XR.type === 'vr') renderStereo(); else renderer.render(scene, camera);
  accA += dt; accH += dt; if (accH > .1) { accH = 0; hud(); } if (accA > .2) { analytics(accA); accA = 0; }
}

/* ---------------- boot ---------------- */
S.waypoints = [[180, 55, -160], [-120, 70, -320], [-260, 50, 40]];
buildEnv(); applyAtmos(); createSwarm(true); renderWps(); onResize();
renderer.setAnimationLoop(loop);
log('System initialized'); log(`Swarm created: ${S.n} drones, ${S.formation} formation, ${S.mode} mode`);
log(navigator.xr ? 'WebXR API available' : 'WebXR not available in this browser: VR/AR use the built-in fallback', 'info');
log('Press Start to begin the mission. Keys: Space pause, R recall, G regroup, 1-6 views, [ ] switch drone');
})();
