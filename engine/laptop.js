// A MacBook Pro 14" (2021+) built procedurally, in centimetres.
// Base: aluminium unibody, black keyboard well with keys, speaker grilles,
// glass trackpad. Lid: aluminium shell, black glass inner face, hinge.
// The display itself is left black here: the reel maps the live DOM desktop
// onto it (see screenCorners), so the UI stays vector-sharp.
import * as THREE from 'three';

export const MBP = { W: 31.26, D: 22.12, baseH: 1.05, lidH: 0.45, gap: 0.03, R: 1.25 };
MBP.hingeZ = -MBP.D / 2 + 0.38;             // hinge axis (z), near the back edge
MBP.hingeY = MBP.baseH + MBP.gap + MBP.lidH / 2;
MBP.lidLen = MBP.D;                           // along the lid, hinge side → front edge
MBP.display = { w: 30.25, h: 19.64, chin: 1.95 };   // 3024 × 1964, aspect 1.54

function roundedRect(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// A slab lying flat (plan in XZ, thickness along +Y from 0), with a rounded edge.
function slab(w, d, h, r, bevel) {
  const shape = roundedRect(w - 2 * bevel, d - 2 * bevel, Math.max(0.01, r - bevel));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 18 });
  g.rotateX(-Math.PI / 2);            // extrusion (+z) → +y; shape y → -z
  g.translate(0, bevel, 0);
  g.computeVertexNormals();
  return g;
}
function flatRect(w, d, r) {
  const g = new THREE.ShapeGeometry(roundedRect(w, d, r), 12);
  g.rotateX(-Math.PI / 2);            // lie in XZ, facing +y
  return g;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLaptop(maps) {
  const group = new THREE.Group();

  const alu = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.46, color: 0xe6e3df, envMapIntensity: 1, clearcoat: 0.2, clearcoatRoughness: 0.45 });
  if (maps && maps.r) { const r = maps.r.clone(); r.repeat.set(6, 6); r.needsUpdate = true; alu.roughnessMap = r; }
  const aluTop = alu.clone(); aluTop.roughness = 0.4;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 });
  const decal = {};   // layers sit ≥ 0.012 cm apart; with near = 12 cm no depth offset is needed
  const well = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.85, metalness: 0, ...decal });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.9 });
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.3 });
  const padMat = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.3, color: 0xdcd9d5, envMapIntensity: 1, clearcoat: 0.5, clearcoatRoughness: 0.15 });

  // ---- base ----------------------------------------------------------------
  const base = new THREE.Mesh(slab(MBP.W, MBP.D, MBP.baseH, MBP.R, 0.22), [aluTop, alu]);
  group.add(base);
  const top = MBP.baseH + 0.015;

  // keyboard: black well + 6 rows of keys (unit = 1.84 cm pitch)
  const U = 1.84, gapK = 0.3, rowsZ0 = -MBP.D / 2 + 1.55;
  const rows = [
    { h: 0.56, keys: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    { h: 1, keys: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5] },
    { h: 1, keys: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    { h: 1, keys: [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75] },
    { h: 1, keys: [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25] },
    { h: 1, keys: [1, 1, 1, 1.25, 5, 1.25, 1, 1, 'ud', 1] },
  ];
  const kbW = 14.5 * U;
  const kbD = rows.reduce((a, r) => a + r.h * U, 0);
  const wellMesh = new THREE.Mesh(flatRect(kbW + 0.5, kbD + 0.5, 0.5), well);
  wellMesh.position.set(0, top, rowsZ0 + kbD / 2 - 0.02);
  group.add(wellMesh);
  const keyGeo = new THREE.BoxGeometry(1, 0.07, 1);
  keyGeo.translate(0, -0.015, 0);
  const keyList = [];
  let z = rowsZ0;
  for (const row of rows) {
    let x = -kbW / 2;
    const rh = row.h * U;
    for (const k of row.keys) {
      if (k === 'ud') {          // stacked up / down arrows
        keyList.push([x + U / 2, z + rh * 0.25, U - gapK, rh / 2 - gapK * 0.6]);
        keyList.push([x + U / 2, z + rh * 0.75, U - gapK, rh / 2 - gapK * 0.6]);
        x += U; continue;
      }
      const kw = k * U;
      const isArrow = row === rows[5] && (k === 1) && x > kbW / 2 - 3.2 * U;
      const kh = isArrow ? rh / 2 - gapK * 0.6 : rh - gapK;
      keyList.push([x + kw / 2, z + (isArrow ? rh * 0.75 : rh / 2), kw - gapK, kh]);
      x += kw;
    }
    z += rh;
  }
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, keyList.length);
  const m4 = new THREE.Matrix4();
  keyList.forEach(([kx, kz, kw, kd], i) => { m4.makeScale(kw, 1, kd); m4.setPosition(kx, MBP.baseH + 0.02, kz); keys.setMatrixAt(i, m4); });
  group.add(keys);

  // speaker grilles either side of the keyboard
  const grilleTex = canvasTex(64, 640, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,1)';
    for (let yy = 6; yy < h; yy += 9) for (let xx = 6 + ((yy / 9) % 2) * 4.5; xx < w; xx += 9) { g.beginPath(); g.arc(xx, yy, 2.1, 0, 6.283); g.fill(); }
  });
  const grilleMat = new THREE.MeshBasicMaterial({ map: grilleTex, transparent: true, opacity: 0.55, depthWrite: false, color: 0x222226, ...decal });
  for (const sx of [-1, 1]) {
    const gm = new THREE.Mesh(flatRect(1.05, kbD - 0.2, 0.3), grilleMat);
    gm.position.set(sx * (kbW / 2 + 0.95), top + 0.002, rowsZ0 + kbD / 2);
    group.add(gm);
  }
  // trackpad: glass-smooth aluminium, seam drawn by a slightly larger dark plate
  const padW = 15.0, padD = 9.3, padZ = rowsZ0 + kbD + 0.85 + padD / 2;
  const seam = new THREE.Mesh(flatRect(padW + 0.06, padD + 0.06, 0.55), new THREE.MeshBasicMaterial({ color: 0x8e9095, ...decal }));
  seam.position.set(0, top + 0.001, padZ); group.add(seam);
  const pad = new THREE.Mesh(flatRect(padW, padD, 0.52), padMat);
  pad.position.set(0, top + 0.006, padZ); group.add(pad);
  // front lip notch (lifts the lid)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 0.35), new THREE.MeshStandardMaterial({ color: 0x9a9ca0, roughness: 0.5, metalness: 0.8 }));
  lip.position.set(0, MBP.baseH - 0.05, MBP.D / 2 - 0.12); group.add(lip);

  // hinge barrel
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, MBP.W - 5.0, 24), hingeMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, MBP.hingeY - 0.12, MBP.hingeZ - 0.05); group.add(hinge);

  // ---- lid (pivot on the hinge axis) --------------------------------------------
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, MBP.hingeY, MBP.hingeZ);
  group.add(lidPivot);
  const lid = new THREE.Group();
  lidPivot.add(lid);
  // closed pose in pivot space: slab spans z ∈ [-0.38, D-0.38], y ∈ [-lidH/2, lidH/2]
  const shell = new THREE.Mesh(slab(MBP.W, MBP.D, MBP.lidH, MBP.R, 0.16), [alu, alu]);
  shell.position.set(0, -MBP.lidH / 2, MBP.D / 2 - 0.38);
  lid.add(shell);
  // inner face (display side) = bottom of the closed lid, facing -y
  const inner = new THREE.Mesh(flatRect(MBP.W - 0.34, MBP.D - 0.34, MBP.R - 0.17), glass);
  inner.rotation.x = Math.PI;            // face -y
  inner.position.set(0, -MBP.lidH / 2 - 0.002, MBP.D / 2 - 0.38);
  lid.add(inner);

  // display rect in lid space (closed pose): hinge side = bottom of the screen
  const dz0 = -0.38 + MBP.display.chin, dz1 = dz0 + MBP.display.h, dy = -MBP.lidH / 2 - 0.004, hw = MBP.display.w / 2;
  const cornersLocal = [
    new THREE.Vector3(-hw, dy, dz1),   // top-left     (as seen when open)
    new THREE.Vector3(hw, dy, dz1),    // top-right
    new THREE.Vector3(hw, dy, dz0),    // bottom-right
    new THREE.Vector3(-hw, dy, dz0),   // bottom-left
  ];
  const normalLocal = new THREE.Vector3(0, -1, 0);

  // soft contact shadow on the ground
  const shadowTex = canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(MBP.W * 1.5, MBP.D * 1.7), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.34, depthWrite: false, color: 0x2c2b36 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, -0.01, 0.4);
  shadow.renderOrder = -1;
  group.add(shadow);

  function setOpen(deg) { lidPivot.rotation.x = -THREE.MathUtils.degToRad(deg); }
  function screenCorners() {
    lidPivot.updateMatrixWorld(true);
    return cornersLocal.map(v => v.clone().applyMatrix4(lid.matrixWorld));
  }
  function screenNormal() {
    lidPivot.updateMatrixWorld(true);
    return normalLocal.clone().transformDirection(lid.matrixWorld);
  }
  function screenCenter() { const c = screenCorners(); return c[0].clone().add(c[2]).multiplyScalar(0.5); }
  function screenUp() { const c = screenCorners(); return c[0].clone().sub(c[3]).normalize(); }
  return { group, setOpen, screenCorners, screenNormal, screenCenter, screenUp, shadow };
}
