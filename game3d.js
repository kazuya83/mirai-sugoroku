// ミライすごろく 3D盤面（three.js）
// メイン画面のスクリプトから B3.mount / B3.setPositions / B3.effect を呼んで使う。
import * as THREE from "./vendor/three.module.min.js";

const SP = 2.2; // マスの間隔
let CX = 5.5, CY = 4.55; // 盤面の中心（mount時にコースの範囲から決める）
const wx = n => (n.x - CX) * SP;
const wz = n => (n.y - CY) * SP;

let renderer, scene, camera, clock, container, nodes;
let mode = "follow";           // "follow" | "all"
let focusId = null;
const tokens = new Map();      // id -> {group, from, to, t0, dur, hop, rig}
const particles = [];
const camPos = new THREE.Vector3(0, 34, 26), camLook = new THREE.Vector3(0, 0, 1);
let marker, water, sun, bounds, loop;
const cars = [];

// ---------- テクスチャ（画像素材は使わず canvas で描く） ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const grassTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = "#6fae4c"; g.fillRect(0, 0, w, h);
  const r = rng(7);
  for (let i = 0; i < 9000; i++) {
    const x = r() * w, y = r() * h, l = 30 + r() * 25, hue = 85 + r() * 30;
    g.strokeStyle = `hsl(${hue},${45 + r() * 20}%,${l}%)`; g.lineWidth = 1 + r();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 6); g.stroke();
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(60,90,30,${0.08 + r() * 0.1})`; g.beginPath(); g.arc(r() * w, r() * h, 10 + r() * 40, 0, 7); g.fill(); }
}, 14);
const woodTex = () => canvasTex(1024, 1024, (g, w, h) => {
  const r = rng(3);
  for (let y = 0; y < h; y += 128) {
    const base = 30 + r() * 8;
    g.fillStyle = `hsl(28,45%,${base + 30}%)`; g.fillRect(0, y, w, 128);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `hsla(25,40%,${base + 10 + r() * 20}%,${0.25 + r() * 0.3})`; g.lineWidth = 1 + r() * 2;
      g.beginPath(); const yy = y + r() * 128; g.moveTo(0, yy);
      for (let x = 0; x <= w; x += 64) g.lineTo(x, yy + Math.sin(x / 90 + i) * 3 + (r() - 0.5) * 2);
      g.stroke();
    }
    g.fillStyle = "rgba(60,30,10,.35)"; g.fillRect(0, y, w, 3);
  }
});
const stoneTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#cdb58f"; g.fillRect(0, 0, w, h);
  const r = rng(11);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `hsl(35,${20 + r() * 20}%,${58 + r() * 18}%)`;
    g.beginPath(); g.ellipse(r() * w, r() * h, 14 + r() * 16, 10 + r() * 12, r() * 3, 0, 7); g.fill();
    g.strokeStyle = "rgba(90,70,40,.35)"; g.stroke();
  }
}, 1);
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function tileTexture(n, fill) {
  return canvasTex(256, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, "#ffffff"); grd.addColorStop(0.12, fill); grd.addColorStop(1, fill);
    rr(g, 6, 6, 244, 244, 34); g.fillStyle = grd; g.fill();
    g.lineWidth = 6; g.strokeStyle = "rgba(255,255,255,.75)"; g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,.25)"; g.shadowBlur = 8; g.shadowOffsetY = 4;
    g.font = '104px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.fillText(n.icon, 128, 108);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = "#3b2f25"; g.font = 'bold 34px "Hiragino Sans","Noto Sans JP",sans-serif';
    g.fillText(n.label.length > 7 ? n.label.slice(0, 7) : n.label, 128, 214);
  });
}
function textSprite(text, color) {
  const t = canvasTex(512, 128, g => {
    g.font = 'bold 72px "Hiragino Sans","Noto Sans JP",sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 12; g.strokeStyle = "#fff"; g.strokeText(text, 256, 64);
    g.fillStyle = color; g.fillText(text, 256, 64);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(4, 1, 1); s.renderOrder = 10;
  return s;
}
const blobTex = () => canvasTex(128, 128, g => {
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62); grd.addColorStop(0, "rgba(0,0,0,.5)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});
let BLOB;

// 角の丸いブロック（マス・家）
function roundedBox(w, h, d, r, mat) {
  const s = new THREE.Shape(); const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d); s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, 0.04, 0);
  return new THREE.Mesh(geo, mat);
}

// ---------- 世界 ----------
function buildSky() {
  const geo = new THREE.SphereGeometry(320, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color("#4a9be8") }, bottom: { value: new THREE.Color("#e8f4ff") } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = max(vP.y,0.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.6)),1.0); }"
  });
  return new THREE.Mesh(geo, mat);
}
function buildWorld(typeColor) {
  const sky = buildSky(); scene.add(sky);
  // 空を映り込み用の環境マップにする（金属やつやのある素材がリアルに見える）
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(buildSky());
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.5, 4.5) }));
  sunBall.position.set(-60, 90, 40); envScene.add(sunBall);
  scene.environment = pm.fromScene(envScene, 0.04).texture;
  scene.fog = new THREE.Fog("#dcecf7", 90, 230);

  scene.add(new THREE.HemisphereLight("#dff1ff", "#6b8f4a", 0.6));
  sun = new THREE.DirectionalLight("#fff1d6", 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  scene.add(sun); scene.add(sun.target);

  // 町の範囲
  const xs = Object.values(nodes).map(wx), zs = Object.values(nodes).map(wz);
  const X0 = Math.min(...xs) - 6, X1 = Math.max(...xs) + 6, Z0 = Math.min(...zs) - 6, Z1 = Math.max(...zs) + 6;
  const TM = 14; // 町の外側の幅
  bounds = { X0, X1, Z0, Z1 };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 0.95 }));
  ground.material.map.repeat.set(80, 80);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // 歩道（町の地面）
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + TM * 2, Z1 - Z0 + TM * 2), new THREE.MeshStandardMaterial({ map: paveTex(), roughness: 0.9 }));
  pave.material.map.repeat.set((X1 - X0 + TM * 2) / 3, (Z1 - Z0 + TM * 2) / 3);
  pave.rotation.x = -Math.PI / 2; pave.position.set((X0 + X1) / 2, 0.01, (Z0 + Z1) / 2); pave.receiveShadow = true; scene.add(pave);

  // 道路：すごろくのコースそのものが町の道。白い破線つきのアスファルト。
  const segs = [];
  const rTex = roadTex();
  const addRoad = (x1, z1, x2, z2, w, y) => {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const t = rTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(len / 2.2)), 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + w * 0.5, w), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(dz, dx);
    m.position.set((x1 + x2) / 2, y || 0.03, (z1 + z2) / 2); m.receiveShadow = true; scene.add(m);
    segs.push([x1, z1, x2, z2, w / 2]);
  };
  for (const n of Object.values(nodes)) for (const id of n.next) { const m = nodes[id]; addRoad(wx(n), wz(n), wx(m), wz(m), 2.3); }
  // 町をぐるっと回る外周道路（車が走る）
  loop = [[X0 - 2, Z0 - 2], [X1 + 2, Z0 - 2], [X1 + 2, Z1 + 2], [X0 - 2, Z1 + 2]];
  for (let i = 0; i < 4; i++) { const a = loop[i], b = loop[(i + 1) % 4]; addRoad(a[0], a[1], b[0], b[1], 3, 0.025); }
  // 外側の通り
  for (const z of [Z0 - 2 - 9, Z1 + 2 + 9]) addRoad(X0 - TM, z, X1 + TM, z, 2.6, 0.025);
  for (const x of [X0 - 2 - 9, X1 + 2 + 9]) addRoad(x, Z0 - TM, x, Z1 + TM, 2.6, 0.025);

  // マス（つやのあるボードゲームの駒のような質感）
  const BASE = 0.06;
  for (const n of Object.values(nodes)) {
    const neg = n.type === "money" && n.amount < 0;
    const fill = typeColor[n.type] || (neg ? "#ffd6d6" : "#d3f9d8");
    const h = n.stop ? 0.42 : 0.24;
    const col = new THREE.Color(fill).multiplyScalar(0.85);
    const body = roundedBox(1.72, h, 1.72, 0.22, new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
    body.position.set(wx(n), BASE, wz(n)); body.castShadow = body.receiveShadow = true; scene.add(body);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 1.62), new THREE.MeshPhysicalMaterial({ map: tileTexture(n, fill), transparent: true, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
    top.rotation.x = -Math.PI / 2; top.position.set(wx(n), BASE + h + 0.005, wz(n)); top.receiveShadow = true; scene.add(top);
    if (n.stop) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: "#f76707", metalness: 0.6, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2; ring.position.set(wx(n), BASE + 0.07, wz(n)); ring.castShadow = true; scene.add(ring);
    }
    n._top = BASE + h;
    if (n.type === "goal") {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 12), new THREE.MeshStandardMaterial({ color: "#ced4da", metalness: 0.9, roughness: 0.2 }));
      pole.position.set(wx(n) + 0.65, n._top + 1.3, wz(n) - 0.65); pole.castShadow = true; scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.62, 8, 4), new THREE.MeshStandardMaterial({ map: canvasTex(128, 80, g => { for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#fff"; g.fillRect(i * 16, j * 16, 16, 16); } }), side: THREE.DoubleSide }));
      flag.position.set(wx(n) + 1.15, n._top + 2.25, wz(n) - 0.65); flag.castShadow = true; flag.userData.flag = true; scene.add(flag);
      n._flag = flag;
    }
  }

  // ---------- 建物の配置：道路から離れた空き地に、家・お店・マンション・ビルを建てる ----------
  const r = rng(42);
  const segDist = (x, z) => {
    let best = 1e9;
    for (const [x1, z1, x2, z2, hw] of segs) {
      const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - x1) * dx + (z - z1) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)) - hw;
      if (d < best) best = d;
    }
    return best;
  };
  const inner = (x, z) => x > X0 && x < X1 && z > Z0 && z < Z1;
  const cands = [];
  for (let x = X0 - TM + 1; x < X1 + TM - 1; x += 0.7) for (let z = Z0 - TM + 1; z < Z1 + TM - 1; z += 0.7) {
    const d = segDist(x, z); if (d < 0.9) continue;
    cands.push({ x, z, d, k: r() });
  }
  cands.sort((a, b) => b.d - a.d || a.k - b.k);
  const placed = [];
  const kinds = { house: [], shop: [], apt: [], office: [], tall: [], tree: [], lamp: [] };
  const RAD = { house: 1.05, shop: 1.1, apt: 1.35, office: 1.5, tall: 1.5, tree: 0.6 };
  const free = (x, z, rad) => { for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.rad + rad) return false; return true; };
  for (const c of cands) {
    let kind;
    if (inner(c.x, c.z)) { const q = r(); kind = q < 0.55 ? "house" : q < 0.75 ? "shop" : q < 0.88 ? "apt" : "tree"; }
    else if (c.z > Z1) kind = r() < 0.7 ? "house" : "tree"; // 手前（カメラ側）は低い建物
    else { const q = r(); kind = q < 0.35 ? "apt" : q < 0.65 ? "office" : q < 0.85 ? "tall" : "tree"; }
    let rad = RAD[kind];
    if (c.d < rad + 0.25) { if (c.d >= 0.85 && kind !== "tree") { kind = "tree"; rad = RAD.tree; } else continue; }
    if (!free(c.x, c.z, rad)) continue;
    // 正面を一番近い道路に向ける
    let ang = 0, bd = 1e9;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const d = segDist(c.x + dx * 1.5, c.z + dz * 1.5); if (d < bd) { bd = d; ang = Math.atan2(dx, dz); } }
    placed.push({ x: c.x, z: c.z, rad });
    kinds[kind].push({ x: c.x, z: c.z, ang, s: 0.9 + r() * 0.25, c: r() });
  }
  // 街灯：コースの道沿い
  for (const n of Object.values(nodes)) for (const id of n.next) {
    if (r() > 0.45) continue;
    const m = nodes[id]; const dx = wx(m) - wx(n), dz = wz(m) - wz(n), l = Math.hypot(dx, dz) || 1;
    for (const sgn of [1, -1]) {
      const x = (wx(n) + wx(m)) / 2 - dz / l * 1.45 * sgn, z = (wz(n) + wz(m)) / 2 + dx / l * 1.45 * sgn;
      if (segDist(x, z) > 0.2 && free(x, z, 0.3)) { placed.push({ x, z, rad: 0.3 }); kinds.lamp.push({ x, z, ang: 0, s: 1 }); break; }
    }
  }
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, f, shadow) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, i) => { f(dummy, b, i); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (b._col) im.setColorAt(i, b._col); });
    im.castShadow = shadow !== false; im.receiveShadow = true; scene.add(im);
  };
  const place = (o, b, y, sx, sy, sz) => { o.position.set(b.x, y, b.z); o.rotation.set(0, b.ang, 0); o.scale.set(sx, sy, sz); };
  // 家
  const roofCols = ["#c0392b", "#2f6fa7", "#d68910", "#7d5ba6", "#2e8b57", "#8d5524", "#5c6b73"].map(c => new THREE.Color(c));
  const wallCols = ["#f4ead8", "#fff4e0", "#e8f0f7", "#f7e1d7", "#eef5e9"].map(c => new THREE.Color(c));
  const hs = kinds.house;
  hs.forEach(b => b._col = wallCols[Math.floor(b.c * 5)]);
  inst(new THREE.BoxGeometry(1.7, 1.3, 1.5), new THREE.MeshStandardMaterial({ map: houseTex(), roughness: 0.85 }), hs, (o, b) => place(o, b, 0.65 * b.s, b.s, b.s, b.s));
  const roofGeo = new THREE.CylinderGeometry(0.01, 1.3, 0.9, 4, 1); roofGeo.rotateY(Math.PI / 4); roofGeo.scale(1.0, 1, 0.9);
  hs.forEach(b => b._col = roofCols[Math.floor(b.c * 7)]);
  inst(roofGeo, new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.6 }), hs, (o, b) => place(o, b, (1.3 + 0.45) * b.s, b.s, b.s, b.s));
  // お店（ひさしつき）
  const sh = kinds.shop;
  sh.forEach(b => b._col = wallCols[Math.floor(b.c * 5)]);
  inst(new THREE.BoxGeometry(1.9, 1.6, 1.7), new THREE.MeshStandardMaterial({ map: shopTex(), roughness: 0.7 }), sh, (o, b) => place(o, b, 0.8, 1, 1, 1));
  const awnCols = ["#e03131", "#1c7ed6", "#f59f00", "#2f9e44", "#ae3ec9"].map(c => new THREE.Color(c));
  sh.forEach(b => b._col = awnCols[Math.floor(b.c * 5)]);
  const awnGeo = new THREE.BoxGeometry(1.9, 0.08, 0.6); awnGeo.rotateX(0.35); awnGeo.translate(0, 0, 1.05);
  inst(awnGeo, new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.6 }), sh, (o, b) => place(o, b, 1.15, 1, 1, 1));
  inst(new THREE.BoxGeometry(2.0, 0.12, 1.8), new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.6 }), sh, (o, b) => place(o, b, 1.66, 1, 1, 1));
  // マンション
  const apCols = ["#f1e3d3", "#dfe7ef", "#f3d9c4", "#e6e1f0", "#d9e8dc"].map(c => new THREE.Color(c));
  kinds.apt.forEach(b => b._col = apCols[Math.floor(b.c * 5)]);
  inst(new THREE.BoxGeometry(2.3, 3.6, 2.3), new THREE.MeshStandardMaterial({ map: aptTex(), roughness: 0.8 }), kinds.apt, (o, b) => place(o, b, 1.8, 1, 1, 1));
  // オフィスビル（2種類の高さ）
  const glass = (h) => new THREE.MeshPhysicalMaterial({ map: officeTex(h), roughness: 0.25, metalness: 0.3, clearcoat: 0.6 });
  const ofCols = ["#ffffff", "#e3f2ff", "#e9fbe9", "#fff3e0"].map(c => new THREE.Color(c));
  kinds.office.forEach(b => b._col = ofCols[Math.floor(b.c * 4)]);
  kinds.tall.forEach(b => b._col = ofCols[Math.floor(b.c * 4)]);
  inst(new THREE.BoxGeometry(2.6, 6, 2.6), glass(6), kinds.office, (o, b) => place(o, b, 3, 1, 1, 1));
  inst(new THREE.BoxGeometry(2.6, 10, 2.6), glass(10), kinds.tall, (o, b) => place(o, b, 5, 1, 1, 1));
  // 木
  const trees = kinds.tree;
  trees.forEach(b => b._col = null);
  inst(new THREE.CylinderGeometry(0.1, 0.16, 1, 7), new THREE.MeshStandardMaterial({ color: "#7a4e2d", roughness: 0.9 }), trees, (o, b) => place(o, b, 0.5 * b.s, b.s, b.s, b.s));
  const leafCols = ["#3f8f3a", "#4f9e45", "#2f7a33", "#6aa84f"].map(c => new THREE.Color(c));
  trees.forEach(b => b._col = leafCols[Math.floor(b.c * 4)]);
  inst(new THREE.IcosahedronGeometry(0.62, 1), new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.8, flatShading: true }), trees, (o, b) => place(o, b, 1.35 * b.s, b.s, b.s * 1.1, b.s));
  inst(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.8, flatShading: true }), trees, (o, b) => { place(o, b, 1.85 * b.s, b.s, b.s, b.s); o.position.x += 0.12; });
  // 街灯
  const lamps = kinds.lamp; lamps.forEach(b => b._col = null);
  inst(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6), new THREE.MeshStandardMaterial({ color: "#495057", metalness: 0.7, roughness: 0.4 }), lamps, (o, b) => place(o, b, 0.9, 1, 1, 1));
  inst(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: "#fff8e1", emissive: "#ffe8a3", emissiveIntensity: 0.8 }), lamps, (o, b) => place(o, b, 1.85, 1, 1, 1), false);

  // 外側の森・池・雲
  const outer = (x, z) => x < X0 - TM - 1 || x > X1 + TM + 1 || z < Z0 - TM - 1 || z > Z1 + TM + 1;
  const forest = [];
  for (let i = 0; i < 900 && forest.length < 260; i++) {
    const x = (X0 + X1) / 2 + (r() - 0.5) * (X1 - X0 + TM * 2 + 70), z = (Z0 + Z1) / 2 + (r() - 0.5) * (Z1 - Z0 + TM * 2 + 70);
    if (outer(x, z)) forest.push({ x, z, ang: r() * 6, s: 1.2 + r() * 1.3, c: r() });
  }
  forest.forEach(b => b._col = null);
  inst(new THREE.CylinderGeometry(0.1, 0.16, 1, 7), new THREE.MeshStandardMaterial({ color: "#7a4e2d", roughness: 0.9 }), forest, (o, b) => place(o, b, 0.5 * b.s, b.s, b.s, b.s));
  forest.forEach(b => b._col = leafCols[Math.floor(b.c * 4)]);
  inst(new THREE.ConeGeometry(0.8, 1.8, 8), new THREE.MeshStandardMaterial({ color: "#fff", roughness: 0.8, flatShading: true }), forest, (o, b) => place(o, b, 1.7 * b.s, b.s, b.s, b.s));
  water = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshPhysicalMaterial({ color: "#3b8fd1", roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2; water.position.set(X0 - TM - 9, 0.04, (Z0 + Z1) / 2); water.receiveShadow = true; scene.add(water);
  const cloudM = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 12; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(1.5 + r() * 1.5, 12, 10), cloudM); b.position.set(k * 1.8 - 3.6, r() * 0.8, (r() - 0.5) * 1.5); b.scale.y = 0.6; c.add(b); }
    c.position.set((r() - 0.5) * 160, 34 + r() * 12, Z0 - 20 - r() * 70); c.userData.cloud = 0.3 + r() * 0.5; scene.add(c);
  }
  // 外周道路を走る車
  const carCols = ["#e03131", "#1971c2", "#f2f2f2", "#fab005", "#2b8a3e", "#343a40", "#ae3ec9", "#f76707"];
  const perim = loop.reduce((s, a, i) => { const b = loop[(i + 1) % 4]; return s + Math.hypot(b[0] - a[0], b[1] - a[1]); }, 0);
  for (let i = 0; i < 10; i++) {
    const car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color: carCols[i % carCols.length], roughness: 0.3, metalness: 0.4, clearcoat: 1 });
    const body = roundedBox(1.5, 0.45, 0.75, 0.15, paint); body.position.y = 0.18; body.castShadow = true; car.add(body);
    const cab = roundedBox(0.85, 0.38, 0.68, 0.12, new THREE.MeshPhysicalMaterial({ color: "#a5d8ff", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 })); cab.position.set(-0.08, 0.6, 0); car.add(cab);
    for (const [wx2, wz2] of [[0.48, 0.38], [-0.48, 0.38], [0.48, -0.38], [-0.48, -0.38]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14), new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.8 })); w.rotation.x = Math.PI / 2; w.position.set(wx2, 0.17, wz2); car.add(w); }
    car.userData.car = { d: (perim / 10) * i, v: 3 + r() * 2, perim, lane: i % 2 ? 0.7 : -0.7 };
    scene.add(car); cars.push(car);
  }
  BLOB = blobTex();
  marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshPhysicalMaterial({ color: "#ffd43b", emissive: "#b8860b", emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.2, clearcoat: 1 }));
  marker.scale.y = 1.5; scene.add(marker);
}
// 外周道路に沿って車を動かす
function moveCars(dt) {
  for (const car of cars) {
    const u = car.userData.car; u.d = (u.d + u.v * dt * (u.lane > 0 ? 1 : -1) + u.perim) % u.perim;
    let d = u.d;
    for (let i = 0; i < 4; i++) {
      const a = loop[i], b = loop[(i + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= l) {
        const t = d / l, dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
        car.position.set(a[0] + (b[0] - a[0]) * t - dz * u.lane, 0.03, a[1] + (b[1] - a[1]) * t + dx * u.lane);
        car.rotation.y = Math.atan2(-dz, dx) + (u.lane > 0 ? 0 : Math.PI);
        break;
      }
      d -= l;
    }
  }
}
// ---------- 町のテクスチャ ----------
const paveTex = () => canvasTex(256, 256, g => {
  g.fillStyle = "#cfc9be"; g.fillRect(0, 0, 256, 256);
  const r = rng(5);
  for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { g.fillStyle = `hsl(35,${8 + r() * 8}%,${74 + r() * 8}%)`; g.fillRect(x + 1, y + 1, 30, 30); }
}, 1);
const roadTex = () => canvasTex(256, 128, g => {
  g.fillStyle = "#4a4e54"; g.fillRect(0, 0, 256, 128);
  const r = rng(9);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.05 + r() * 0.08})`; g.fillRect(r() * 256, r() * 128, 2, 2); }
  g.fillStyle = "#e9ecef"; g.fillRect(0, 6, 256, 5); g.fillRect(0, 117, 256, 5);
  g.fillStyle = "#ffd43b"; g.fillRect(40, 61, 176, 6);
});
const houseTex = () => canvasTex(256, 256, g => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) { g.fillStyle = "rgba(150,120,90,.12)"; g.fillRect(0, y, 256, 2); }
  g.fillStyle = "#6b4f3a"; g.fillRect(104, 150, 48, 106);
  for (const x of [36, 176]) { g.fillStyle = "#8ec5ff"; g.fillRect(x, 90, 44, 44); g.strokeStyle = "#fff"; g.lineWidth = 6; g.strokeRect(x, 90, 44, 44); g.beginPath(); g.moveTo(x + 22, 90); g.lineTo(x + 22, 134); g.moveTo(x, 112); g.lineTo(x + 44, 112); g.stroke(); }
});
const shopTex = () => canvasTex(256, 256, g => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#7fb9e6"; g.fillRect(18, 120, 150, 120); g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(30, 130, 30, 100);
  g.fillStyle = "#5c4033"; g.fillRect(180, 120, 56, 136);
  g.fillStyle = "#ffe8a3"; g.fillRect(18, 40, 220, 50); g.fillStyle = "#5c4033"; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.fillText("SHOP", 128, 78);
});
const aptTex = () => canvasTex(256, 512, g => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = "#8ec5ff"; g.fillRect(18 + x * 60, 30 + y * 96, 42, 52);
    g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(12 + x * 60, 86 + y * 96, 54, 8);
  }
  g.fillStyle = "#6b4f3a"; g.fillRect(104, 452, 48, 60);
});
const officeTex = (h) => canvasTex(128, 256, g => {
  g.fillStyle = "#b8c4cf"; g.fillRect(0, 0, 128, 256);
  const rows = h > 7 ? 20 : 12, r = rng(h * 7);
  for (let y = 0; y < rows; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = r() < 0.15 ? "#fff3bf" : `hsl(205,${45 + r() * 15}%,${45 + r() * 15}%)`;
    g.fillRect(6 + x * 30, 4 + y * (256 / rows), 24, 256 / rows - 6);
  }
});

// ---------- 人物 ----------
const SKINS = ["#f6d1b5", "#e9b98f", "#d39b72", "#f2c6a0"];
const AGE_LABEL = ["こども", "わかもの", "おとな", "シニア"];
// 人型キャラクター（age: 0こども 1わかもの 2おとな 3シニア）。歩くときに手足を振る。
function person(shirt, hair, age, pants, skinIdx, longHair) {
  const g = new THREE.Group(); const rig = {};
  const M = (c, o) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 0.7 }, o || {}));
  const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (parent || g).add(m); return m; };
  const skinM = M(SKINS[(skinIdx || 0) % 4], { roughness: 0.55, sheen: 0.3 });
  const shirtM = M(shirt, { roughness: 0.8, sheen: 0.5, sheenColor: new THREE.Color("#ffffff") });
  const pantsM = M(pants || "#34405a", { roughness: 0.85 });
  const hairM = M(age === 3 ? "#d8d8d8" : hair, { roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color("#ffffff") });
  const shoeM = M("#2b2b2b", { roughness: 0.4, clearcoat: 0.5 });
  // 脚（付け根で回転できるように pivot に入れる）
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0.075 * sx, 0.46, 0); g.add(hip);
    add(new THREE.CapsuleGeometry(0.062, 0.3, 4, 10), pantsM, 0, -0.2, 0, hip);
    add(new THREE.BoxGeometry(0.11, 0.06, 0.18), shoeM, 0, -0.42, 0.03, hip);
    rig[sx < 0 ? "legL" : "legR"] = hip;
  }
  const torso = add(new THREE.CapsuleGeometry(0.15, 0.24, 6, 14), shirtM, 0, 0.66, 0); torso.scale.set(1, 1, 0.75); rig.torso = torso;
  if (longHair && age !== 0) { const skirt = add(new THREE.CylinderGeometry(0.15, 0.24, 0.26, 16, 1, true), M(pants ? "#6c5ce7" : "#5c7cfa", { side: THREE.DoubleSide, sheen: 0.4 }), 0, 0.42, 0); skirt.scale.z = 0.85; }
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skinM, 0, 0.87, 0);
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.2 * sx, 0.8, 0); g.add(sh);
    const arm = add(new THREE.CapsuleGeometry(0.045, 0.28, 4, 8), shirtM, 0, -0.17, 0, sh); arm.rotation.z = 0.12 * sx;
    add(new THREE.SphereGeometry(0.045, 10, 8), skinM, 0.02 * sx, -0.36, 0, sh);
    rig[sx < 0 ? "armL" : "armR"] = sh;
  }
  const hr = age === 0 ? 0.17 : 0.145;
  const headG = new THREE.Group(); headG.position.set(0, 0.92 + hr, 0); g.add(headG); rig.head = headG;
  const head = add(new THREE.SphereGeometry(hr, 24, 18), skinM, 0, 0, 0, headG); head.scale.set(1, 1.08, 1);
  // 髪：頭頂のかぶせ＋前髪（長い髪の人は後ろ髪も）
  const cap = add(new THREE.SphereGeometry(hr * 1.07, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM, 0, 0.012, -0.02, headG); cap.scale.set(1, 1.1, 1.04); cap.rotation.x = -0.75;
  const fringe = add(new THREE.SphereGeometry(hr * 0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), hairM, 0, hr * 0.55, hr * 0.42, headG); fringe.rotation.x = 0.9; fringe.scale.set(1.25, 0.6, 0.8);
  if (longHair && age !== 3) { const back = add(new THREE.CapsuleGeometry(hr * 0.85, hr * 1.2, 4, 12), hairM, 0, -hr * 0.55, -hr * 0.45, headG); back.scale.set(1.15, 1, 0.6); }
  // 顔：白目＋黒目、まゆ、鼻、口
  const white = M("#ffffff", { roughness: 0.2 }), iris = M("#2b1d14", { roughness: 0.1, clearcoat: 1 });
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(hr * 0.2, 12, 10), white, sx * hr * 0.38, hr * 0.12, hr * 0.84, headG).scale.z = 0.5;
    add(new THREE.SphereGeometry(hr * 0.12, 10, 8), iris, sx * hr * 0.38, hr * 0.1, hr * 0.93, headG).scale.z = 0.5;
    const brow = add(new THREE.BoxGeometry(hr * 0.32, hr * 0.06, hr * 0.06), hairM, sx * hr * 0.38, hr * 0.38, hr * 0.88, headG); brow.rotation.z = -0.15 * sx;
  }
  add(new THREE.SphereGeometry(hr * 0.1, 8, 6), skinM, 0, -hr * 0.08, hr * 1.0, headG);
  const mouth = add(new THREE.TorusGeometry(hr * 0.18, hr * 0.03, 6, 12, Math.PI), M("#b8574a"), 0, -hr * 0.32, hr * 0.92, headG); mouth.rotation.z = Math.PI;
  for (const sx of [-1, 1]) add(new THREE.SphereGeometry(hr * 0.12, 8, 6), M("#ff9e9e", { transparent: true, opacity: 0.45 }), sx * hr * 0.6, -hr * 0.15, hr * 0.78, headG).scale.z = 0.3;
  if (age === 0) { // 帽子とランドセル
    add(new THREE.SphereGeometry(hr * 1.12, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.3), M("#ffd43b", { clearcoat: 0.5 }), 0, hr * 0.15, 0, headG);
    add(new THREE.CylinderGeometry(hr * 1.4, hr * 1.4, 0.015, 24), M("#ffd43b"), 0, hr * 0.32, 0.04, headG);
    const bag = roundedBox(0.26, 0.28, 0.13, 0.04, M("#d6336c", { clearcoat: 0.8, clearcoatRoughness: 0.2 })); bag.rotation.x = Math.PI / 2; bag.position.set(0, 0.8, -0.13); bag.castShadow = true; g.add(bag);
    g.scale.setScalar(0.62);
  } else if (age === 1) {
    const bag = roundedBox(0.22, 0.26, 0.1, 0.04, M("#495057")); bag.rotation.x = Math.PI / 2; bag.position.set(0, 0.8, -0.12); bag.castShadow = true; g.add(bag);
    g.scale.setScalar(0.88);
  } else if (age === 2) {
    g.scale.setScalar(0.95);
  } else if (age === 3) { // メガネと杖、少し前かがみ
    const glass = M("#444", { metalness: 0.8, roughness: 0.3 });
    for (const sx of [-1, 1]) add(new THREE.TorusGeometry(hr * 0.24, hr * 0.03, 6, 16), glass, sx * hr * 0.38, hr * 0.1, hr * 0.98, headG);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), M("#6d4c41", { clearcoat: 0.6 }), 0.32, 0.31, 0.1);
    torso.rotation.x = 0.18; headG.position.z += 0.05;
    g.scale.setScalar(0.93);
  }
  g.userData.rig = rig;
  return g;
}
const PARTNER_SHIRT = ["#e64980", "#20c997", "#f08c00", "#5c7cfa", "#be4bdb", "#82c91e"];
const HAIRS = ["#3d2b1f", "#5c3d2e", "#1f1f1f", "#8d5524", "#2b1d14", "#a0522d"];
function makeFamily(p, idx) {
  const g = new THREE.Group(); const rigs = [];
  const me = person(p.color, HAIRS[idx % HAIRS.length], p.age, null, idx, !!p.female);
  g.add(me); rigs.push(me.userData.rig);
  if (p.married) {
    const sp = p.spouse != null ? p.spouse : idx;
    const pt = person(PARTNER_SHIRT[sp % 6], HAIRS[(sp + 3) % 6], p.age, "#4a4f57", sp + 1, !!p.spouseF);
    pt.scale.multiplyScalar(0.95); pt.position.set(0.42, 0, -0.12); g.add(pt); rigs.push(pt.userData.rig);
  }
  const kids = Math.min(p.children || 0, 4);
  for (let i = 0; i < kids; i++) {
    const kid = person(["#ffe066", "#74c0fc", "#b2f2bb", "#ffc9c9"][i], HAIRS[(idx + i) % 6], 0, "#5c7cfa", idx + i, i % 2 === 1);
    kid.scale.multiplyScalar(0.85);
    kid.position.set(-0.3 + i * 0.26, 0, -0.42); g.add(kid); rigs.push(kid.userData.rig);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; g.add(shadow);
  g.scale.setScalar(1.0);
  g.userData.rigs = rigs;
  scene.add(g);
  return g;
}

function slot(pos, k, count) {
  const n = nodes[pos];
  if (count <= 1) return new THREE.Vector3(wx(n), n._top, wz(n));
  const a = (k / count) * Math.PI * 2;
  return new THREE.Vector3(wx(n) + Math.cos(a) * 0.42, n._top, wz(n) + Math.sin(a) * 0.42);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), now = performance.now(), tt = now / 1000;
  for (const t of tokens.values()) {
    const k = Math.min(1, (now - t.t0) / t.dur);
    const p = t.from.clone().lerp(t.to, k);
    p.y += Math.sin(k * Math.PI) * t.hop;
    t.group.position.copy(p);
    // 歩く・待機のアニメーション
    const walking = k < 1 && t.hop > 0.3;
    if (walking) { const dx = t.to.x - t.from.x, dz = t.to.z - t.from.z; if (Math.abs(dx) + Math.abs(dz) > 0.01) t.face = Math.atan2(dx, dz); }
    else t.face = 0;
    t.group.rotation.y += ((t.face || 0) - t.group.rotation.y) * Math.min(1, dt * 10);
    for (const rig of t.group.userData.rigs || []) {
      const sw = walking ? Math.sin(tt * 18) * 0.7 : Math.sin(tt * 2) * 0.05;
      rig.legL.rotation.x = sw; rig.legR.rotation.x = -sw; rig.armL.rotation.x = -sw * 0.8; rig.armR.rotation.x = sw * 0.8;
      rig.head.rotation.y = walking ? 0 : Math.sin(tt * 0.7 + rig.legL.id) * 0.25;
      rig.torso.scale.y = 1 + Math.sin(tt * 2.2) * 0.012;
    }
  }
  const f = tokens.get(focusId);
  if (f) { marker.visible = true; marker.position.set(f.group.position.x, f.group.position.y + 1.9 + Math.sin(now / 250) * 0.12, f.group.position.z); marker.rotation.y += dt * 2; }
  else marker.visible = false;
  for (const o of scene.children) if (o.userData.cloud) { o.position.x += o.userData.cloud * dt; if (o.position.x > 90) o.position.x = -90; }
  for (const n of Object.values(nodes)) if (n._flag) n._flag.rotation.y = Math.sin(tt * 2) * 0.15;
  let tp, tl;
  if (mode === "follow" && f) { const g = f.group.position; tl = new THREE.Vector3(g.x, 1.0, g.z); tp = new THREE.Vector3(g.x + 1.2, 3.8, g.z + 5.2); }
  else { const D = Math.max(bounds.Z1 - bounds.Z0, (bounds.X1 - bounds.X0) * 1.25 / Math.max(0.6, camera.aspect)); tl = new THREE.Vector3(0, 0, D * 0.1); tp = new THREE.Vector3(0, D * 0.98, D * 0.66); }
  const a = 1 - Math.exp(-dt * 3);
  camPos.lerp(tp, a); camLook.lerp(tl, a);
  camera.position.copy(camPos); camera.lookAt(camLook);
  // 影はカメラの見ている場所のまわりだけ計算する
  sun.target.position.set(camLook.x, 0, camLook.z); sun.position.set(camLook.x - 18, 34, camLook.z + 14);
  moveCars(dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    if (p.vel) { p.vel.y -= p.g * dt; p.obj.position.addScaledVector(p.vel, dt); p.obj.rotation.x += p.spin * dt; p.obj.rotation.z += p.spin * dt * 0.7; }
    if (p.rise) p.obj.position.y += p.rise * dt;
    if (p.obj.material) { p.obj.material.transparent = true; p.obj.material.opacity = Math.min(1, p.life / 0.5); }
    if (p.life <= 0) { scene.remove(p.obj); p.obj.geometry && p.obj.geometry.dispose(); particles.splice(i, 1); }
  }
  renderer.render(scene, camera);
}

const B3 = {
  mount(el, nodeMap, typeColor) {
    try {
      container = el; nodes = nodeMap;
      { const v = Object.values(nodes); CX = (Math.min(...v.map(n => n.x)) + Math.max(...v.map(n => n.x))) / 2; CY = (Math.min(...v.map(n => n.y)) + Math.max(...v.map(n => n.y))) / 2; }
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = "c3d";
      el.prepend(renderer.domElement);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600); clock = new THREE.Clock();
      buildWorld(typeColor);
      const fit = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      new ResizeObserver(fit).observe(el); fit();
      animate();
      return true;
    } catch (e) { console.warn("3D無効", e); return false; }
  },
  setMode(m) { mode = m; },
  // list: [{id,idx,color,pos,age,married,spouse,children}]
  setPositions(list, focus) {
    if (!scene) return;
    focusId = focus;
    const groups = {};
    list.forEach(p => (groups[p.pos] = groups[p.pos] || []).push(p));
    const now = performance.now();
    for (const [pos, ps] of Object.entries(groups)) ps.forEach((p, k) => {
      const to = slot(pos, k, ps.length);
      let t = tokens.get(p.id);
      const sig = p.age + "|" + !!p.married + "|" + p.spouse + "|" + !!p.female + "|" + Math.min(p.children || 0, 4);
      if (!t) { t = { group: makeFamily(p, p.idx), from: to.clone(), to, t0: 0, dur: 1, hop: 0, sig, age: p.age }; tokens.set(p.id, t); t.group.position.copy(to); return; }
      if (t.sig !== sig) {
        const pos0 = t.group.position.clone(); scene.remove(t.group);
        t.group = makeFamily(p, p.idx); t.group.position.copy(pos0); t.sig = sig;
        if (p.age > t.age) setTimeout(() => B3.effect(p.id, "party", AGE_LABEL[p.age] + "に成長！"), 300);
        t.age = p.age;
      }
      if (t.to.distanceTo(to) < 0.01) return;
      const moved = t.pos !== pos;
      t.from = t.group.position.clone(); t.to = to; t.t0 = now; t.dur = moved ? 250 : 200; t.hop = moved ? 0.7 : 0.15; t.pos = pos;
    });
    for (const p of list) { const t = tokens.get(p.id); if (t) t.pos = p.pos; }
    for (const id of [...tokens.keys()]) if (!list.find(p => p.id === id)) { scene.remove(tokens.get(id).group); tokens.delete(id); }
  },
  // kind: "gain" | "loss" | "party"
  effect(pid, kind, label) {
    const t = tokens.get(pid); if (!t || !scene) return;
    const o = t.group.position;
    const N = kind === "party" ? 70 : 22;
    for (let i = 0; i < N; i++) {
      let obj;
      if (kind === "gain") obj = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20), new THREE.MeshPhysicalMaterial({ color: "#f7c948", metalness: 1, roughness: 0.25, clearcoat: 1 }));
      else if (kind === "loss") obj = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: i % 2 ? "#d8d4c8" : "#9fd5a8" }));
      else obj = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.26), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.85, 0.6), side: THREE.DoubleSide, metalness: 0.3, roughness: 0.4 }));
      obj.position.set(o.x, o.y + 0.9, o.z); obj.castShadow = kind === "gain";
      const a = Math.random() * Math.PI * 2, sp = kind === "party" ? 2 + Math.random() * 3 : 1 + Math.random() * 2;
      const up = kind === "loss" ? 1 + Math.random() * 2 : 4 + Math.random() * 4;
      scene.add(obj);
      particles.push({ obj, vel: new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp), g: kind === "party" ? 5 : 9, spin: (Math.random() - 0.5) * 14, life: 1.6 + Math.random() * 0.6 });
    }
    if (label) {
      const s = textSprite(label, kind === "loss" ? "#e03131" : kind === "gain" ? "#e8590c" : "#7048e8");
      s.position.set(o.x, o.y + 1.9, o.z); scene.add(s);
      particles.push({ obj: s, rise: 0.9, life: 2.2 });
    }
  }
};
window.B3 = B3;
if (window.on3DReady) window.on3DReady();
