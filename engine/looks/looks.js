// Looks: post-process filters that restyle any finished render. Each is a WebGL2 fragment shader run
// over every frame by engine/look.mjs (and the Studio's Look menu). Shared uniforms:
//   u_src (the frame) · u_res (px) · u_t (seconds) · u_k (px scale: 1 at 1080 on the short side)
//   u_glyphs / u_n (glyph atlas, terminal only)
// Brand inks: paper #f3f4f6 · ink #15171a · signal #e0351f.

const COMMON = `#version 300 es
precision highp float;
uniform sampler2D u_src; uniform vec2 u_res; uniform float u_t; uniform float u_k;
in vec2 v_uv; out vec4 o;
vec3 src(vec2 px) { return texture(u_src, clamp(px / u_res, 0.0, 1.0) * vec2(1.0, 1.0)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
const vec3 PAPER = vec3(0.953, 0.957, 0.965), INK = vec3(0.082, 0.090, 0.102), SIGNAL = vec3(0.878, 0.208, 0.122);
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float bayer(vec2 p) {                                     // 8 × 8 ordered-dither threshold in (0, 1)
  vec2 a = mod(p, 2.0), b = mod(floor(p / 2.0), 2.0), c = mod(floor(p / 4.0), 2.0);
  float v = (4.0 * a.x * (1.0 - a.y) + 2.0 * a.y * (1.0 - a.x) + 3.0 * a.x * a.y) * 16.0
          + (4.0 * b.x * (1.0 - b.y) + 2.0 * b.y * (1.0 - b.x) + 3.0 * b.x * b.y) * 4.0
          + (4.0 * c.x * (1.0 - c.y) + 2.0 * c.y * (1.0 - c.x) + 3.0 * c.x * c.y);
  return (v + 0.5) / 64.0;
}
`;

export const LOOKS = {
  terminal: {
    label: 'Terminal',
    about: 'Every frame redrawn in Geist Mono glyphs, coloured by the picture, on a near-black screen',
    glyphs: ' .:-=+*cuboe#%@',
    frag: COMMON + `
uniform sampler2D u_glyphs; uniform float u_n;
void main() {
  vec2 px = v_uv * u_res;
  vec2 cell = vec2(12.0, 22.0) * u_k;
  vec2 id = floor(px / cell), f = fract(px / cell);
  vec2 c = (id + 0.5) * cell;
  vec3 col = (src(c) + src(c + cell * vec2(-0.25, -0.25)) + src(c + cell * vec2(0.25, 0.25)) + src(c + cell * vec2(0.25, -0.25))) * 0.25;
  float l = pow(smoothstep(0.04, 0.75, luma(col)), 0.7);
  float g = floor(clamp(l, 0.0, 0.999) * u_n);
  float cov = texture(u_glyphs, vec2((g + f.x) / u_n, f.y)).r;
  vec3 bg = vec3(0.039, 0.045, 0.055);
  vec3 fg = mix(vec3(0.45, 0.95, 0.66), col * 1.6 + 0.18, 0.45);        // phosphor green, tinted by the picture
  float scan = 0.92 + 0.08 * sin(px.y * 3.14159 / (2.0 * u_k));
  o = vec4(mix(bg, fg, cov) * scan + bg * 0.15 * l, 1.0);
}`,
  },
  print: {
    label: 'Halftone print',
    about: 'Two-plate halftone, ink and signal red, slightly misregistered on paper',
    frag: COMMON + `
float plate(vec2 px, float ang, float cell, float dens) {
  vec2 q = rot(ang) * px / cell;
  vec2 d = fract(q) - 0.5;
  float r = sqrt(clamp(dens, 0.0, 1.0)) * 0.62;
  return 1.0 - smoothstep(r - 0.06, r + 0.06, length(d));
}
void main() {
  vec2 px = v_uv * u_res;
  float cell = 7.0 * u_k;
  vec3 c = src(px);
  float dark = 1.0 - luma(c);
  float warm = clamp((c.r - max(c.g, c.b)) * 2.2 + (c.r - c.b) * 0.6, 0.0, 1.0);
  float k = plate(px, 0.785, cell, dark * 1.05 - 0.04);
  float r = plate(px + vec2(1.6, -1.1) * u_k, 0.262, cell, warm);
  vec3 col = PAPER * (1.0 - 0.92 * k);
  col *= mix(vec3(1.0), SIGNAL * 1.08, r * 0.95);
  col *= 0.97 + 0.03 * hash(floor(px / (1.5 * u_k)));                 // paper tooth
  o = vec4(col, 1.0);
}`,
  },
  blueprint: {
    label: 'Blueprint',
    about: 'Edges drawn in ink on the Swiss paper plate, with the dot grid and a red construction line',
    frag: COMMON + `
float L(vec2 px) { return luma(src(px)); }
void main() {
  vec2 px = v_uv * u_res;
  float s = 1.2 * u_k;
  float tl = L(px + vec2(-s, -s)), t = L(px + vec2(0, -s)), tr = L(px + vec2(s, -s));
  float l = L(px + vec2(-s, 0)), r = L(px + vec2(s, 0));
  float bl = L(px + vec2(-s, s)), b = L(px + vec2(0, s)), br = L(px + vec2(s, s));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float e = smoothstep(0.08, 0.35, length(vec2(gx, gy)));
  float dark = 1.0 - L(px);
  vec2 g = mod(px, 24.0 * u_k) - 12.0 * u_k;
  float dot = 1.0 - smoothstep(1.0 * u_k, 1.7 * u_k, length(g));
  float hatch = step(0.62, dark) * step(0.5, fract((px.x + px.y) / (6.0 * u_k)));
  vec3 col = PAPER;
  col = mix(col, INK, 0.13 * dot);
  col = mix(col, INK, 0.10 * hatch);
  col = mix(col, INK, e * 0.92);
  float cross = 1.0 - smoothstep(0.0, 1.2 * u_k, abs(px.y - u_res.y * 0.5));
  col = mix(col, SIGNAL, cross * 0.55 * step(fract(px.x / (14.0 * u_k)), 0.6));
  o = vec4(col, 1.0);
}`,
  },
  bitmap: {
    label: '1-bit',
    about: 'Ordered-dither black and white, like a classic Mac screen',
    frag: COMMON + `
void main() {
  vec2 px = v_uv * u_res;
  float ps = max(1.0, floor(2.0 * u_k + 0.5));
  vec2 cell = floor(px / ps);
  float l = luma(src((cell + 0.5) * ps));
  l = clamp((l - 0.5) * 1.35 + 0.52, 0.0, 1.0);
  o = vec4(mix(INK, PAPER, step(bayer(cell), l)), 1.0);
}`,
  },
  riso: {
    label: 'Riso',
    about: 'Two-ink risograph, federal blue and signal red, grainy and off-register',
    frag: COMMON + `
const vec3 BLUE = vec3(0.180, 0.271, 0.700);
// ordered dither with a little noise, so type stays crisp and flats read as riso grain
float grain(vec2 px, float d, float seed) {
  vec2 cell = floor(px / max(1.0, floor(1.5 * u_k + 0.5)));
  float th = mix(bayer(cell + seed), hash(cell + seed + floor(u_t * 12.0)), 0.3);
  return step(th, d);
}
void main() {
  vec2 px = v_uv * u_res;
  vec3 c = src(px + vec2(-1.8, 1.2) * u_k);
  vec3 c2 = src(px + vec2(1.8, -0.8) * u_k);
  float lb = 1.0 - luma(c);
  float warm = clamp((c2.r - max(c2.g, c2.b)) * 2.5, 0.0, 1.0);
  float b = grain(px, smoothstep(0.05, 0.9, lb) * 0.82, 1.7);
  float r = grain(px + 3.1, max(warm, smoothstep(0.55, 1.0, 1.0 - luma(c2)) * 0.35), 5.3);
  vec3 col = vec3(0.957, 0.945, 0.918);
  col *= mix(vec3(1.0), BLUE * 1.15, b * 0.9);
  col *= mix(vec3(1.0), SIGNAL * 1.12, r * 0.85);
  o = vec4(col, 1.0);
}`,
  },
};
