const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const particleVertex = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uSpeak;
uniform float uThinking;
uniform float uSize;
uniform float uPixelRatio;

attribute float aSeed;

varying float vGlow;
varying float vSeed;
varying float vDepth;
varying float vRadius;

${NOISE}

void main() {
  vec3 dir = normalize(position);
  float seed = aSeed;
  float t = uTime;

  float n1 = snoise(dir * 1.9 + vec3(0.0, t * 0.11, seed * 2.0));
  float n2 = snoise(dir * 4.6 - vec3(t * 0.19, 0.0, seed * 3.1));

  float breathe = 0.03 * sin(t * 0.8 + seed * 6.2831);
  float voice = uLevel * (0.09 + 0.15 * (n2 * 0.5 + 0.5));
  float ripple = uSpeak * (0.045 + 0.10 * uBass) * sin(dir.y * 10.0 - t * 8.0 + n1 * 2.6);
  float swirl = uThinking * 0.06 * sin(dir.x * 6.0 + t * 3.2 + n1);

  vec3 p = position + dir * (breathe + voice + ripple + swirl);

  float orbit = t * (0.13 + seed * 0.3) * (0.4 + uLevel * 0.8);
  float oc = cos(orbit);
  float os = sin(orbit);
  p.xz = mat2(oc, -os, os, oc) * p.xz;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(0.001, -mv.z);
  float depth = clamp((4.9 - dist) / 2.4, 0.0, 1.0);

  float size = uSize * (0.55 + 0.9 * seed) * (1.0 + uLevel * 0.4);
  gl_PointSize = size * uPixelRatio * (300.0 / dist) * mix(0.6, 1.0, depth);

  vGlow = 0.5 + 0.4 * pow(clamp(n1 * 0.5 + 0.5, 0.0, 1.0), 2.0) + uLevel * 0.32 + uBass * 0.2;
  vSeed = seed;
  vDepth = mix(0.18, 1.0, depth);
  vRadius = clamp(length(position) / 1.25, 0.0, 1.0);
}
`;

export const particleFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uTime;
uniform float uLevel;
uniform float uTreble;

varying float vGlow;
varying float vSeed;
varying float vDepth;
varying float vRadius;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  float alpha = smoothstep(0.5, 0.0, d);
  alpha = pow(alpha, 2.0);

  vec3 col = mix(uColorA, uColorB, clamp(vSeed * 0.62 + vRadius * 0.22, 0.0, 1.0));
  col = mix(col, uColorC, clamp((1.0 - vRadius) * uLevel * 0.3 + uLevel * vGlow * 0.1, 0.0, 1.0));

  float twinkle = 0.72 + 0.28 * sin(uTime * 2.0 + vSeed * 40.0);
  float shimmer = 0.9 + 0.1 * sin(uTime * 1.3 + vSeed * 18.0 + uTreble * 4.0);

  col = mix(col, vec3(1.0, 0.62, 0.28), step(0.965, vSeed) * (0.42 + 0.3 * uLevel));

  gl_FragColor = vec4(col * vGlow * twinkle * shimmer, min(1.0, alpha * (0.32 + 0.5 * vGlow) * vDepth));
}
`;

export const nucleusVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const nucleusFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColorHot;
uniform float uTime;
uniform float uLevel;

varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;

  float core = pow(max(0.0, 1.0 - d), 5.0);
  float flare = pow(max(0.0, 1.0 - d), 2.0) * 0.1;
  float pulse = 0.55 + 0.1 * sin(uTime * 3.0) + uLevel * 0.3;

  vec3 col = mix(uColor, uColorHot, core);
  gl_FragColor = vec4(col, (core + flare) * pulse);
}
`;

export const haloVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const haloFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = length(p);
  float ang = atan(p.y, p.x);

  float glow = pow(max(0.0, 1.0 - d), 3.4);
  float wisp = 0.72 + 0.28 * sin(ang * 5.0 + uTime * 0.35);
  float breath = 0.9 + 0.1 * sin(uTime * 1.1);

  float alpha = glow * 0.14 * wisp * breath * (0.45 + uLevel * 0.45);
  gl_FragColor = vec4(uColor, alpha);
}
`;
