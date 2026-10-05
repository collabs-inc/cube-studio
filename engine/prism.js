// The Cube prism, ported from www-cube-computer/public/prism-embed.html
// (superellipse plan, G2 rim blend, analytic HDR sky, anodised silver), but
// driven frame by frame instead of by rAF so a headless capture can seek it.
import * as THREE from 'three';

/* ---- 1. plan profile ---------------------------------------------------- */
function superellipse(a, n, count) {
  const DENSE = 4096, e = 2 / n, raw = [];
  for (let i = 0; i <= DENSE; i++) {
    const t = (i / DENSE) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    raw.push([a * Math.sign(c) * Math.pow(Math.abs(c), e), a * Math.sign(s) * Math.pow(Math.abs(s), e)]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = cum[cum.length - 1];
  const pts = [];
  let seg = 0;
  for (let j = 0; j < count; j++) {
    const target = (j / count) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = (target - cum[seg]) / span;
    pts.push([raw[seg][0] + (raw[seg + 1][0] - raw[seg][0]) * f, raw[seg][1] + (raw[seg + 1][1] - raw[seg][1]) * f]);
  }
  return pts;
}
function planNormals(pts, a, n) {
  return pts.map(([x, z]) => {
    const gx = Math.sign(x) * Math.pow(Math.abs(x) / a, n - 1);
    const gz = Math.sign(z) * Math.pow(Math.abs(z) / a, n - 1);
    const L = Math.hypot(gx, gz) || 1;
    return [gx / L, gz / L];
  });
}
function minCurvatureRadius(pts) {
  let rMin = Infinity;
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const A = pts[(i - 1 + m) % m], B = pts[i], C = pts[(i + 1) % m];
    const la = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const lb = Math.hypot(C[0] - A[0], C[1] - A[1]);
    const lc = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
    if (area < 1e-12) continue;
    const R = (la * lb * lc) / (4 * area);
    if (R < rMin) rMin = R;
  }
  return rMin;
}

/* ---- 2. the solid ---------------------------------------------------------- */
function rimProfile(r, m, arc) {
  const DENSE = Math.max(512, arc * 16), e = 2 / m;
  const d = new Float64Array(DENSE + 1), yy = new Float64Array(DENSE + 1);
  for (let i = 0; i <= DENSE; i++) {
    const th = (Math.PI / 2) * (i / DENSE);
    d[i] = r * (1 - Math.pow(Math.cos(th), e));
    yy[i] = r * Math.pow(Math.sin(th), e);
  }
  const cum = new Float64Array(DENSE + 1);
  for (let i = 1; i <= DENSE; i++) cum[i] = cum[i - 1] + Math.hypot(d[i] - d[i - 1], yy[i] - yy[i - 1]);
  const total = cum[DENSE] || 1;
  const out = [];
  let seg = 0;
  for (let j = 0; j <= arc; j++) {
    const target = (j / arc) * total;
    while (seg < DENSE - 1 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = (target - cum[seg]) / span;
    out.push({ d: d[seg] + (d[seg + 1] - d[seg]) * f, y: yy[seg] + (yy[seg + 1] - yy[seg]) * f });
  }
  for (let j = 0; j <= arc; j++) {
    if (j === 0) { out[j].nh = 1; out[j].nv = 0; continue; }
    if (j === arc) { out[j].nh = 0; out[j].nv = 1; continue; }
    const a = out[j - 1], b = out[j + 1];
    const td = b.d - a.d, ty = b.y - a.y;
    const L = Math.hypot(td, ty) || 1;
    out[j].nh = ty / L; out[j].nv = td / L;
  }
  return out;
}

function buildPrism({ a, n, r, m = 2, halfHeight, radial, arc, wallSegs = 6, capRings = 5 }) {
  const base = superellipse(a, n, radial);
  const norm = planNormals(base, a, n);
  const R = Math.max(r, 1e-4);
  const wallHalf = Math.max(halfHeight - R, 1e-4);
  const rings = [];
  const push = (d, s, y, nh, nv) => rings.push({ d, s, y, nh, nv, cap: Math.abs(nh) < 1e-9 });
  const rim = rimProfile(R, m, arc);
  for (let i = 0; i <= capRings; i++) push(R, i / capRings, -halfHeight, 0, -1);
  for (let j = arc - 1; j >= 0; j--) { const q = rim[j]; push(q.d, 1, -wallHalf - q.y, q.nh, -q.nv); }
  for (let k = 1; k <= wallSegs; k++) push(0, 1, -wallHalf + (2 * wallHalf * k) / wallSegs, 1, 0);
  for (let j = 1; j <= arc; j++) { const q = rim[j]; push(q.d, 1, wallHalf + q.y, q.nh, q.nv); }
  for (let i = capRings - 1; i >= 0; i--) push(R, i / capRings, halfHeight, 0, 1);

  const cols = radial + 1, rows = rings.length;
  let perim = 0;
  for (let i = 0; i < radial; i++) { const p = base[i], q = base[(i + 1) % radial]; perim += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  const vArc = new Float64Array(rows);
  {
    const bx0 = base[0][0], bz0 = base[0][1], nx0 = norm[0][0], nz0 = norm[0][1];
    const pt = g => [g.s * (bx0 - g.d * nx0), g.y, g.s * (bz0 - g.d * nz0)];
    let prev = pt(rings[0]);
    for (let ri = 1; ri < rows; ri++) {
      const cur = pt(rings[ri]);
      vArc[ri] = vArc[ri - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
      prev = cur;
    }
  }
  const TILE = perim;
  const pos = new Float32Array(cols * rows * 3), nrm = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  let p = 0, q = 0;
  for (let ri = 0; ri < rows; ri++) {
    const { d, s, y, nh, nv, cap } = rings[ri];
    for (let ci = 0; ci < cols; ci++) {
      const i = ci % radial;
      const [bx, bz] = base[i], [nx, nz] = norm[i];
      const X = s * (bx - d * nx), Z = s * (bz - d * nz);
      pos[p] = X; pos[p + 1] = y; pos[p + 2] = Z;
      nrm[p] = nx * nh; nrm[p + 1] = nv; nrm[p + 2] = nz * nh;
      if (cap) { uv[q] = X / TILE; uv[q + 1] = Z / TILE; }
      else { uv[q] = ci / radial; uv[q + 1] = vArc[ri] / TILE; }
      p += 3; q += 2;
    }
  }
  const idx = new Uint32Array(radial * (rows - 1) * 6);
  let t = 0;
  for (let ri = 0; ri < rows - 1; ri++) for (let ci = 0; ci < radial; ci++) {
    const A = ri * cols + ci, B = A + 1, C = A + cols, D = C + 1;
    idx[t++] = A; idx[t++] = C; idx[t++] = B; idx[t++] = B; idx[t++] = C; idx[t++] = D;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/* ---- 3. environment: analytic HDR sky ------------------------------------ */
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const HF = THREE.DataUtils.toHalfFloat;
function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function dataTexture(data, w, h) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}
function phiRing(w) {
  const cs = new Float64Array(w), sn = new Float64Array(w);
  for (let i = 0; i < w; i++) { const phi = ((i + 0.5) / w - 0.5) * Math.PI * 2; cs[i] = Math.cos(phi); sn[i] = Math.sin(phi); }
  return { cs, sn };
}
function buildSky({ w, sunAz, sunEl, turbidity, ground, zen, hor, gnd, sunScale = 1 }) {
  const h = w >> 1;
  const data = new Uint16Array(w * h * 4);
  const { cs, sn } = phiRing(w);
  const T = turbidity;
  const pA = 0.1787 * T - 1.4630, pB = -0.3554 * T + 0.4275;
  const pC = -0.0227 * T + 5.3251, pD = 0.1206 * T - 2.5771, pE = -0.0670 * T + 0.3703;
  const az = THREE.MathUtils.degToRad(sunAz), el = THREE.MathUtils.degToRad(sunEl);
  const sx = Math.cos(el) * Math.sin(az), sy = Math.sin(el), sz = Math.cos(el) * Math.cos(az);
  const airMass = e => Math.min(38, 1 / (Math.sin(THREE.MathUtils.degToRad(Math.max(e, -0.5))) + 0.50572 * Math.pow(Math.max(e, -0.5) + 6.07995, -1.6364)));
  const TAU_R = [0.0507, 0.1001, 0.2270];
  const beta = Math.max(0.04608 * T - 0.04586, 0.008);
  const TAU_M = [0.65, 0.55, 0.45].map(l => beta * Math.pow(l, -1.3));
  const mRel = Math.max(airMass(sunEl) - airMass(60), 0);
  const trans = TAU_R.map((t, i) => Math.exp(-(t + TAU_M[i]) * mRel));
  const peak = Math.max(...trans);
  const sunR = trans[0] / peak, sunG = trans[1] / peak, sunB = trans[2] / peak;
  const lum3 = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const bRef = 0.04608 * 3.2 - 0.04586;
  const mRef = Math.max(airMass(30) - airMass(60), 0);
  const dim = lum3(trans) / lum3(TAU_R.map((t, i) => Math.exp(-(t + bRef * Math.pow([0.65, 0.55, 0.45][i], -1.3)) * mRef)));
  const DISC = 0.030, SOFT = 0.016, SUN_RAD = 3800 * dim * sunScale;
  const sat = Math.min(1.25, Math.max(0.45, 1 + 0.06 * (3.2 - T)));
  const desat = c => { const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return c.map(v => l + (v - l) * sat); };
  const ZEN = desat(zen || [0.105, 0.200, 0.440]);
  const HOR = desat(hor || [0.600, 0.660, 0.760]);
  const G0 = gnd || [0.62, 0.50, 0.385];
  const GND = [G0[0] * ground, G0[1] * ground, G0[2] * ground];
  const SCALE = 0.10;
  const norm = (1 + pA * Math.exp(pB)) * (1 + pC * Math.exp(pD * 1.2) + pE * 0.1);
  let p = 0;
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    const dy = Math.sin((v - 0.5) * Math.PI);
    const c = Math.sqrt(Math.max(1 - dy * dy, 0));
    const ct = Math.max(dy, 0.015);
    const grad = 1 + pA * Math.exp(pB / ct);
    const mix = Math.pow(1 - Math.min(Math.max(dy, 0), 1), 3.2);
    const zr = ZEN[0] + (HOR[0] - ZEN[0]) * mix, zg = ZEN[1] + (HOR[1] - ZEN[1]) * mix, zb = ZEN[2] + (HOR[2] - ZEN[2]) * mix;
    const hzk = 0.55 + 0.75 * Math.pow(1 + Math.min(dy, 0), 2.5);
    const above = smoothstep(-0.03, 0.02, dy);
    const hb = smoothstep(-0.010, 0.010, dy);
    for (let i = 0; i < w; i++) {
      const dx = cs[i] * c, dz = sn[i] * c;
      const dot = dx * sx + dy * sy + dz * sz;
      const cosG = dot < -1 ? -1 : dot > 1 ? 1 : dot;
      const gamma = Math.acos(cosG);
      const cp = cosG > 0 ? cosG : 0;
      let R, G, B;
      if (dy > 0) {
        const lum = Math.max((grad * (1 + pC * Math.exp(pD * gamma) + pE * cosG * cosG)) / norm, 0.05);
        R = zr * lum; G = zg * lum; B = zb * lum;
      } else { R = GND[0] * hzk; G = GND[1] * hzk; B = GND[2] * hzk; }
      if (hb > 0 && hb < 1) { R = GND[0] + (R - GND[0]) * hb; G = GND[1] + (G - GND[1]) * hb; B = GND[2] + (B - GND[2]) * hb; }
      const aur = (0.85 * Math.pow(cp, 90) + 0.30 * Math.pow(cp, 9)) * above * sunScale;
      R += aur * sunR; G += aur * sunG; B += aur * sunB;
      if (gamma < DISC + SOFT) {
        const disc = 1 - smoothstep(DISC, DISC + SOFT, gamma);
        R += SUN_RAD * disc * sunR; G += SUN_RAD * disc * sunG; B += SUN_RAD * disc * sunB;
      }
      data[p] = HF(R * SCALE); data[p + 1] = HF(G * SCALE); data[p + 2] = HF(B * SCALE); data[p + 3] = HF(1);
      p += 4;
    }
  }
  return dataTexture(data, w, h);
}

/* ---- 4. surface micro-detail (anodised silver only) ---------------------- */
const TEXN = 512;
function tvnoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % P) + P) % P + seed, x1 = (((xi + 1) % P) + P) % P + seed;
  const y0 = ((yi % P) + P) % P, y1 = (((yi + 1) % P) + P) % P;
  const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function tfbm(u, v, baseFreq, oct, seed) {
  let s = 0, amp = 0.5, f = baseFreq, tot = 0;
  for (let i = 0; i < oct; i++) { s += amp * tvnoise(u * f, v * f, f, seed + i * 977); tot += amp; f *= 2; amp *= 0.5; }
  return s / tot;
}
function band(freq, oct, seed) {
  const out = new Float32Array(TEXN * TEXN);
  for (let y = 0; y < TEXN; y++) for (let x = 0; x < TEXN; x++) out[y * TEXN + x] = tfbm(x / TEXN, y / TEXN, freq, oct, seed);
  return out;
}
function makeMaps(m, tiles) {
  const bandHi = band(32, 3, 11), bandMid = band(8, 4, 733), bandLo = band(2, 3, 1289);
  const H = new Float32Array(TEXN * TEXN);
  for (let i = 0; i < H.length; i++) H[i] = m.hi * bandHi[i] + m.mid * bandMid[i] + m.lo * bandLo[i];
  const at = (x, y) => H[(((y % TEXN) + TEXN) % TEXN) * TEXN + (((x % TEXN) + TEXN) % TEXN)];
  let acc = 0, n = 0;
  for (let y = 0; y < TEXN; y += 2) for (let x = 0; x < TEXN; x += 2) {
    const gx = at(x - 1, y) - at(x + 1, y), gy = at(x, y - 1) - at(x, y + 1);
    acc += gx * gx + gy * gy; n++;
  }
  const strength = m.slope / (Math.sqrt(acc / n) || 1);
  const nd = new Uint8Array(TEXN * TEXN * 4), rd = new Uint8Array(TEXN * TEXN * 4);
  let p = 0;
  for (let y = 0; y < TEXN; y++) for (let x = 0; x < TEXN; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength, ny = (at(x, y - 1) - at(x, y + 1)) * strength;
    const len = Math.hypot(nx, ny, 1);
    nd[p] = (nx / len) * 127.5 + 127.5; nd[p + 1] = (ny / len) * 127.5 + 127.5; nd[p + 2] = (1 / len) * 127.5 + 127.5; nd[p + 3] = 255;
    const i = y * TEXN + x;
    const r = Math.max(0, Math.min(1, 1 - m.roughVar * (0.45 * bandHi[i] + 0.85 * bandMid[i]) / 1.3)) * 255;
    rd[p] = rd[p + 1] = rd[p + 2] = r; rd[p + 3] = 255;
    p += 4;
  }
  const mk = d => {
    const t = new THREE.DataTexture(d, TEXN, TEXN, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 16; t.repeat.set(tiles, tiles); t.needsUpdate = true;
    return t;
  };
  return { n: mk(nd), r: mk(rd) };
}
const SILVER = { color: 0xE9EBEC, rough: 0.33, roughVar: 0.16, env: 1.0, tiles: 13, hi: 0.25, mid: 0.60, lo: 0.30, slope: 0.022, clearcoat: 0.40, ccRough: 0.24, irid: 0.10 };

/* ---- 5. renderer ------------------------------------------------------------ */
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Prism {
  constructor(canvas, W, H, pr = 1) {
    this.W = W; this.H = H; this.pr = pr;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(W * pr), Math.round(H * pr), false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();

    const maps = makeMaps(SILVER, Math.max(1, Math.round(SILVER.tiles * 0.65)));
    this.maps = maps;
    this.material = new THREE.MeshPhysicalMaterial({
      metalness: 1, roughness: 0.35, color: SILVER.color,
      roughnessMap: maps.r, normalMap: maps.n, normalScale: new THREE.Vector2(0, 0),
      envMapIntensity: SILVER.env, clearcoat: SILVER.clearcoat, clearcoatRoughness: SILVER.ccRough,
      clearcoatNormalMap: maps.n, iridescence: SILVER.irid, iridescenceIOR: 1.5, iridescenceThicknessRange: [120, 420]
    });
    this.baseColor = new THREE.Color(SILVER.color);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.pivot.add(this.mesh);
    this.extras = [];               // extra cubes sharing geometry + material
    this.geoKey = '';

    this.env = {};
    this.addEnv('day', buildSky({ w: 512, sunAz: -60, sunEl: 30, turbidity: 2, ground: 1.6 }));
    this.useEnv('day');

    const rtOpts = { type: THREE.HalfFloatType, samples: 4, depthBuffer: true };
    this.msRT = new THREE.WebGLRenderTarget(64, 64, rtOpts);
    this.accRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: false });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.addMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, weight: { value: 1 } },
      vertexShader: QUAD_VS,
      fragmentShader: 'uniform sampler2D tSrc; uniform float weight; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv) * weight; }',
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true
    });
    this.outMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null }, exposure: { value: 1 }, wb: { value: new THREE.Vector3(1, 0.9346, 0.8887) },
        tintTop: { value: new THREE.Color('#0063cc') }, tintBottom: { value: new THREE.Color('#904514') }, tintAmount: { value: 0.1 }, screenY: { value: new THREE.Vector2(0, 1) },
        grade: { value: new THREE.Vector3(1, 1, 1) }, lift: { value: new THREE.Vector3(0, 0, 0) }, opacity: { value: 1 },
        seed: { value: 0 }, grain: { value: 0.006 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tSrc; uniform float exposure; uniform vec3 wb; uniform vec3 tintTop; uniform vec3 tintBottom;
        uniform float tintAmount; uniform vec2 screenY; uniform vec3 grade; uniform vec3 lift; uniform float opacity; uniform float seed; uniform float grain;
        varying vec2 vUv;
        vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        vec3 aces(vec3 color){
          const mat3 ACESInputMat = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
          const mat3 ACESOutputMat = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
          color *= exposure / 0.6; color = ACESInputMat * color; color = RRTAndODTFit(color); color = ACESOutputMat * color; return clamp(color, 0.0, 1.0);
        }
        vec3 oetf(vec3 c){ return mix(c * 12.92, pow(c, vec3(0.41666)) * 1.055 - 0.055, step(0.0031308, c)); }
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec4 s = texture2D(tSrc, vUv);
          float a = clamp(s.a, 0.0, 1.0);
          if (a < 0.0005) { gl_FragColor = vec4(0.0); return; }
          vec3 c = oetf(aces(s.rgb / a));
          c *= wb;
          c = mix(c, c * mix(tintBottom, tintTop, mix(screenY.x, screenY.y, vUv.y)) * 2.0, tintAmount);
          c = c * grade + lift;
          c += (h21(vUv * 731.0 + seed) - 0.5) * grain;
          a *= opacity;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0) * a, a);
        }`,
      depthTest: false, depthWrite: false, transparent: false, blending: THREE.NoBlending
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.addMat);
    this.quadScene.add(this.quad);
    this.p = {};
  }

  addEnv(name, tex) { const rt = this.pmrem.fromEquirectangular(tex); tex.dispose(); this.env[name] = rt.texture; }
  useEnv(name) { if (this.envName !== name) { this.scene.environment = this.env[name]; this.envName = name; } }
  static buildSky(opts) { return buildSky(opts); }

  geometry(fillet, n = 6, height = 0.93) {
    const key = `${fillet.toFixed(3)}|${n.toFixed(2)}|${height.toFixed(3)}`;
    if (key === this.geoKey) return;
    this.geoKey = key;
    const a = 0.5, halfHeight = 0.5 * height;
    const rCurv = minCurvatureRadius(superellipse(a, n, 480));
    const r = Math.max(fillet, 0.0015) * Math.min(rCurv * 0.995, halfHeight * 0.999);
    const geo = buildPrism({ a, n, r, m: 2.75, halfHeight, radial: 200, arc: 22 });
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    for (const e of this.extras) e.geometry = geo;
  }

  setExtras(list) {
    while (this.extras.length < list.length) { const m = new THREE.Mesh(this.mesh.geometry, this.material); this.scene.add(m); this.extras.push(m); }
    this.extras.forEach((m, i) => {
      const e = list[i];
      m.visible = !!e;
      if (!e) return;
      m.position.set(e.x || 0, e.y || 0, e.z || 0);
      m.rotation.set(e.rx || 0, e.spin || 0, e.rz || 0, 'YXZ');
      m.scale.setScalar(e.scale ?? 1);
    });
  }

  // P: { fillet, n, height, elevation, azimuth, spin, tiltX, tiltZ, cx, cy, size, exposure, env, ... }
  pose(P, box) {
    this.geometry(P.fillet ?? 0.57, P.n ?? 6, P.height ?? 0.93);
    const s = P.size;
    const cam = this.camera;
    // box = the screen rectangle this render covers, in css px (y down)
    cam.left = (box.x0 - P.cx) / s; cam.right = (box.x1 - P.cx) / s;
    cam.top = (P.cy - box.y0) / s; cam.bottom = (P.cy - box.y1) / s;
    const el = THREE.MathUtils.degToRad(P.elevation ?? -18), az = THREE.MathUtils.degToRad(P.azimuth ?? 45);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    cam.position.copy(dir).multiplyScalar(20);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    if (P.roll) cam.rotateZ(P.roll);
    cam.near = 0.01; cam.far = 60;
    cam.updateProjectionMatrix();
    // tilt happens around the camera's own axes so it reads as "tumble" on screen
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.quaternion.identity();
    if (P.tiltX || P.tiltZ) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const q1 = new THREE.Quaternion().setFromAxisAngle(right, P.tiltX || 0);
      const q2 = new THREE.Quaternion().setFromAxisAngle(fwd, P.tiltZ || 0);
      this.pivot.quaternion.copy(q2.multiply(q1));
    }
    this.mesh.rotation.set(0, P.spin ?? 0, 0);
    this.mesh.scale.setScalar(P.scale ?? 1);
    this.mesh.position.set(0, P.lift ?? 0, 0);
    this.mesh.visible = P.visible !== false;
    this.material.envMapIntensity = P.envIntensity ?? 1;
    this.material.color.copy(this.baseColor);
    if (P.colorMul) this.material.color.multiply(new THREE.Color(...P.colorMul));
    if (P.env) this.useEnv(P.env);
    if (P.extras) this.setExtras(P.extras); else this.setExtras([]);
  }

  // Screen box that covers every pose (ortho: the prism's bounding sphere is
  // ~0.79 world units, so size * 0.8 plus a margin always contains it).
  boxFor(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const P of list) {
      if (P.visible === false) continue;
      if (P.extras && P.extras.length) return { x0: 0, y0: 0, x1: this.W, y1: this.H };
      const R = 0.82 * P.size * (P.scale ?? 1) * (1 + Math.abs(P.lift ?? 0)) + 6;
      x0 = Math.min(x0, P.cx - R); x1 = Math.max(x1, P.cx + R);
      y0 = Math.min(y0, P.cy - R); y1 = Math.max(y1, P.cy + R);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.W, Math.ceil(x1)); y1 = Math.min(this.H, Math.ceil(y1));
    if (!(x1 > x0 && y1 > y0)) return null;
    // round the size up so render targets are reused across frames
    const q = 64;
    let w = Math.min(this.W, Math.ceil((x1 - x0) / q) * q), h = Math.min(this.H, Math.ceil((y1 - y0) / q) * q);
    x0 = Math.min(x0, this.W - w); y0 = Math.min(y0, this.H - h);
    return { x0, y0, x1: x0 + w, y1: y0 + h, w, h };
  }

  ensure(w, h) {
    w = Math.max(1, Math.round(w * this.pr)); h = Math.max(1, Math.round(h * this.pr));
    if (this.msRT.width !== w || this.msRT.height !== h) { this.msRT.setSize(w, h); this.accRT.setSize(w, h); }
  }

  // Render one or more sub-frame poses (temporal supersampling) and composite.
  render(poses, look = {}, opts = {}) {
    const r = this.renderer;
    const list = (Array.isArray(poses) ? poses : [poses]).filter(Boolean);
    const pr = this.pr, DW = Math.round(this.W * pr), DH = Math.round(this.H * pr);
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, DW, DH);
    if (!opts.keep) { r.setClearColor(0x000000, 0); r.clear(); }
    const box = list.length ? this.boxFor(list) : null;
    this.lastBox = box;
    if (!box) return;
    this.ensure(box.w, box.h);
    this.quad.material = this.addMat;
    r.setRenderTarget(this.accRT);
    r.setClearColor(0x000000, 0); r.clear();
    for (const P of list) {
      this.pose(P, box);
      r.setRenderTarget(this.msRT);
      r.setClearColor(0x000000, 0); r.clear();
      if (P.visible !== false) r.render(this.scene, this.camera);
      r.setRenderTarget(this.accRT);
      this.addMat.uniforms.tSrc.value = this.msRT.texture;
      this.addMat.uniforms.weight.value = 1 / list.length;
      r.render(this.quadScene, this.quadCam);
    }
    const u = this.outMat.uniforms;
    u.tSrc.value = this.accRT.texture;
    u.exposure.value = Math.pow(2, look.exposure ?? 1);
    u.tintAmount.value = look.tintAmount ?? 0.1;
    u.screenY.value.set(1 - box.y1 / this.H, 1 - box.y0 / this.H);
    u.grade.value.set(...(look.grade || [1, 1, 1]));
    u.lift.value.set(...(look.lift || [0, 0, 0]));
    u.opacity.value = look.opacity ?? 1;
    u.seed.value = look.seed ?? 0;
    u.grain.value = look.grain ?? 0.006;
    this.quad.material = this.outMat;
    this.outMat.blending = opts.keep ? THREE.CustomBlending : THREE.NoBlending;
    this.outMat.blendSrc = THREE.OneFactor; this.outMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.outMat.blendSrcAlpha = THREE.OneFactor; this.outMat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.outMat.transparent = !!opts.keep;
    r.setRenderTarget(null);
    const vx = Math.round(box.x0 * pr), vy = Math.round((this.H - box.y1) * pr), vw = this.msRT.width, vh = this.msRT.height;
    r.setViewport(vx, vy, vw, vh);
    r.setScissor(vx, vy, vw, vh);
    r.setScissorTest(true);
    r.render(this.quadScene, this.quadCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, DW, DH);
  }
  renderScene(scene, camera, look = {}) {
    const r = this.renderer, pr = this.pr, DW = Math.round(this.W * pr), DH = Math.round(this.H * pr);
    if (!this.fullRT) this.fullRT = new THREE.WebGLRenderTarget(DW, DH, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    scene.environment = this.scene.environment;
    r.setScissorTest(false);
    r.setRenderTarget(this.fullRT); r.setViewport(0, 0, DW, DH);
    r.setClearColor(0x000000, 0); r.clear();
    r.render(scene, camera);
    const u = this.outMat.uniforms;
    u.tSrc.value = this.fullRT.texture;
    u.exposure.value = Math.pow(2, look.exposure ?? 1);
    u.tintAmount.value = look.tintAmount ?? 0.1;
    u.screenY.value.set(0, 1);
    u.grade.value.set(...(look.grade || [1, 1, 1]));
    u.lift.value.set(...(look.lift || [0, 0, 0]));
    u.opacity.value = look.opacity ?? 1;
    u.seed.value = look.seed ?? 0;
    u.grain.value = look.grain ?? 0.006;
    this.quad.material = this.outMat;
    this.outMat.blending = THREE.NoBlending; this.outMat.transparent = false;
    r.setRenderTarget(null); r.setViewport(0, 0, DW, DH);
    r.setClearColor(0x000000, 0); r.clear();
    r.render(this.quadScene, this.quadCam);
  }
  clear() { const r = this.renderer; r.setRenderTarget(null); r.setScissorTest(false); r.setViewport(0, 0, Math.round(this.W * this.pr), Math.round(this.H * this.pr)); r.setClearColor(0x000000, 0); r.clear(); }
}
