// ミライすごろく 3D盤面（three.js）
// メイン画面のスクリプトから B3.mount / B3.setPositions / B3.effect を呼んで使う。
import * as THREE from "./vendor/three.module.min.js";

const SP = 2.2; // マスの間隔
const wx = n => (n.x - 5.5) * SP;
const wz = n => (n.y - 5.15) * SP;

let renderer, scene, camera, clock, container, nodes;
let mode = "follow";           // "follow" | "all"
let focusId = null;
const tokens = new Map();      // id -> {group, from, to, t0, dur, hop}
const particles = [];
const camPos = new THREE.Vector3(0, 31, 24), camLook = new THREE.Vector3(0, 0, 1);
let marker;

function tileTexture(n, fill) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = fill; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246);
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = '110px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.fillText(n.icon, 128, 110);
  g.fillStyle = "#3b2f25"; g.font = 'bold 36px "Hiragino Sans","Noto Sans JP",sans-serif';
  g.fillText(n.label.length > 7 ? n.label.slice(0, 7) : n.label, 128, 216);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function textSprite(text, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.font = 'bold 72px "Hiragino Sans","Noto Sans JP",sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 12; g.strokeStyle = "#fff"; g.strokeText(text, 256, 64);
  g.fillStyle = color; g.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(4, 1, 1); s.renderOrder = 10;
  return s;
}

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

function buildWorld(typeColor) {
  scene.background = new THREE.Color("#bfe6ff");
  scene.fog = new THREE.Fog("#bfe6ff", 50, 95);
  scene.add(new THREE.HemisphereLight("#ffffff", "#7fb35a", 1.1));
  const sun = new THREE.DirectionalLight("#fff3dc", 1.6);
  sun.position.set(-12, 24, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: "#8fce6b" }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(28.5, 0.2, 32.5), new THREE.MeshStandardMaterial({ color: "#f6e7c8" }));
  pad.position.set(0, 0.1, 0); pad.receiveShadow = true; scene.add(pad);

  // 道
  const roadMat = new THREE.MeshStandardMaterial({ color: "#d9b98c" });
  for (const n of Object.values(nodes)) for (const id of n.next) {
    const m = nodes[id]; const dx = wx(m) - wx(n), dz = wz(m) - wz(n); const len = Math.hypot(dx, dz);
    const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.5), roadMat);
    road.position.set((wx(n) + wx(m)) / 2, 0.25, (wz(n) + wz(m)) / 2);
    road.rotation.y = -Math.atan2(dz, dx); road.receiveShadow = true; scene.add(road);
  }
  // マス
  for (const n of Object.values(nodes)) {
    const neg = n.type === "money" && n.amount < 0;
    const fill = typeColor[n.type] || (neg ? "#ffd6d6" : "#d3f9d8");
    const h = n.stop ? 0.7 : 0.45;
    const side = new THREE.MeshStandardMaterial({ color: fill });
    const top = new THREE.MeshStandardMaterial({ map: tileTexture(n, fill) });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 1.7), [side, side, top, side, side, side]);
    box.position.set(wx(n), 0.2 + h / 2, wz(n)); box.castShadow = box.receiveShadow = true; scene.add(box);
    if (n.stop) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 2), new THREE.MeshStandardMaterial({ color: "#e8590c" }));
      rim.position.set(wx(n), 0.3, wz(n)); rim.receiveShadow = true; scene.add(rim);
    }
    n._top = 0.2 + h;
    if (n.type === "goal") {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4), new THREE.MeshStandardMaterial({ color: "#555" }));
      pole.position.set(wx(n) + 0.6, n._top + 1.2, wz(n) - 0.6); scene.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), new THREE.MeshStandardMaterial({ color: "#ff4d4d" }));
      flag.position.set(wx(n) + 1.05, n._top + 2.1, wz(n) - 0.6); flag.castShadow = true; scene.add(flag);
    }
  }
  // まわりの景色（木・家・池）
  const r = rng(42);
  const trunk = new THREE.MeshStandardMaterial({ color: "#8a5a3b" });
  const leafMats = ["#3f9d4a", "#57b45c", "#2f8a3e"].map(c => new THREE.MeshStandardMaterial({ color: c }));
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * 66, z = (r() - 0.5) * 70;
    if (Math.abs(x) < 15.5 && Math.abs(z) < 17.5) continue;
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.8), trunk); tr.position.y = 0.4;
    const s = 0.8 + r() * 0.8;
    const lf = r() < 0.5 ? new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 2 * s, 7), leafMats[i % 3]) : new THREE.Mesh(new THREE.SphereGeometry(0.9 * s, 10, 8), leafMats[i % 3]);
    lf.position.y = 0.8 + s; tr.castShadow = lf.castShadow = true;
    t.add(tr, lf); t.position.set(x, 0, z); scene.add(t);
  }
  const houseCols = ["#ff8787", "#74c0fc", "#ffd43b", "#b197fc"];
  [[-19, -21], [18, -22], [-20, 20], [19, 21], [0, -22], [3, 22], [-21, 4], [21, -3]].forEach(([x, z], i) => {
    const h = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), new THREE.MeshStandardMaterial({ color: "#fff4e6" })); body.position.y = 0.75;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.2, 4), new THREE.MeshStandardMaterial({ color: houseCols[i % 4] }));
    roof.position.y = 2.1; roof.rotation.y = Math.PI / 4; body.castShadow = roof.castShadow = true;
    h.add(body, roof); h.position.set(x, 0, z); h.rotation.y = r() * Math.PI; scene.add(h);
  });
  const pond = new THREE.Mesh(new THREE.CircleGeometry(3.2, 32), new THREE.MeshStandardMaterial({ color: "#4dabf7", roughness: 0.2 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-23, 0.02, -8); scene.add(pond);

  marker = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), new THREE.MeshStandardMaterial({ color: "#ffd43b", emissive: "#a67c00" }));
  marker.rotation.x = Math.PI; scene.add(marker);
}

const SKIN = "#f5c9a6";
const AGE_LABEL = ["こども", "わかもの", "おとな", "シニア"];
// 人型キャラクター（age: 0こども 1わかもの 2おとな 3シニア）
function person(shirt, hair, age, pants) {
  const g = new THREE.Group();
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const pantsM = M(pants || "#3b4a6b"), shirtM = M(shirt), skinM = M(SKIN), hairM = M(age === 3 ? "#d9d9d9" : hair);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 10), pantsM, -0.08, 0.2, 0);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 10), pantsM, 0.08, 0.2, 0);
  const torso = add(new THREE.CylinderGeometry(0.15, 0.19, 0.44, 14), shirtM, 0, 0.62, 0);
  const armL = add(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 8), shirtM, -0.24, 0.62, 0); armL.rotation.z = -0.25;
  const armR = add(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 8), shirtM, 0.24, 0.62, 0); armR.rotation.z = 0.25;
  const hr = age === 0 ? 0.22 : 0.18;
  const head = add(new THREE.SphereGeometry(hr, 18, 14), skinM, 0, 0.84 + hr, 0);
  const hairMesh = add(new THREE.SphereGeometry(hr * 1.06, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairM, 0, 0.86 + hr, -0.02);
  const eyeM = M("#222");
  add(new THREE.SphereGeometry(0.025, 8, 6), eyeM, -0.065, 0.86 + hr, hr * 0.92);
  add(new THREE.SphereGeometry(0.025, 8, 6), eyeM, 0.065, 0.86 + hr, hr * 0.92);
  if (age === 0) { // 帽子とランドセル
    const cap = add(new THREE.SphereGeometry(hr * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M("#ffd43b"), 0, 0.9 + hr, 0);
    add(new THREE.BoxGeometry(0.26, 0.28, 0.12), M("#e03131"), 0, 0.66, -0.2);
    g.scale.setScalar(0.62);
  } else if (age === 1) {
    add(new THREE.BoxGeometry(0.24, 0.26, 0.1), M("#495057"), 0, 0.66, -0.2); // リュック
    g.scale.setScalar(0.85);
  } else if (age === 3) { // メガネと杖、少し前かがみ
    const glass = M("#333");
    add(new THREE.TorusGeometry(0.045, 0.01, 6, 14), glass, -0.065, 0.86 + hr, hr * 0.95);
    add(new THREE.TorusGeometry(0.045, 0.01, 6, 14), glass, 0.065, 0.86 + hr, hr * 0.95);
    const cane = add(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), M("#8a5a3b"), 0.36, 0.31, 0.08);
    torso.rotation.x = 0.15; head.position.z += 0.05; hairMesh.position.z += 0.05;
    g.scale.setScalar(0.95);
  }
  return g;
}
const PARTNER_SHIRT = ["#f783ac", "#63e6be", "#ffa94d", "#91a7ff", "#e599f7", "#a9e34b"];
const HAIRS = ["#3d2b1f", "#5c3d2e", "#1f1f1f", "#8d5524", "#2b1d14", "#6b4226"];
function makeFamily(p, idx) {
  const g = new THREE.Group();
  const me = person(p.color, HAIRS[idx % HAIRS.length], p.age);
  g.add(me);
  if (p.married) {
    const sp = p.spouse != null ? p.spouse : idx;
    const pt = person(PARTNER_SHIRT[sp % 6], HAIRS[(sp + 3) % 6], p.age, "#5c5f66");
    pt.scale.multiplyScalar(0.92); pt.position.set(0.42, 0, -0.12); g.add(pt);
  }
  const kids = Math.min(p.children || 0, 4);
  for (let i = 0; i < kids; i++) {
    const kid = person(["#ffe066", "#74c0fc", "#b2f2bb", "#ffc9c9"][i], HAIRS[(idx + i) % 6], 0);
    kid.scale.multiplyScalar(0.8);
    kid.position.set(-0.3 + i * 0.26, 0, -0.42); g.add(kid);
  }
  g.scale.setScalar(0.85);
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
  const dt = Math.min(clock.getDelta(), 0.05), now = performance.now();
  for (const t of tokens.values()) {
    const k = Math.min(1, (now - t.t0) / t.dur);
    const p = t.from.clone().lerp(t.to, k);
    p.y += Math.sin(k * Math.PI) * t.hop;
    t.group.position.copy(p);
  }
  const f = tokens.get(focusId);
  if (f) { marker.visible = true; marker.position.set(f.group.position.x, f.group.position.y + 1.9 + Math.sin(now / 250) * 0.12, f.group.position.z); marker.rotation.y += dt * 2; }
  else marker.visible = false;
  let tp, tl;
  if (mode === "follow" && f) { const g = f.group.position; tl = new THREE.Vector3(g.x, 0.5, g.z); tp = new THREE.Vector3(g.x, 9, g.z + 9.5); }
  else { tl = new THREE.Vector3(0, 0, 1.5); tp = new THREE.Vector3(0, 34, 26); }
  const a = 1 - Math.exp(-dt * 3);
  camPos.lerp(tp, a); camLook.lerp(tl, a);
  camera.position.copy(camPos); camera.lookAt(camLook);
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
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = "c3d";
      el.prepend(renderer.domElement);
      scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200); clock = new THREE.Clock();
      buildWorld(typeColor);
      const fit = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      new ResizeObserver(fit).observe(el); fit();
      animate();
      return true;
    } catch (e) { console.warn("3D無効", e); return false; }
  },
  setMode(m) { mode = m; },
  // list: [{id,idx,color,pos,age,married,children}]
  setPositions(list, focus) {
    if (!scene) return;
    focusId = focus;
    const groups = {};
    list.forEach(p => (groups[p.pos] = groups[p.pos] || []).push(p));
    const now = performance.now();
    for (const [pos, ps] of Object.entries(groups)) ps.forEach((p, k) => {
      const to = slot(pos, k, ps.length);
      let t = tokens.get(p.id);
      const sig = p.age + "|" + !!p.married + "|" + Math.min(p.children || 0, 4);
      if (!t) { t = { group: makeFamily(p, p.idx), from: to.clone(), to, t0: 0, dur: 1, hop: 0, sig, age: p.age }; tokens.set(p.id, t); t.group.position.copy(to); return; }
      if (t.sig !== sig) {
        const pos0 = t.group.position.clone(); scene.remove(t.group);
        t.group = makeFamily(p, p.idx); t.group.position.copy(pos0); t.sig = sig;
        if (p.age > t.age) setTimeout(() => B3.effect(p.id, "party", AGE_LABEL[p.age] + "に成長！"), 300);
        t.age = p.age;
      }
      if (t.to.distanceTo(to) < 0.01) return;
      const moved = t.pos !== pos;
      t.from = t.group.position.clone(); t.to = to; t.t0 = now; t.dur = moved ? 240 : 200; t.hop = moved ? 0.9 : 0.15; t.pos = pos;
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
      if (kind === "gain") obj = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14), new THREE.MeshStandardMaterial({ color: "#ffd43b", metalness: 0.6, roughness: 0.3, emissive: "#6b4f00" }));
      else if (kind === "loss") obj = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: i % 2 ? "#c0bfbf" : "#8ce99a" }));
      else obj = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.26), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.85, 0.6), side: THREE.DoubleSide }));
      obj.position.set(o.x, o.y + 0.9, o.z);
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
