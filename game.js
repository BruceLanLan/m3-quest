/* =====================================================================
   M3 Crossing · HD-2D v4
   Octopath-style Animal Crossing · Switch-AC scope
   M3 Powered

   File structure:
     1. WebGL HD-2D engine v4
        - true 3/4 isometric camera (45°)
        - 5-layer depth (sky / ground / grass-overlay / prop / char / fg)
        - dynamic sun-angle + time-of-day color grading
        - depth fog with smooth distance falloff
        - dynamic shadows under all entities
        - particle systems (leaves, dust, fireflies, rain, snow)
        - bloom-like glow on lit windows & water
        - smooth camera zoom + screen-shake
     2. Sprite system (procedural atlas)
     3. World + gameplay
     4. UI + boot
   ===================================================================== */
(function () {
'use strict';

// =====================================================================
// SECTION 1 · WebGL HD-2D ENGINE v4
// =====================================================================

const canvas = document.getElementById('game');
const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
if (!gl) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-family:monospace">WebGL not supported. Use a modern browser.</div>';
  return;
}

// -- viewport sizing (internal fixed render at 1280x720, CSS scales) --
const VW = 1280, VH = 720;
function resizeCanvas() {
  // Fit canvas to viewport while maintaining aspect ratio
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetRatio = VW / VH;
  const viewRatio = vw / vh;
  let cssW, cssH;
  if (viewRatio > targetRatio) {
    cssH = vh;
    cssW = vh * targetRatio;
  } else {
    cssW = vw;
    cssH = vw / targetRatio;
  }
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  // internal resolution stays at 1280x720
  canvas.width = VW;
  canvas.height = VH;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// =====================================================================
// 1.1 SHADERS
// =====================================================================
// v4 fragment shader adds: dynamic sun angle, time-of-day grading,
// depth fog, water shimmer with sin, particle additive blending
// =====================================================================

const VS = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  attribute float a_layer;
  attribute float a_lit;
  attribute float a_alpha;
  attribute vec3 a_tint;
  attribute float a_glow;
  varying vec2 v_uv;
  varying float v_layer;
  varying float v_lit;
  varying float v_alpha;
  varying vec3 v_tint;
  varying float v_glow;
  varying float v_ndcY;
  varying float v_ndcX;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
    v_layer = a_layer;
    v_lit = a_lit;
    v_alpha = a_alpha;
    v_tint = a_tint;
    v_glow = a_glow;
    v_ndcY = a_pos.y;  // pass through NDC y for atmospheric haze
    v_ndcX = a_pos.x;  // pass through NDC x for vignette
  }
`;

const FS = `
  precision mediump float;
  varying vec2 v_uv;
  varying float v_layer;
  varying float v_lit;
  varying float v_alpha;
  varying vec3 v_tint;
  varying float v_glow;
  varying float v_ndcY;
  varying float v_ndcX;

  uniform sampler2D u_tex;
  uniform float u_time;
  uniform float u_fog;       // 0..1 fog density
  uniform vec3 u_fogColor;   // fog tint
  uniform float u_sunLevel;  // 0 = night, 1 = full day, dawn/dusk ~ 0.5
  uniform vec3 u_sunColor;   // warm yellow at day, blue at night
  uniform vec3 u_ambColor;   // ambient color
  uniform float u_phase;     // 0..1 time within day phase for color shifts

  void main() {
    vec4 c = texture2D(u_tex, v_uv);
    if (c.a < 0.01) discard;

    // tint
    c.rgb *= v_tint;

    // dynamic lighting (multiplicative)
    vec3 lit = mix(u_ambColor, u_sunColor, v_lit);
    c.rgb *= lit;

    // distance fog
    float fogDist = clamp(u_fog, 0.0, 1.0);
    c.rgb = mix(c.rgb, u_fogColor, fogDist);

    // atmospheric haze: screen-bottom (nearer camera) is slightly warmer,
    // screen-top (farther) is slightly cooler / desaturated. Painterly Octopath feel.
    float vHaze = v_ndcY;  // -1 = bottom, +1 = top
    if (v_layer < 0.5) {  // ground tiles only
      // top of screen: blend a touch more toward fog (deeper, cooler)
      // bottom: keep warmer
      float topFog = smoothstep(0.0, 0.7, vHaze) * 0.15;
      c.rgb = mix(c.rgb, u_fogColor * 1.1, topFog);
      // bottom 30%: warm it up a touch
      float bottomWarm = smoothstep(0.0, -0.5, vHaze) * 0.06;
      c.rgb = c.rgb * (vec3(1.0) + vec3(0.04, 0.02, 0.0)) * (1.0 + bottomWarm);
    }

    // AO (ambient occlusion) at tile edges — vertices at the corners are darker
    // (Octopath's signature "deep grout" look)
    if (v_layer < 0.5) {
      // v_uv goes (0,0) to (1,1) per tile; corners (uv near 0 or 1) get darker
      float ax = abs(v_uv.x - 0.5) * 2.0;  // 0 at center, 1 at edges
      float ay = abs(v_uv.y - 0.5) * 2.0;
      float edge = max(ax, ay);
      float ao = 1.0 - edge * 0.18;  // up to 18% darker at edges
      c.rgb *= ao;
    }

    // water shimmer (animated highlight on layer 2)
    if (v_layer > 1.5 && v_layer < 2.5) {
      float s = sin(u_time*2.0 + v_uv.x*20.0 + v_uv.y*15.0) * 0.07 + 0.05;
      c.rgb += vec3(s, s, s*1.3);
    }

    // lit windows / lanterns get a glow boost (additive)
    if (v_glow > 0.5) {
      // emulate bloom: brighten + add halo to bright pixels
      float lum = max(max(c.r, c.g), c.b);
      if (lum > 0.6) {
        c.rgb += vec3(0.25, 0.18, 0.08) * (lum - 0.6) * 2.0;
      }
    }

    // === PAINTERLY COLOR GRADING (Octopath Mobile style) ===
    // The standard AC palette is too saturated / too bright. This pipeline
    // crushes blacks, lifts highlights warm, and shifts shadows cool.
    // 1. S-curve contrast: darken midtones, brighten highlights
    c.rgb = (c.rgb - 0.5) * 1.18 + 0.5;  // contrast +18%
    c.rgb = c.rgb * c.rgb * (3.0 - 2.0 * c.rgb);  // smoothstep S-curve
    c.rgb = mix(c.rgb, c.rgb * 1.05, 0.5);  // restore some mid
    // 2. Warm shadows / cool highlights (split-toning like Octopath)
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    vec3 shadowTint = vec3(0.92, 0.96, 1.10);  // cool blue in shadows
    vec3 highlightTint = vec3(1.12, 1.05, 0.92);  // warm orange in highlights
    float shadowMask = 1.0 - smoothstep(0.0, 0.5, lum);
    float highlightMask = smoothstep(0.5, 0.95, lum);
    c.rgb *= mix(vec3(1.0), shadowTint, shadowMask * 0.35);
    c.rgb *= mix(vec3(1.0), highlightTint, highlightMask * 0.30);
    // 3. Saturation -10% (less kiddy, more painterly)
    c.rgb = mix(vec3(lum), c.rgb, 0.88);
    // 4. Vignette (subtle darken at screen corners)
    float vig = 1.0 - 0.18 * pow(abs(v_ndcX), 2.0) - 0.18 * pow(abs(v_ndcY), 2.0);
    c.rgb *= clamp(vig, 0.7, 1.0);

    gl_FragColor = vec4(c.rgb, c.a * v_alpha);
  }
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
  }
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  console.error('Link error:', gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

const aPos    = gl.getAttribLocation(prog, 'a_pos');
const aUv     = gl.getAttribLocation(prog, 'a_uv');
const aLayer  = gl.getAttribLocation(prog, 'a_layer');
const aLit    = gl.getAttribLocation(prog, 'a_lit');
const aAlpha  = gl.getAttribLocation(prog, 'a_alpha');
const aTint   = gl.getAttribLocation(prog, 'a_tint');
const aGlow   = gl.getAttribLocation(prog, 'a_glow');
const uTex       = gl.getUniformLocation(prog, 'u_tex');
const uTime      = gl.getUniformLocation(prog, 'u_time');
const uFog       = gl.getUniformLocation(prog, 'u_fog');
const uFogColor  = gl.getUniformLocation(prog, 'u_fogColor');
const uSunLevel  = gl.getUniformLocation(prog, 'u_sunLevel');
const uSunColor  = gl.getUniformLocation(prog, 'u_sunColor');
const uAmbColor  = gl.getUniformLocation(prog, 'u_ambColor');
const uPhase     = gl.getUniformLocation(prog, 'u_phase');

// =====================================================================
// 1.2 DYNAMIC VBO
// =====================================================================
// 6 verts per quad (2 triangles), 10 floats per vert
// pos.xy, uv.xy, layer, lit, alpha, tint.rgb, glow
// 4 verts... wait — 6 vertices: 2 triangles share edge, 6 distinct verts
// =====================================================================

const FLOATS_PER_VERT = 10;
const VERTS_PER_QUAD = 6;
const MAX_QUADS = 8192;
const buf = gl.createBuffer();
const vdata = new Float32Array(MAX_QUADS * VERTS_PER_QUAD * FLOATS_PER_VERT);
let vHead = 0;
let vDraw = 0;

function pushQuad(x0, y0, x1, y1, u0, v0, u1, v1, layer, lit, alpha, tr, tg, tb, glow) {
  if (vHead + 6 > MAX_QUADS * VERTS_PER_QUAD) return;
  const F = FLOATS_PER_VERT;
  let o = vHead * F;
  // triangle 1: (x0,y0) (x1,y0) (x0,y1)
  vdata[o]=x0; vdata[o+1]=y0; vdata[o+2]=u0; vdata[o+3]=v0; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  vdata[o]=x1; vdata[o+1]=y0; vdata[o+2]=u1; vdata[o+3]=v0; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  vdata[o]=x0; vdata[o+1]=y1; vdata[o+2]=u0; vdata[o+3]=v1; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  // triangle 2: (x1,y0) (x1,y1) (x0,y1)
  vdata[o]=x1; vdata[o+1]=y0; vdata[o+2]=u1; vdata[o+3]=v0; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  vdata[o]=x1; vdata[o+1]=y1; vdata[o+2]=u1; vdata[o+3]=v1; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  vdata[o]=x0; vdata[o+1]=y1; vdata[o+2]=u0; vdata[o+3]=v1; vdata[o+4]=layer; vdata[o+5]=lit; vdata[o+6]=alpha; vdata[o+7]=tr; vdata[o+8]=tg; vdata[o+9]=tb; vdata[o+10]=glow; o+=F;
  vHead += 6;
}

// =====================================================================
// 1.3 SPRITE ATLAS
// =====================================================================
// Procedural atlas — sprite cells are drawn via 2D context, then
// uploaded as a single texture. Pixel-art style with NEAREST sampling.
// =====================================================================

const ATLAS_W = 2048, ATLAS_H = 2048;
const atlas = document.createElement('canvas');
atlas.width = ATLAS_W; atlas.height = ATLAS_H;
const atlasCtx = atlas.getContext('2d');
atlasCtx.imageSmoothingEnabled = false;

const atlasTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, atlasTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const cells = {}; // name → {x, y, w, h}
let cellCursor = {x: 0, y: 0, rowH: 0};

function allocCell(name, w, h) {
  if (cellCursor.x + w > ATLAS_W) {
    cellCursor.x = 0;
    cellCursor.y += cellCursor.rowH + 2;
    cellCursor.rowH = 0;
  }
  if (cellCursor.y + h > ATLAS_H) { console.error('atlas full', name); return null; }
  const cell = {name, x: cellCursor.x, y: cellCursor.y, w, h};
  cells[name] = cell;
  cellCursor.x += w + 2;
  cellCursor.rowH = Math.max(cellCursor.rowH, h);
  return cell;
}

function drawOntoAtlas(cell, drawFn) {
  atlasCtx.save();
  atlasCtx.translate(cell.x, cell.y);
  drawFn(atlasCtx, cell.w, cell.h);
  atlasCtx.restore();
}

let atlasDirty = true;
function flushAtlas() {
  if (!atlasDirty) return;
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  atlasDirty = false;
}
function markDirty() { atlasDirty = true; }

// =====================================================================
// 1.4 CAMERA & PROJECTION  (v4: true 3/4 isometric)
// =====================================================================
// We use a classic axonometric projection. World is 2D grid (tile coords).
// Screen X = (wx - wy) * cos(30°)
// Screen Y = (wx + wy) * sin(30°)  -  wz * charHeight
// The "depth" axis (which tile renders on top) is wy (south).
// Tile size: TILE = 64 world pixels. On screen TILE_W = TILE, TILE_H = TILE/2.
// =====================================================================

const TILE = 64;          // world tile (square)
const TILE_W = 64;        // screen width of a tile
const TILE_H = 32;        // screen height of a tile (2:1 ratio = 30° tilt)
const HALF_W = VW / 2;
const HALF_H = VH / 2;
const BASE_Y = VH * 0.55; // horizon position (lower 2/3 shows ground)
const CHAR_H = 56;        // height of a character (in screen px, "tall" sprites)
const PROP_H = 48;        // height of a building/prop

const cam = {
  x: 0, y: 0,            // world center (in world tile units)
  px: 0, py: 0,          // cached screen-pixel position
  zoom: 1.0,
  targetZoom: 1.0,
  shake: 0,
};

function project(wx, wy, wz) {
  // tile (wx,wy) → screen pixel
  // axonometric: dx = (wx-wy)*TILE/2, dy = (wx+wy)*TILE/2
  // then offset by (HALF_W, BASE_Y) and subtract camera (in tile units * TILE)
  const dx = (wx - cam.x) * (TILE_W / 2) - (wy - cam.y) * (TILE_W / 2);
  const dy = (wx - cam.x) * (TILE_H / 2) + (wy - cam.y) * (TILE_H / 2);
  let sx = HALF_W + dx * cam.zoom;
  let sy = BASE_Y + dy * cam.zoom - wz * cam.zoom;
  if (cam.shake > 0) {
    sx += (Math.random() - 0.5) * cam.shake * 2;
    sy += (Math.random() - 0.5) * cam.shake * 2;
  }
  return { sx, sy, scale: cam.zoom };
}

// world depth for a (wx, wy) — used to Z-sort tiles
function depthKey(wx, wy) { return wx + wy; }

// =====================================================================
// SECTION 2 · SPRITE SYSTEM
// =====================================================================
// Procedurally drawn sprites. Cells are 32x32 (tiles), 64x64 (chars),
// 16x16 (item icons), 32x48 (buildings, drawn tall with grass base).
// =====================================================================

const PAL = {
  // sky
  skyDawn:  '#f5b27a', skyDay:   '#a8d8ea', skyDusk:  '#e8956b', skyNight: '#1b2240',
  skyDawn2: '#fde36a', skyDusk2: '#c84a3a',
  // ground
  grass:    '#7cbe3a', grassD:   '#5fa226', grassDark:'#3e6f1c', grassV:  '#a3d65a',
  path:     '#e7c87f', pathD:    '#c39a4f',
  sand:     '#f6e2a4', sandD:    '#d8c079',
  water:    '#4fa8d8', waterD:   '#3a82b3', waterL:   '#7fcce4',
  cliff:    '#8b6d4a', cliffD:   '#5a4a2a', cliffL:   '#a8a078',
  // objects
  tree:     '#2e6e2a', treeD:    '#1c4a18', leaf:     '#3aa14a', leafD:   '#2c8138', leafL: '#5dc25c',
  wood:     '#8b5a2b', woodD:    '#5a3a1a', woodL:    '#a37041',
  stone:    '#9aa0a6', stoneD:   '#6b6f76', stoneL:   '#c0c5cb',
  // flowers
  fR:       '#e85b7c', fY:       '#fde36a', fP:       '#c896ff', fW:     '#ffffff', fO: '#fb923c',
  // roofs
  rR:       '#c84a3a', rB:       '#3a5a8a', rG:       '#5a8a3a', rM:     '#7c3aed', rY: '#e8b83a',
  wall:     '#f6dca0', wallD:    '#d8b76a', wallP:    '#e9c5d5', wallG:  '#b6dba0',
  door:     '#5a3a1a', window:   '#a8d8ea', windowLit:'#fde36a', winDark:'#3d6a8a',
  // animals
  skin:     '#ffd6a5', skinD:    '#d4a574',
  catA:     '#d68f5d', catB:     '#a37041', catC:     '#7a5530',
  bearA:    '#8b5a2b', bearB:    '#5a3a1a',
  pigP:     '#f7a8c0', pigD:     '#d9849a',
  frogG:    '#84cc16', frogD:    '#65a30d', frogL:    '#bef264',
  dogB:     '#d4a574', dogA:     '#a37041',
  wolfG:    '#7a7a82', wolfD:    '#3f3f47',
  elephant: '#a8a8b0', elephantD:'#5a5a64',
  rabbitW:  '#f5f0e1', rabbitP:  '#f7a8c0',
  lionO:    '#fb923c', lionM:    '#a8a8b0', lionY:    '#fde36a',
  raccoon:  '#5a5a64', raccoonD: '#2d2d35', raccoonM: '#7c3aed',
  penguin:  '#1c1917', penguinW: '#f5f0e1', penguinO: '#fb923c',
  deerA:    '#c4a878', deerB:    '#8b6d4a', deerSpot: '#f5f0e1',
  mouseG:   '#a8a8b0', mouseP:   '#f7a8c0',
  hippoP:   '#c896ff', hippoD:   '#7c3aed',
  horseB:   '#8b5a2b', horseD:   '#5a3a1a', horseM:   '#d4a574',
  chicken:  '#fef3c7', chickenD: '#d4a574', chickenR: '#dc2626',
  koala:    '#78716c', koalaD:   '#44403c',
  goat:     '#e7e5e4', goatD:    '#a8a29e',
  octopus:  '#fb923c', octoD:    '#c2410c',
  eagle:    '#5a3a1a', eagleW:   '#f5f0e1',
  // player
  m3:       '#7c3aed', m3L:      '#c896ff', m3D:    '#5b21b6',
  m3Skin:   '#ffd6a5', m3Fur:   '#5a5a64', m3FurD: '#2d2d35',
  // items
  gold:     '#fde047', goldD:    '#a17e0c',
  silver:   '#d1d5db', silverD:  '#6b7280',
  green:    '#16a34a', greenD:   '#166534',
  red:      '#dc2626', redD:     '#7f1d1d',
  blue:     '#2563eb', blueD:    '#1e3a8a',
  purple:   '#7c3aed', purpleL:  '#c896ff',
  // generic
  ink:      '#1c1917', white:    '#fefefe', grey:     '#78716c',
  shadow:   'rgba(0,0,0,0.32)',
};

function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x|0, y|0, 1, 1); }
function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x|0, y|0, w|0, h|0); }
function dot(ctx, x, y, c, r=1) {
  ctx.fillStyle = c;
  for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
    if (dx*dx + dy*dy <= r*r) px(ctx, x+dx, y+dy, c);
  }
}

// =====================================================================
// 2.1  TILE SPRITES  (32x32 base, drawn with grass/decor)
// =====================================================================

function buildTile(name) {
  // Buildings use 32x48 (tall, 3D-feel). Terrain/props/items use 32x32.
  // Characters use 64x64 (defined separately in buildCharSprite).
  const isBuilding = name === 'house-mayor' || name === 'house-modern' || name === 'house-shack' ||
                     name === 'shop' || name === 'bank' || name === 'museum' || name === 'pawn' ||
                     name === 'tent' || name === 'warehouse' || name === 'tent-green' ||
                     name === 'tower' || name === 'bridge-h' || name === 'bridge-v' ||
                     name === 'sign' || name === 'nooks' || name === 'able' || name === 'kks' ||
                     name === 'resident' || name === 'tent-2';
  const W = 32, H = isBuilding ? 48 : 32;
  const cell = allocCell(name, W, H);
  if (!cell) return;
  drawOntoAtlas(cell, (g) => {
    switch (name) {
      // --- grass variants ---
      case 'grass': {
        rect(g, 0, 0, W, H, PAL.grass);
        for (let i=0; i<24; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.grassD);
        for (let i=0; i<10; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.grassV);
        break;
      }
      case 'grass-dark': {
        rect(g, 0, 0, W, H, PAL.grass);
        for (let i=0; i<14; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.grassD);
        for (let i=0; i<8; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.grassDark);
        break;
      }
      case 'tall-grass': {
        rect(g, 0, 0, W, H, PAL.grass);
        for (let x=0; x<W; x+=2) {
          const h2 = 8 + (Math.sin(x*0.7)*3|0) + (Math.random()*4|0);
          rect(g, x, H-h2, 1, h2, PAL.leafD);
          rect(g, x+1, H-h2+1, 1, h2-1, PAL.leaf);
        }
        break;
      }
      // --- paths ---
      case 'path-h': {
        rect(g, 0, 0, W, H, PAL.path);
        for (let i=0; i<10; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.pathD);
        break;
      }
      case 'path-v': {
        rect(g, 0, 0, W, H, PAL.path);
        for (let i=0; i<10; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.pathD);
        break;
      }
      case 'path-cross': {
        rect(g, 0, 0, W, H, PAL.path);
        for (let i=0; i<8; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.pathD);
        break;
      }
      case 'path-brick': {
        // AC brick pattern (red-brown)
        rect(g, 0, 0, W, H, '#a37041');
        rect(g, 0, 7, W, 1, '#5a3a1a');
        rect(g, 0, 15, W, 1, '#5a3a1a');
        rect(g, 0, 23, W, 1, '#5a3a1a');
        rect(g, 7, 0, 1, 7, '#5a3a1a');
        rect(g, 15, 8, 1, 7, '#5a3a1a');
        rect(g, 23, 0, 1, 7, '#5a3a1a');
        rect(g, 7, 16, 1, 7, '#5a3a1a');
        rect(g, 23, 16, 1, 7, '#5a3a1a');
        break;
      }
      case 'path-stone': {
        // AC stone tile (cool gray)
        rect(g, 0, 0, W, H, '#a8a8b0');
        rect(g, 0, 0, 16, 1, '#78716c');
        rect(g, 0, 0, 1, 16, '#78716c');
        rect(g, 15, 0, 1, 16, '#78716c');
        rect(g, 0, 15, 16, 1, '#78716c');
        rect(g, 6, 6, 4, 4, '#9aa0a6');
        rect(g, 12, 12, 4, 4, '#9aa0a6');
        break;
      }
      case 'path-wood': {
        // AC wood deck pattern
        rect(g, 0, 0, W, H, PAL.wood);
        rect(g, 0, 5, W, 1, PAL.woodD);
        rect(g, 0, 10, W, 1, PAL.woodD);
        rect(g, 0, 15, W, 1, PAL.woodD);
        rect(g, 0, 20, W, 1, PAL.woodD);
        rect(g, 0, 25, W, 1, PAL.woodD);
        break;
      }
      case 'path-grass': {
        // AC grass-path (darker grass tufts)
        rect(g, 0, 0, W, H, PAL.grass);
        for (let i=0; i<14; i++) {
          const x = (Math.random()*W)|0, y = (Math.random()*H)|0;
          px(g, x, y, PAL.grassD);
        }
        for (let i=0; i<6; i++) {
          const x = (Math.random()*W)|0, y = (Math.random()*H)|0;
          px(g, x, y, PAL.grassDark);
        }
        break;
      }
      case 'cliff-ramp-n': {
        // ramp going from south to north (1 elevation step)
        rect(g, 0, 0, W, 8, PAL.grass);
        rect(g, 0, 8, W, 8, PAL.cliffL);
        rect(g, 0, 16, W, 16, PAL.cliff);
        rect(g, 0, 23, W, 1, PAL.cliffD);
        break;
      }
      case 'cliff-ramp-e': {
        rect(g, 0, 0, W, 8, PAL.grass);
        rect(g, 0, 8, 8, 24, PAL.cliffL);
        rect(g, 8, 8, 24, 24, PAL.cliff);
        rect(g, 22, 8, 1, 24, PAL.cliffD);
        break;
      }
      case 'asphalt': {
        rect(g, 0, 0, W, H, '#3a3d44');
        for (let i=0; i<6; i++) px(g, Math.random()*W|0, Math.random()*H|0, '#2a2d34');
        rect(g, W/2-1, 0, 2, H, PAL.gold);
        break;
      }
      case 'asphalt-cross': {
        rect(g, 0, 0, W, H, '#3a3d44');
        for (let i=0; i<6; i++) px(g, Math.random()*W|0, Math.random()*H|0, '#2a2d34');
        rect(g, W/2-1, 0, 2, H, PAL.gold);
        rect(g, 0, H/2-1, W, 2, PAL.gold);
        break;
      }
      // --- sand ---
      case 'sand': {
        rect(g, 0, 0, W, H, PAL.sand);
        for (let i=0; i<8; i++) px(g, Math.random()*W|0, Math.random()*H|0, PAL.sandD);
        break;
      }
      // --- water (animated via 3 frames) ---
      case 'water-0': case 'water-1': case 'water-2': {
        const f = parseInt(name.split('-')[1]);
        rect(g, 0, 0, W, H, PAL.water);
        // shimmer dashes that move with frame
        const patterns = [
          [[0,8,10,1],[14,18,14,1],[4,26,12,1],[0,4,6,1],[16,12,8,1]],
          [[4,12,8,1],[18,22,10,1],[2,28,4,1],[12,4,6,1],[8,16,12,1]],
          [[2,4,6,1],[10,18,10,1],[20,28,8,1],[6,12,4,1],[0,22,14,1]],
        ];
        for (const [x,y,w,h] of patterns[f]) {
          rect(g, x, y, w, h, y % 8 === 0 ? PAL.waterD : PAL.waterL);
        }
        break;
      }
      // --- cliff (raised tile) ---
      case 'cliff': {
        // top edge
        rect(g, 0, 0, W, 6, PAL.cliffL);
        rect(g, 0, 4, W, 2, PAL.cliff);
        // body
        rect(g, 0, 6, W, H-6, PAL.cliff);
        rect(g, 0, H-4, W, 4, PAL.cliffD);
        // cracks
        for (let i=0; i<4; i++) px(g, Math.random()*W|0, 8 + Math.random()*(H-12)|0, PAL.cliffD);
        break;
      }
      case 'cliff-top': {
        // top of cliff (grass overhanging)
        rect(g, 0, 0, W, 8, PAL.grass);
        rect(g, 0, 4, W, 2, PAL.grassD);
        rect(g, 0, 8, W, 4, PAL.cliffL);
        rect(g, 0, 12, W, H-12, PAL.cliff);
        break;
      }
      // --- trees ---
      case 'tree': {
        // trunk
        rect(g, 14, 20, 4, 10, PAL.wood);
        rect(g, 12, 28, 8, 4, PAL.woodD);
        // foliage (3 layers)
        rect(g, 4, 6, 24, 18, PAL.leafD);
        rect(g, 6, 4, 20, 18, PAL.leaf);
        rect(g, 8, 2, 16, 16, PAL.leafL);
        rect(g, 10, 4, 12, 12, PAL.leafD);
        // highlight
        for (let i=0; i<6; i++) px(g, 10+i, 4+(i%2), PAL.leafL);
        break;
      }
      case 'tree-pine': {
        rect(g, 14, 18, 4, 12, PAL.woodD);
        for (let r=0; r<3; r++) {
          const w = 24 - r*6;
          const y0 = 6 + r*6;
          for (let i=0; i<w/2; i++) rect(g, 16-w/2+i, y0, 1, 1, PAL.treeD);
          for (let i=0; i<w/2-2; i++) rect(g, 16-w/2+2+i, y0+1, 1, 5, PAL.leafD);
        }
        break;
      }
      case 'tree-fruit': {
        rect(g, 14, 20, 4, 10, PAL.wood);
        rect(g, 12, 28, 8, 4, PAL.woodD);
        rect(g, 4, 6, 24, 18, PAL.leafD);
        rect(g, 6, 4, 20, 18, PAL.leaf);
        rect(g, 8, 2, 16, 16, PAL.leafL);
        rect(g, 10, 4, 12, 12, PAL.leafD);
        dot(g, 10, 8, PAL.fR, 2);
        dot(g, 18, 6, PAL.fR, 2);
        dot(g, 22, 12, PAL.fR, 2);
        dot(g, 14, 14, PAL.fR, 2);
        dot(g, 8, 10, PAL.fR, 2);
        break;
      }
      case 'tree-bamboo': {
        rect(g, 14, 4, 4, 28, PAL.leafD);
        rect(g, 15, 4, 2, 28, PAL.leaf);
        for (let i=0; i<4; i++) {
          const y = 6 + i*6;
          rect(g, 12, y, 8, 1, PAL.treeD);
        }
        // top tuft
        rect(g, 10, 0, 12, 4, PAL.leafD);
        rect(g, 12, 0, 8, 4, PAL.leaf);
        break;
      }
      case 'palm': {
        rect(g, 15, 8, 2, 22, PAL.wood);
        rect(g, 14, 28, 4, 4, PAL.woodD);
        // coconuts
        dot(g, 13, 10, PAL.woodD, 1);
        dot(g, 18, 9, PAL.woodD, 1);
        // fronds
        rect(g, 4, 4, 24, 4, PAL.leafD);
        rect(g, 2, 6, 28, 4, PAL.leaf);
        rect(g, 6, 2, 20, 4, PAL.leafL);
        for (let i=0; i<5; i++) rect(g, 4+i*5, 8, 1, 4, PAL.leafD);
        break;
      }
      case 'bush': {
        rect(g, 4, 14, 24, 14, PAL.leafD);
        rect(g, 6, 10, 20, 14, PAL.leaf);
        rect(g, 8, 8, 16, 12, PAL.leafL);
        rect(g, 10, 6, 12, 10, PAL.leafD);
        for (let i=0; i<6; i++) px(g, 8+i*2, 12, PAL.leafL);
        break;
      }
      case 'flower-r': case 'flower-y': case 'flower-p':
      case 'flower-w': case 'flower-o': {
        const colors = {'flower-r':PAL.fR, 'flower-y':PAL.fY, 'flower-p':PAL.fP, 'flower-w':PAL.fW, 'flower-o':PAL.fO};
        rect(g, 0, 0, W, H, PAL.grass);
        for (let i=0; i<5; i++) {
          const x = 4 + i*5;
          rect(g, x, 16, 1, 12, PAL.grassD);
          dot(g, x, 14, colors[name], 2);
        }
        break;
      }
      // --- rocks ---
      case 'rock': {
        rect(g, 4, 14, 24, 14, PAL.stone);
        rect(g, 6, 10, 20, 6, PAL.stone);
        rect(g, 8, 6, 16, 4, PAL.stone);
        rect(g, 9, 17, 8, 4, PAL.stoneD);
        rect(g, 18, 14, 6, 3, PAL.stoneD);
        rect(g, 12, 8, 4, 2, PAL.stoneL);
        break;
      }
      case 'rock-gold': {
        rect(g, 4, 14, 24, 14, PAL.stone);
        rect(g, 6, 10, 20, 6, PAL.stone);
        rect(g, 8, 6, 16, 4, '#fde047');
        rect(g, 9, 17, 8, 4, PAL.stoneD);
        rect(g, 18, 14, 6, 3, PAL.stoneD);
        break;
      }
      // --- items (dropped) ---
      case 'item-branch': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 4, 14, 24, 4, PAL.wood);
        rect(g, 6, 16, 20, 1, PAL.woodL);
        break;
      }
      case 'item-stone': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 10, 18, 12, 8, PAL.stone);
        rect(g, 11, 20, 10, 4, PAL.stoneD);
        break;
      }
      case 'item-fruit': {
        rect(g, 0, 0, W, H, PAL.grass);
        dot(g, 16, 18, PAL.fR, 4);
        rect(g, 15, 14, 2, 2, PAL.woodD);
        break;
      }
      case 'item-bell': {
        rect(g, 0, 0, W, H, PAL.grass);
        dot(g, 16, 18, PAL.gold, 4);
        dot(g, 14, 16, '#fff7c0', 1);
        break;
      }
      case 'item-fossil': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 10, 16, 12, 8, PAL.stone);
        rect(g, 12, 14, 8, 4, PAL.stoneD);
        break;
      }
      case 'item-fish': {
        rect(g, 0, 0, W, H, PAL.grass);
        // fish on plate
        rect(g, 6, 14, 20, 8, '#7a7a82');
        rect(g, 4, 16, 4, 4, '#7a7a82');
        dot(g, 8, 16, PAL.ink, 1);
        break;
      }
      case 'item-bug': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 14, 12, 4, 8, '#1c1917');
        rect(g, 10, 10, 4, 6, PAL.purpleL);
        rect(g, 18, 10, 4, 6, PAL.purpleL);
        break;
      }
      case 'item-clay': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 10, 16, 12, 8, '#a37041');
        rect(g, 11, 17, 10, 4, '#8b5a2b');
        break;
      }
      case 'item-iron': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 10, 14, 12, 10, '#9aa0a6');
        rect(g, 11, 16, 10, 4, '#6b6f76');
        break;
      }
      // --- tilled / farm ---
      case 'tilled': {
        rect(g, 0, 0, W, H, '#5a3a1a');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#7a4a2a');
        break;
      }
      case 'tilled-water': {
        rect(g, 0, 0, W, H, '#3e2812');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#5a3a1a');
        // water puddles
        rect(g, 4, 4, 6, 2, '#4fa8d8');
        rect(g, 18, 18, 8, 2, '#4fa8d8');
        break;
      }
      case 'crop-0': {
        rect(g, 0, 0, W, H, '#3e2812');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#5a3a1a');
        // sprout
        rect(g, 14, 18, 2, 6, PAL.grassD);
        rect(g, 13, 16, 4, 2, PAL.leaf);
        break;
      }
      case 'crop-1': {
        rect(g, 0, 0, W, H, '#3e2812');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#5a3a1a');
        rect(g, 14, 12, 2, 12, PAL.grassD);
        rect(g, 12, 10, 6, 4, PAL.leaf);
        break;
      }
      case 'crop-2': {
        rect(g, 0, 0, W, H, '#3e2812');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#5a3a1a');
        rect(g, 14, 8, 2, 16, PAL.grassD);
        rect(g, 12, 6, 6, 4, PAL.leaf);
        rect(g, 10, 8, 4, 2, PAL.leaf);
        rect(g, 16, 8, 4, 2, PAL.leaf);
        break;
      }
      case 'crop-3': {
        // harvestable
        rect(g, 0, 0, W, H, '#3e2812');
        for (let i=0; i<4; i++) rect(g, 2, 3+i*8, W-4, 2, '#5a3a1a');
        rect(g, 14, 4, 2, 20, PAL.grassD);
        rect(g, 12, 4, 6, 4, PAL.leaf);
        dot(g, 16, 8, PAL.gold, 3);
        dot(g, 12, 12, PAL.gold, 3);
        break;
      }
      // === BUILDINGS (32x48 cell, 32x32 roof + 16x32 wall below) ===
      // All building sprites are drawn into a 32x48 cell. The TOP 32x32 area is
      // the roof (visible in axonometric view), the BOTTOM 16x32 is the wall face
      // (visible on the south side as the "side of the building"). This gives true
      // 3D extrusion look without 3D geometry.
      case 'house-mayor': {
        // Wall face (bottom 16 rows): 0-15 unused / 16-31 wall / 32-47 grass at base
        // y=0..15: top of building, no wall visible (covered by roof)
        // y=16..31: wall face visible
        // y=32..47: ground/grass strip at base
        rect(g, 0, 0, W, 16, '#0c0a09');  // transparent top
        rect(g, 4, 16, 24, 16, PAL.wall);  // wall
        rect(g, 4, 28, 24, 4, PAL.wallD);  // wall shadow strip
        rect(g, 14, 22, 4, 10, PAL.door);
        rect(g, 14, 22, 1, 10, '#3a2010');
        rect(g, 6, 19, 4, 4, PAL.windowLit);
        rect(g, 22, 19, 4, 4, PAL.windowLit);
        rect(g, 0, 32, W, 16, PAL.grass);  // grass base
        // Roof (y=0..15)
        rect(g, 2, 0, 28, 12, PAL.rM);
        rect(g, 2, 0, 28, 1, '#5a1fb5');
        rect(g, 4, -2, 24, 2, PAL.rM);
        rect(g, 22, -4, 3, 4, PAL.stone);
        rect(g, 16, -4, 1, 6, '#1c1917');
        rect(g, 17, -3, 3, 2, PAL.rM);
        break;
      }
      case 'house-modern': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wallP);
        rect(g, 4, 28, 24, 4, '#c8a8b8');
        rect(g, 14, 22, 4, 10, PAL.door);
        rect(g, 6, 19, 4, 4, PAL.window);
        rect(g, 22, 19, 4, 4, PAL.window);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 4, 28, 8, PAL.rB);
        rect(g, 4, 2, 24, 2, PAL.rB);
        break;
      }
      case 'house-shack': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 18, 24, 14, PAL.wood);
        rect(g, 4, 28, 24, 4, PAL.woodD);
        rect(g, 14, 22, 4, 10, PAL.door);
        rect(g, 6, 20, 3, 3, PAL.windowLit);
        rect(g, 23, 20, 3, 3, PAL.windowLit);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 8, 28, 8, PAL.rR);
        rect(g, 4, 6, 24, 2, PAL.rR);
        break;
      }
      case 'shop': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wall);
        rect(g, 4, 28, 24, 4, PAL.wallD);
        rect(g, 2, 18, 28, 3, PAL.rG);
        for (let i=0; i<28; i+=4) rect(g, i, 18, 2, 3, PAL.wall);
        rect(g, 14, 21, 4, 11, PAL.door);
        rect(g, 6, 21, 4, 4, PAL.window);
        rect(g, 22, 21, 4, 4, PAL.window);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, PAL.rG);
        rect(g, 4, 4, 24, 2, PAL.rG);
        rect(g, 12, 7, 8, 3, PAL.gold);
        rect(g, 13, 8, 6, 1, '#1c1917');
        break;
      }
      case 'bank': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 6, 14, 3, 18, PAL.wall);
        rect(g, 13, 14, 3, 18, PAL.wall);
        rect(g, 20, 14, 3, 18, PAL.wall);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 4, 28, 6, PAL.rB);
        rect(g, 0, 2, W, 2, PAL.rB);
        rect(g, 4, 28, 24, 4, PAL.stoneD);
        rect(g, 8, 6, 16, 4, PAL.gold);
        rect(g, 12, 7, 8, 2, '#1c1917');
        break;
      }
      case 'museum': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 14, 24, 18, PAL.wall);
        rect(g, 4, 28, 24, 4, PAL.stoneD);
        rect(g, 4, 14, 2, 18, PAL.wallD);
        rect(g, 26, 14, 2, 18, PAL.wallD);
        rect(g, 12, 16, 8, 16, PAL.door);
        rect(g, 14, 18, 4, 4, PAL.window);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 4, 28, 6, PAL.stone);
        rect(g, 4, 2, 24, 2, PAL.stoneD);
        rect(g, 14, 0, 4, 4, PAL.stoneL);
        dot(g, 15, 1, '#1c1917', 1);
        dot(g, 17, 1, '#1c1917', 1);
        break;
      }
      case 'pawn': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wood);
        rect(g, 4, 28, 24, 4, PAL.woodD);
        rect(g, 14, 22, 4, 10, PAL.door);
        rect(g, 6, 19, 3, 3, PAL.windowLit);
        rect(g, 23, 19, 3, 3, PAL.windowLit);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, PAL.rR);
        rect(g, 4, 4, 24, 2, PAL.rR);
        dot(g, 10, 5, PAL.gold, 2);
        dot(g, 16, 5, PAL.fR, 2);
        dot(g, 22, 5, PAL.gold, 2);
        break;
      }
      case 'tower': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 10, 4, 12, 28, PAL.stone);
        rect(g, 10, 4, 2, 28, PAL.stoneD);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 8, 0, 16, 4, PAL.rM);
        rect(g, 8, 0, 16, 1, PAL.m3L);
        rect(g, 14, 12, 4, 6, PAL.windowLit);
        break;
      }
      case 'nooks': {
        // Nook's Cranny — green awning + bell sign
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wood);
        rect(g, 4, 28, 24, 4, PAL.woodD);
        rect(g, 2, 18, 28, 3, PAL.rG);
        for (let i=0; i<28; i+=4) rect(g, i, 18, 2, 3, PAL.wood);
        rect(g, 14, 21, 4, 11, PAL.door);
        rect(g, 6, 21, 4, 4, PAL.windowLit);
        rect(g, 22, 21, 4, 4, PAL.windowLit);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, PAL.rG);
        rect(g, 4, 4, 24, 2, PAL.rG);
        // bell sign on top
        rect(g, 10, 0, 12, 4, PAL.wall);
        rect(g, 12, 1, 8, 3, PAL.gold);
        rect(g, 14, 2, 4, 2, PAL.ink);
        break;
      }
      case 'able': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wallP);
        rect(g, 4, 28, 24, 4, '#c8a8b8');
        rect(g, 2, 18, 28, 3, PAL.pink || '#f7a8c0');
        for (let i=0; i<28; i+=4) rect(g, i, 18, 2, 3, PAL.wallP);
        rect(g, 14, 21, 4, 11, PAL.door);
        rect(g, 6, 21, 4, 4, PAL.window);
        rect(g, 22, 21, 4, 4, PAL.window);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, '#ec4899');
        rect(g, 4, 4, 24, 2, '#ec4899');
        rect(g, 10, 0, 12, 4, PAL.wall);
        rect(g, 12, 1, 8, 3, '#ec4899');
        break;
      }
      case 'kks': {
        // K.K. Slider stage
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, '#3a1a4a');
        rect(g, 4, 28, 24, 4, '#2a0a3a');
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, PAL.m3);
        rect(g, 4, 4, 24, 2, PAL.m3);
        // music note
        rect(g, 14, 8, 4, 4, '#fff');
        rect(g, 14, 7, 1, 5, '#fff');
        break;
      }
      case 'resident': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.wood);
        rect(g, 4, 28, 24, 4, PAL.woodD);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 6, 28, 6, PAL.stone);
        rect(g, 4, 4, 24, 2, PAL.stoneD);
        break;
      }
      case 'tent': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 0, 16, W, 16, PAL.wall);
        for (let i=0; i<28; i++) rect(g, 2+i, 32-(i/2)|0, 1, 1, PAL.fW);
        rect(g, 14, 20, 4, 12, PAL.ink);
        rect(g, 16, 0, 1, 32, '#8b5a2b');
        rect(g, 0, 32, W, 16, PAL.grass);
        break;
      }
      case 'tent-green': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, PAL.m3);
        for (let i=0; i<22; i++) rect(g, 5+i, 32-(i/2)|0, 1, 1, PAL.m3L);
        rect(g, 14, 20, 4, 12, PAL.ink);
        rect(g, 16, 0, 1, 32, '#8b5a2b');
        rect(g, 14, 14, 4, 3, PAL.m3L);
        rect(g, 0, 32, W, 16, PAL.grass);
        break;
      }
      case 'tent-2': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 4, 16, 24, 16, '#5a4a3a');
        rect(g, 14, 20, 4, 12, PAL.door);
        rect(g, 0, 32, W, 16, PAL.grass);
        rect(g, 2, 8, 28, 8, '#7c5a3a');
        break;
      }
      case 'warehouse': {
        rect(g, 0, 0, W, 16, '#0c0a09');
        rect(g, 2, 16, 28, 16, PAL.stone);
        rect(g, 2, 28, 28, 4, PAL.stoneD);
        rect(g, 4, 20, 24, 12, PAL.ink);
        for (let i=0; i<3; i++) rect(g, 4, 21+i*3, 24, 1, '#3a3d44');
        rect(g, 2, 8, 28, 8, PAL.stoneD);
        rect(g, 0, 32, W, 16, PAL.grass);
        break;
      }
      case 'bridge-h': {
        rect(g, 0, 0, W, H, PAL.water);
        rect(g, 0, 12, W, 16, PAL.wood);
        rect(g, 0, 26, W, 2, PAL.woodD);
        for (let i=0; i<8; i++) rect(g, i*4, 12, 1, 16, PAL.woodD);
        break;
      }
      case 'bridge-v': {
        rect(g, 0, 0, W, H, PAL.water);
        rect(g, 8, 0, 16, H, PAL.wood);
        rect(g, 22, 0, 2, H, PAL.woodD);
        for (let i=0; i<8; i++) rect(g, 8, i*4, 16, 1, PAL.woodD);
        break;
      }
      case 'sign': {
        rect(g, 0, 0, W, H, PAL.grass);
        rect(g, 14, 8, 4, 22, PAL.wood);
        rect(g, 6, 4, 20, 12, PAL.wall);
        rect(g, 6, 4, 20, 1, PAL.wallD);
        rect(g, 8, 6, 16, 1, PAL.ink);
        rect(g, 8, 9, 16, 1, PAL.ink);
        rect(g, 8, 12, 16, 1, PAL.ink);
        break;
      }
      // --- empty / void ---
      case 'void': {
        rect(g, 0, 0, W, H, '#0a0d18');
        break;
      }
      // --- shop variants ---
      case 'nooks': {
        // Nook's Cranny — green awning + bell sign
        rect(g, 0, 24, W, 8, PAL.grass);
        rect(g, 4, 12, 24, 14, PAL.wood);
        rect(g, 4, 24, 24, 2, PAL.woodD);
        rect(g, 2, 14, 28, 3, PAL.rG);
        for (let i=0; i<28; i+=4) rect(g, i, 14, 2, 3, PAL.wood);
        rect(g, 14, 17, 4, 9, PAL.door);
        rect(g, 6, 17, 4, 4, PAL.windowLit);
        rect(g, 22, 17, 4, 4, PAL.windowLit);
        rect(g, 2, 6, 28, 6, PAL.rG);
        rect(g, 4, 4, 24, 2, PAL.rG);
        // bell sign
        rect(g, 10, 0, 12, 6, PAL.wall);
        rect(g, 12, 1, 8, 4, PAL.gold);
        rect(g, 14, 2, 4, 2, PAL.ink);
        break;
      }
      case 'able': {
        // Able Sisters — pink boutique
        rect(g, 0, 24, W, 8, PAL.grass);
        rect(g, 4, 12, 24, 14, PAL.wallP);
        rect(g, 4, 24, 24, 2, '#c8a8b8');
        rect(g, 2, 14, 28, 3, PAL.pink || '#f7a8c0');
        for (let i=0; i<28; i+=4) rect(g, i, 14, 2, 3, PAL.wallP);
        rect(g, 14, 17, 4, 9, PAL.door);
        rect(g, 6, 17, 4, 4, PAL.window);
        rect(g, 22, 17, 4, 4, PAL.window);
        rect(g, 2, 6, 28, 6, '#ec4899');
        rect(g, 4, 4, 24, 2, '#ec4899');
        rect(g, 10, 0, 12, 6, PAL.wall);
        rect(g, 12, 1, 8, 4, '#ec4899');
        break;
      }
      case 'kks': {
        // K.K. Slider concert stage
        rect(g, 0, 24, W, 8, PAL.grass);
        // stage platform
        rect(g, 2, 18, 28, 8, PAL.wood);
        rect(g, 2, 18, 28, 1, PAL.woodL);
        // backdrop
        rect(g, 4, 6, 24, 12, PAL.rM);
        rect(g, 4, 6, 24, 1, PAL.m3L);
        // K.K. logo (disc)
        rect(g, 14, 8, 4, 4, PAL.gold);
        rect(g, 15, 9, 2, 2, PAL.ink);
        // speakers
        rect(g, 6, 16, 4, 4, PAL.ink);
        rect(g, 22, 16, 4, 4, PAL.ink);
        break;
      }
      case 'airport': {
        // Dodo Airlines airport
        rect(g, 0, 24, W, 8, PAL.grass);
        rect(g, 2, 10, 28, 16, PAL.wall);
        rect(g, 2, 24, 28, 2, PAL.wallD);
        // hangar door
        rect(g, 8, 12, 16, 14, PAL.door);
        for (let i=0; i<3; i++) rect(g, 8, 14+i*4, 16, 1, '#3a2010');
        // roof
        rect(g, 2, 4, 28, 6, PAL.rB);
        rect(g, 0, 2, W, 2, PAL.rB);
        // sign
        rect(g, 8, 0, 16, 4, PAL.wall);
        rect(g, 10, 1, 12, 2, PAL.rB);
        rect(g, 14, 1, 4, 2, PAL.gold);
        break;
      }
      case 'resident': {
        // Resident Services / Town Hall
        rect(g, 0, 24, W, 8, PAL.grass);
        rect(g, 4, 12, 24, 14, PAL.wall);
        rect(g, 4, 24, 24, 2, PAL.wallD);
        rect(g, 14, 18, 4, 8, PAL.door);
        rect(g, 6, 15, 4, 4, PAL.windowLit);
        rect(g, 22, 15, 4, 4, PAL.windowLit);
        rect(g, 2, 4, 28, 8, PAL.rY);
        rect(g, 2, 4, 28, 1, '#b8860b');
        rect(g, 4, 2, 24, 2, PAL.rY);
        // bell on top
        rect(g, 15, 0, 2, 2, PAL.gold);
        break;
      }
      case 'camp': {
        // Campsite
        rect(g, 0, 24, W, 8, PAL.grass);
        rect(g, 0, 24, W, 4, PAL.wall);
        for (let i=0; i<28; i++) rect(g, 2+i, 24-(i/2)|0, 1, 1, '#fb923c');
        rect(g, 14, 20, 4, 8, PAL.ink);
        rect(g, 16, 0, 1, 22, '#8b5a2b');
        rect(g, 28, 8, 4, 16, '#8b5a2b');
        rect(g, 28, 8, 1, 16, PAL.woodD);
        rect(g, 28, 8, 4, 1, '#a37041');
        break;
      }
      // --- seasonal ---
      case 'snow': {
        rect(g, 0, 0, W, H, '#fefefe');
        for (let i=0; i<8; i++) px(g, Math.random()*W|0, Math.random()*H|0, '#cbd5e1');
        break;
      }
      case 'cherry': {
        rect(g, 0, 0, W, H, PAL.grass);
        // cherry blossom petals
        for (let i=0; i<6; i++) {
          const x = Math.random()*W|0, y = Math.random()*H|0;
          dot(g, x, y, PAL.fP, 1);
        }
        break;
      }
      case 'leaf-fall': {
        rect(g, 0, 0, W, H, PAL.grass);
        for (let i=0; i<8; i++) {
          const x = Math.random()*W|0, y = Math.random()*H|0;
          dot(g, x, y, Math.random() < 0.5 ? PAL.fR : PAL.fO, 1);
        }
        break;
      }
    }
  });
}

// =====================================================================
// 2.2  CHARACTER SPRITES  (64x64, full body with head)
// =====================================================================
// 4 directions × 2 frames (walk animation) per species
// =====================================================================

function buildChar(name) {
  const W = 64, H = 64;
  const cell = allocCell(name, W, H);
  if (!cell) return;
  drawOntoAtlas(cell, (g) => {
    const parts = name.split('-');
    const species = parts[0];
    const dir = parts[1] || 'down';
    const frame = parseInt(parts[2] || '0');
    // base palette per species
    const S = charPalette(species);
    drawChar(g, W, H, S, dir, frame);
  });
}

function charPalette(species) {
  const base = {
    cat:   {furA: PAL.catA,  furB: PAL.catB,  skin: PAL.skin,  earIn: PAL.pink, accent: PAL.green,    hat: null},
    bear:  {furA: PAL.bearA, furB: PAL.bearB, skin: PAL.skinD, earIn: PAL.bearA, accent: PAL.red,     hat: null},
    pig:   {furA: PAL.pigP,  furB: PAL.pigD,  skin: PAL.pigP,  earIn: PAL.pigD,  accent: PAL.blue,     hat: null},
    frog:  {furA: PAL.frogG, furB: PAL.frogD, skin: PAL.frogL, earIn: PAL.frogG, accent: PAL.yellow,  hat: null},
    dog:   {furA: PAL.dogA,  furB: PAL.dogB,  skin: PAL.skin,  earIn: PAL.dogA,  accent: PAL.blue,     hat: 'sheriff'},
    wolf:  {furA: PAL.wolfG, furB: PAL.wolfD, skin: PAL.skinD, earIn: PAL.wolfG, accent: PAL.purple,   hat: 'bandana'},
    elephant: {furA: PAL.elephant, furB: PAL.elephantD, skin: PAL.elephant, earIn: PAL.elephant, accent: PAL.gold, hat: 'top'},
    rabbit: {furA: PAL.rabbitW, furB: '#d4cfc0', skin: PAL.skin, earIn: PAL.pink, accent: PAL.pink, hat: null},
    lion:  {furA: PAL.lionO, furB: PAL.lionM, skin: PAL.skinD, earIn: PAL.lionO, accent: PAL.gold,   hat: 'mane'},
    raccoon: {furA: PAL.raccoon, furB: PAL.raccoonD, skin: PAL.skin, earIn: PAL.raccoon, accent: PAL.purple, hat: 'leaf'},
    penguin: {furA: PAL.penguin, furB: '#0c0a09', skin: PAL.skinD, earIn: PAL.penguin, accent: PAL.penguinO, hat: null},
    deer:  {furA: PAL.deerA, furB: PAL.deerB, skin: PAL.skinD, earIn: PAL.deerA, accent: PAL.green, hat: 'antlers'},
    mouse: {furA: PAL.mouseG, furB: '#78716c', skin: PAL.skin, earIn: PAL.pink, accent: PAL.pink, hat: null},
    hippo: {furA: PAL.hippoP, furB: PAL.hippoD, skin: PAL.hippoP, earIn: PAL.hippoD, accent: PAL.gold, hat: null},
    horse: {furA: PAL.horseB, furB: PAL.horseD, skin: PAL.horseM, earIn: PAL.horseB, accent: PAL.blue, hat: null},
    chicken: {furA: PAL.chicken, furB: PAL.chickenD, skin: PAL.chicken, earIn: PAL.chickenR, accent: PAL.red, hat: 'comb'},
    koala: {furA: PAL.koala, furB: PAL.koalaD, skin: PAL.skinD, earIn: PAL.koala, accent: PAL.green, hat: null},
    goat:  {furA: PAL.goat, furB: PAL.goatD, skin: PAL.skinD, earIn: PAL.goat, accent: PAL.green, hat: 'horns'},
    octopus: {furA: PAL.octopus, furB: PAL.octoD, skin: PAL.octopus, earIn: PAL.octopus, accent: PAL.purple, hat: null},
    eagle: {furA: PAL.eagle, furB: '#3a2010', skin: PAL.eagleW, earIn: PAL.eagle, accent: PAL.gold, hat: 'beak'},
    m3:    {furA: PAL.m3Fur, furB: PAL.m3FurD, skin: PAL.m3Skin, earIn: PAL.m3, accent: PAL.m3, hat: 'mask'},
  };
  return base[species] || base.cat;
}

// core char drawer. dir = 'down' | 'up' | 'left' | 'right'; frame = 0|1|2|3
// v5.1.2: improved proportions, 4-frame walk cycle, eyes with highlights,
//        hand details, arm swing on walk, body shading.
function drawChar(g, W, H, S, dir, frame) {
  // 64x64 frame, character occupies 24 wide x 56 tall (centered)
  // y=4..60 char; x=20..44 char
  // frame animation: 0-3 cycle (idle, step-L, idle, step-R)
  const legFrame = frame & 1;  // 0 or 1 — left leg forward
  const armFrame = frame & 1;  // 0 or 1 — right arm forward
  const isStepping = (frame === 1 || frame === 3);  // mid-step
  // body shadow (darker, larger)
  rect(g, 14, 60, 36, 4, 'rgba(0,0,0,0.28)');

  // legs (slightly thicker, with pant cuff)
  const legOffX = legFrame === 0 ? -1 : 1;
  // back leg
  rect(g, 24, 48, 7, 12, S.furB);
  rect(g, 24+legOffX, 48, 7, 12, S.furB);
  // front leg
  rect(g, 33, 48, 7, 12, S.furB);
  rect(g, 33-legOffX, 48, 7, 12, S.furB);
  // shoes (slightly larger)
  rect(g, 22, 58, 9, 3, PAL.ink);
  rect(g, 33, 58, 9, 3, PAL.ink);

  // body (slightly tapered)
  rect(g, 18, 36, 28, 16, S.furA);
  // body shading on the right side
  rect(g, 40, 36, 6, 16, S.furB);
  // collar / shirt detail
  rect(g, 26, 38, 12, 8, S.accent);
  rect(g, 26, 38, 12, 1, 'rgba(0,0,0,0.2)');
  // shirt buttons
  rect(g, 31, 39, 2, 2, 'rgba(255,255,255,0.3)');
  rect(g, 31, 43, 2, 2, 'rgba(255,255,255,0.3)');

  // arms (swing with walk)
  const armSwing = isStepping ? (armFrame === 0 ? -2 : 2) : 0;
  if (dir === 'left' || dir === 'right') {
    // profile: front arm + back arm
    // back arm
    rect(g, 14, 40 - armSwing, 5, 12, S.furB);
    rect(g, 14, 50 - armSwing, 5, 3, S.skin);  // hand
    // front arm
    rect(g, 45, 40 + armSwing, 5, 12, S.furA);
    rect(g, 45, 50 + armSwing, 5, 3, S.skin);  // hand
  } else {
    // back-facing
    rect(g, 16, 40 - armSwing, 4, 12, S.furB);
    rect(g, 16, 50 - armSwing, 4, 3, S.skin);
    // front arm
    rect(g, 44, 40 + armSwing, 4, 12, S.furA);
    rect(g, 44, 50 + armSwing, 4, 3, S.skin);
  }

  // head (bigger, more round — 28x24)
  rect(g, 18, 14, 28, 24, S.furA);
  // head highlight (top)
  rect(g, 19, 14, 26, 1, 'rgba(255,255,255,0.18)');
  // head right-side shading
  rect(g, 42, 14, 4, 24, S.furB);
  // chin
  rect(g, 24, 34, 16, 4, S.skin);
  // chin shadow
  rect(g, 18, 36, 28, 2, S.furB);
  // ears
  if (S.hat !== 'antlers' && S.hat !== 'horns') {
    rect(g, 16, 16, 4, 6, S.furA);
    rect(g, 44, 16, 4, 6, S.furA);
    rect(g, 17, 17, 2, 3, S.earIn);
    rect(g, 45, 17, 2, 3, S.earIn);
  }

  // species-specific head/face details
  if (S.hat === 'sheriff') {
    // dog sheriff: badge on chest
    rect(g, 30, 42, 4, 4, PAL.gold);
    rect(g, 31, 43, 2, 2, '#1c1917');
  }
  if (S.hat === 'bandana') {
    // wolf bandana
    rect(g, 22, 22, 20, 3, PAL.red);
  }
  if (S.hat === 'top') {
    // elephant top hat
    rect(g, 26, 4, 12, 10, '#1c1917');
    rect(g, 24, 12, 16, 3, '#1c1917');
    rect(g, 30, 6, 4, 6, PAL.red);
  }
  if (S.hat === 'antlers') {
    // deer antlers
    rect(g, 16, 8, 4, 8, PAL.wood);
    rect(g, 44, 8, 4, 8, PAL.wood);
    rect(g, 12, 6, 4, 4, PAL.wood);
    rect(g, 48, 6, 4, 4, PAL.wood);
  }
  if (S.hat === 'mane') {
    // lion mane (round)
    rect(g, 16, 12, 32, 26, S.furB);
    rect(g, 18, 14, 28, 22, S.furA);
  }
  if (S.hat === 'comb') {
    // chicken comb
    rect(g, 28, 8, 8, 4, PAL.chickenR);
    rect(g, 30, 6, 2, 2, PAL.chickenR);
    rect(g, 34, 6, 2, 2, PAL.chickenR);
  }
  if (S.hat === 'horns') {
    // goat horns
    rect(g, 22, 10, 4, 4, '#1c1917');
    rect(g, 38, 10, 4, 4, '#1c1917');
  }
  if (S.hat === 'beak') {
    // eagle beak
    rect(g, 30, 22, 4, 4, PAL.gold);
  }
  if (S.hat === 'mask') {
    // player M3 mask (full face mask with M3 logo)
    rect(g, 22, 22, 20, 6, '#1c1917');
    rect(g, 24, 20, 4, 2, '#1c1917');
    rect(g, 36, 20, 4, 2, '#1c1917');
    // M3 logo on mask
    rect(g, 30, 24, 4, 2, PAL.m3);
  }
  if (S.hat === 'leaf') {
    // raccoon leaf
    rect(g, 30, 6, 4, 4, PAL.leafL);
  }

  // face features (eyes, nose, mouth) by direction
  if (dir === 'down' || dir === 'right' || dir === 'left') {
    if (dir === 'down') {
      // bigger eyes (5x5)
      rect(g, 25, 21, 5, 5, PAL.white);
      rect(g, 34, 21, 5, 5, PAL.white);
      // iris
      rect(g, 26, 22, 3, 3, S.accent);
      rect(g, 35, 22, 3, 3, S.accent);
      // pupil
      rect(g, 27, 23, 1, 1, PAL.ink);
      rect(g, 36, 23, 1, 1, PAL.ink);
      // eye highlight
      rect(g, 26, 22, 1, 1, PAL.white);
      rect(g, 35, 22, 1, 1, PAL.white);
      // nose
      rect(g, 30, 28, 4, 2, S.furB);
      // mouth (small smile)
      rect(g, 29, 31, 6, 1, S.furB);
    } else if (dir === 'left') {
      // profile: one eye visible
      rect(g, 22, 21, 6, 5, PAL.white);
      rect(g, 24, 22, 3, 3, S.accent);
      rect(g, 25, 23, 1, 1, PAL.ink);
      rect(g, 24, 22, 1, 1, PAL.white);
      // nose profile
      rect(g, 18, 26, 3, 2, S.furB);
      // mouth profile
      rect(g, 22, 30, 4, 1, S.furB);
    } else {  // right
      rect(g, 36, 21, 6, 5, PAL.white);
      rect(g, 38, 22, 3, 3, S.accent);
      rect(g, 40, 23, 1, 1, PAL.ink);
      rect(g, 38, 22, 1, 1, PAL.white);
      // nose profile
      rect(g, 43, 26, 3, 2, S.furB);
      // mouth profile
      rect(g, 38, 30, 4, 1, S.furB);
    }
  } else {
    // up: back of head
    rect(g, 28, 22, 8, 4, S.furB);
    // back ear details
    rect(g, 20, 16, 2, 4, S.furB);
    rect(g, 42, 16, 2, 4, S.furB);
  }
}

// =====================================================================
// 2.3  ITEM / UI ICONS (16x16)
// =====================================================================

function buildIcon(name) {
  const W = 16, H = 16;
  const cell = allocCell(name, W, H);
  if (!cell) return;
  drawOntoAtlas(cell, (g) => {
    switch (name) {
      case 'icon-bells': {
        rect(g, 0, 0, W, H, '#1c1917');
        dot(g, 8, 8, PAL.gold, 5);
        dot(g, 6, 6, '#fff7c0', 1);
        break;
      }
      case 'icon-miles': {
        rect(g, 0, 0, W, H, '#1c1917');
        // ticket
        rect(g, 3, 4, 10, 8, '#fef3c7');
        rect(g, 3, 6, 10, 1, PAL.red);
        rect(g, 3, 9, 10, 1, '#a8a29e');
        break;
      }
      case 'icon-star': {
        rect(g, 0, 0, W, H, '#1c1917');
        // simple 5-point star
        rect(g, 7, 3, 2, 2, PAL.gold);
        rect(g, 5, 5, 6, 2, PAL.gold);
        rect(g, 3, 7, 10, 2, PAL.gold);
        rect(g, 5, 9, 6, 2, PAL.gold);
        rect(g, 4, 11, 2, 2, PAL.gold);
        rect(g, 10, 11, 2, 2, PAL.gold);
        break;
      }
      case 'icon-shovel': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 4, 4, 8, 4, '#a8a29e');
        rect(g, 7, 8, 2, 6, '#8b5a2b');
        break;
      }
      case 'icon-axe': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 3, 4, 6, 6, '#a8a29e');
        rect(g, 4, 5, 4, 4, '#6b7280');
        rect(g, 8, 8, 2, 6, '#8b5a2b');
        break;
      }
      case 'icon-rod': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 3, 12, 1, 2, '#1c1917');
        rect(g, 4, 4, 1, 8, '#8b5a2b');
        rect(g, 5, 5, 1, 6, '#8b5a2b');
        rect(g, 6, 6, 1, 4, '#8b5a2b');
        break;
      }
      case 'icon-net': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 8, 2, 1, 10, '#8b5a2b');
        rect(g, 4, 2, 8, 6, '#a8a29e');
        rect(g, 6, 4, 4, 2, '#a8a29e');
        break;
      }
      case 'icon-watering': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 4, 4, 8, 6, '#4fa8d8');
        rect(g, 4, 4, 1, 6, '#3a82b3');
        rect(g, 7, 2, 2, 2, '#a8a29e');
        rect(g, 6, 10, 4, 2, '#3a82b3');
        break;
      }
      case 'icon-bell-bag': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 3, 3, 10, 10, '#7c3aed');
        rect(g, 3, 3, 1, 10, '#5b21b6');
        dot(g, 8, 8, PAL.gold, 2);
        break;
      }
      case 'icon-fruit': {
        rect(g, 0, 0, W, H, '#1c1917');
        dot(g, 8, 9, PAL.fR, 4);
        rect(g, 7, 5, 2, 2, '#5a3a1a');
        break;
      }
      case 'icon-fish': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 3, 7, 9, 4, '#7a7a82');
        rect(g, 2, 7, 2, 4, '#7a7a82');
        rect(g, 12, 8, 2, 2, '#7a7a82');
        dot(g, 5, 8, PAL.ink, 1);
        break;
      }
      case 'icon-bug': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 7, 4, 2, 8, '#1c1917');
        rect(g, 4, 5, 3, 4, PAL.purpleL);
        rect(g, 9, 5, 3, 4, PAL.purpleL);
        break;
      }
      case 'icon-fossil': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 4, 6, 8, 6, PAL.stone);
        rect(g, 5, 8, 6, 2, PAL.stoneD);
        break;
      }
      case 'icon-villager': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 4, 3, 8, 8, '#d4a574');
        rect(g, 5, 5, 2, 2, '#1c1917');
        rect(g, 9, 5, 2, 2, '#1c1917');
        rect(g, 3, 11, 10, 4, '#a8a29e');
        break;
      }
      case 'icon-house': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 2, 8, 12, 6, '#fbbf24');
        rect(g, 2, 4, 12, 5, '#dc2626');
        rect(g, 6, 10, 4, 4, '#5a3a1a');
        break;
      }
      case 'icon-museum': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 2, 6, 12, 8, '#f6dca0');
        rect(g, 2, 4, 12, 2, '#5a3a1a');
        rect(g, 3, 7, 2, 6, '#d8b76a');
        rect(g, 11, 7, 2, 6, '#d8b76a');
        rect(g, 6, 8, 4, 4, '#5a3a1a');
        break;
      }
      case 'icon-crown': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 3, 6, 10, 5, PAL.gold);
        rect(g, 3, 4, 2, 2, PAL.gold);
        rect(g, 7, 3, 2, 3, PAL.gold);
        rect(g, 11, 4, 2, 2, PAL.gold);
        rect(g, 3, 11, 10, 1, PAL.goldD);
        rect(g, 5, 7, 2, 3, '#dc2626');
        rect(g, 9, 7, 2, 3, '#2563eb');
        break;
      }
      case 'icon-shell': {
        rect(g, 0, 0, W, H, '#1c1917');
        // spiral shell
        for (let i=0; i<5; i++) {
          const r = 5 - i;
          for (let a=0; a<8; a++) {
            const x = (8 + Math.cos(a * Math.PI/4) * r) | 0;
            const y = (8 + Math.sin(a * Math.PI/4) * r) | 0;
            if (x>=0 && x<16 && y>=0 && y<16) px(g, x, y, PAL.pink);
          }
        }
        rect(g, 3, 8, 10, 4, '#f7a8c0');
        break;
      }
      case 'icon-tree': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 7, 8, 2, 6, PAL.wood);
        rect(g, 4, 2, 8, 8, PAL.leaf);
        rect(g, 5, 1, 6, 8, PAL.leafL);
        break;
      }
      case 'icon-flower': {
        rect(g, 0, 0, W, H, '#1c1917');
        rect(g, 7, 8, 2, 6, PAL.grassD);
        dot(g, 8, 6, PAL.fP, 3);
        break;
      }
    }
  });
}

// =====================================================================
// 2.4  SHADOW SPRITE  (32x16 elliptical)
// =====================================================================
function buildShadow() {
  const cell = allocCell('shadow', 32, 16);
  if (!cell) return;
  drawOntoAtlas(cell, (g) => {
    for (let x = 0; x < 32; x++) {
      const r = Math.max(0, 6 - Math.abs(x-16)*0.4);
      for (let y = 0; y < r; y++) {
        const alpha = 0.32 * (1 - y / r);
        const cc = Math.floor(255 * (1 - alpha));
        px(g, x, 14 - y|0, `rgba(0,0,0,${alpha.toFixed(2)})`);
      }
    }
  });
}

// =====================================================================
// 2.5  PARTICLE TEXTURES (small)
// =====================================================================
function buildParticle(name) {
  const W = 16, H = 16;
  const cell = allocCell(name, W, H);
  if (!cell) return;
  drawOntoAtlas(cell, (g) => {
    switch (name) {
      case 'part-leaf': {
        for (let r=0; r<4; r++) for (let a=0; a<8; a++) {
          const x = (8 + Math.cos(a * Math.PI/4) * r) | 0;
          const y = (8 + Math.sin(a * Math.PI/4) * r) | 0;
          px(g, x, y, PAL.leafL);
        }
        break;
      }
      case 'part-cherry': {
        dot(g, 8, 8, PAL.fP, 2);
        break;
      }
      case 'part-firefly': {
        dot(g, 8, 8, '#fef3c7', 3);
        dot(g, 8, 8, '#fde047', 1);
        break;
      }
      case 'part-rain': {
        rect(g, 7, 4, 1, 8, '#a8d8ea');
        rect(g, 8, 6, 1, 6, '#7fcce4');
        break;
      }
      case 'part-snow': {
        dot(g, 8, 8, '#fefefe', 2);
        break;
      }
      case 'part-dust': {
        dot(g, 8, 8, '#fde047', 1);
        break;
      }
      case 'part-sparkle': {
        // 4-pointed star
        rect(g, 7, 4, 2, 8, '#fef3c7');
        rect(g, 4, 7, 8, 2, '#fef3c7');
        rect(g, 5, 5, 1, 1, '#fff');
        rect(g, 10, 5, 1, 1, '#fff');
        rect(g, 5, 10, 1, 1, '#fff');
        rect(g, 10, 10, 1, 1, '#fff');
        break;
      }
      case 'part-bubble': {
        for (let r=3; r<5; r++) for (let a=0; a<16; a++) {
          const x = (8 + Math.cos(a * Math.PI/8) * r) | 0;
          const y = (8 + Math.sin(a * Math.PI/8) * r) | 0;
          px(g, x, y, '#7fcce4');
        }
        dot(g, 6, 6, '#fefefe', 1);
        break;
      }
    }
  });
}

// =====================================================================
// 2.6  BUILD ALL SPRITES
// =====================================================================

function buildAllSprites() {
  // tiles
  ['grass', 'grass-dark', 'tall-grass',
   'path-h', 'path-v', 'path-cross', 'path-brick', 'path-stone', 'path-wood', 'path-grass',
   'asphalt', 'asphalt-cross',
   'sand',
   'water-0', 'water-1', 'water-2',
   'cliff', 'cliff-top', 'cliff-ramp-n', 'cliff-ramp-e',
   'tree', 'tree-pine', 'tree-fruit', 'tree-bamboo', 'palm',
   'bush',
   'flower-r', 'flower-y', 'flower-p', 'flower-w', 'flower-o',
   'rock', 'rock-gold',
   'item-branch', 'item-stone', 'item-fruit', 'item-bell', 'item-fossil', 'item-fish', 'item-bug', 'item-clay', 'item-iron',
   'tilled', 'tilled-water', 'crop-0', 'crop-1', 'crop-2', 'crop-3',
   'house-mayor', 'house-modern', 'house-shack',
   'shop', 'bank', 'museum', 'pawn', 'tent', 'warehouse', 'tent-green', 'tower',
   'bridge-h', 'bridge-v', 'sign',
   'nooks', 'able', 'kks', 'airport', 'resident', 'camp',
   'snow', 'cherry', 'leaf-fall',
   'void',
  ].forEach(buildTile);

  // characters
  const species = ['m3', 'cat', 'bear', 'pig', 'frog', 'dog', 'wolf', 'elephant',
                   'rabbit', 'lion', 'raccoon', 'penguin', 'deer', 'mouse', 'hippo',
                   'horse', 'chicken', 'koala', 'goat', 'octopus', 'eagle'];
  const dirs = ['down', 'up', 'left', 'right'];
  species.forEach(sp => dirs.forEach(d => {
    // 4-frame walk cycle (0=idle, 1=step-L, 2=idle, 3=step-R)
    for (let f = 0; f < 4; f++) {
      buildChar(`${sp}-${d}-${f}`);
    }
  }));

  // icons
  ['icon-bells', 'icon-miles', 'icon-star', 'icon-shovel', 'icon-axe', 'icon-rod',
   'icon-net', 'icon-watering', 'icon-bell-bag', 'icon-fruit', 'icon-fish', 'icon-bug',
   'icon-fossil', 'icon-villager', 'icon-house', 'icon-museum', 'icon-crown', 'icon-shell',
   'icon-tree', 'icon-flower',
  ].forEach(buildIcon);

  // shadow + particles
  buildShadow();
  ['part-leaf', 'part-cherry', 'part-firefly', 'part-rain', 'part-snow', 'part-dust', 'part-sparkle', 'part-bubble'].forEach(buildParticle);
}

// =====================================================================
// 2.7  RENDER HELPERS
// =====================================================================

// All rendering functions build a flat list of quads with a depth key,
// then we sort by depth (back-to-front) and emit to GPU in order.

const drawList = []; // {depth, fn}

function addDraw(depth, fn) { drawList.push({depth, fn}); }
function clearDrawList() { drawList.length = 0; }

// Compute UV from cell name
function uvOf(cell) {
  return {
    u0: cell.x / ATLAS_W, v0: cell.y / ATLAS_H,
    u1: (cell.x + cell.w) / ATLAS_W, v1: (cell.y + cell.h) / ATLAS_H,
  };
}

// Draw a single quad (sprite cell at screen pos with size)
function drawSprite(cell, sx, sy, sw, sh, layer, lit=1.0, alpha=1.0, tintR=1, tintG=1, tintB=1, glow=0) {
  if (!cell) return;
  const uv = uvOf(cell);
  // convert screen coords to NDC
  const x0 = (sx / VW) * 2 - 1;
  const y0 = 1 - (sy / VH) * 2;
  const x1 = ((sx + sw) / VW) * 2 - 1;
  const y1 = 1 - ((sy + sh) / VH) * 2;
  pushQuad(x0, y0, x1, y1, uv.u0, uv.v0, uv.u1, uv.v1, layer, lit, alpha, tintR, tintG, tintB, glow);
}

// Map screen world (wx, wy) → screen (sx, sy) using camera + projection
function worldToScreen(wx, wy, wz=0) {
  return project(wx, wy, wz);
}

// Draw a tile at world coords (wx, wy). sz is screen size (default TILE).
// layer: 0=ground, 1=grass-overlay (tall grass, flowers), 2=water, 3=prop
function drawTileAt(cell, wx, wy, sz=TILE, layer=0, lit=1.0, glow=0, elevOffset=0) {
  // elevOffset is in screen pixels (negative = up on screen)
  const p = project(wx, wy, 0);
  const sx = p.sx - sz/2 * p.scale;
  const sy = p.sy - sz/2 * p.scale - elevOffset * p.scale;
  drawSprite(cell, sx, sy, sz * p.scale, sz * p.scale, layer, lit, 1, 1, 1, 1, glow);
}

// =====================================================================
// 2.8  PARTICLE SYSTEM
// =====================================================================

const particles = [];
function spawnParticle(type, wx, wy, opts={}) {
  particles.push({
    type,
    x: wx * TILE + TILE/2 + (opts.dx || 0),
    y: wy * TILE + TILE/2 + (opts.dy || 0),
    wx, wy,
    vx: opts.vx || 0, vy: opts.vy || 0,
    life: opts.life || 60,
    maxLife: opts.life || 60,
    size: opts.size || 1,
    color: opts.color,
  });
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.02; // gravity (light)
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles(time) {
  // particles are drawn in screen space at their world position
  for (const p of particles) {
    const cell = cells['part-' + p.type];
    if (!cell) continue;
    const alpha = Math.min(1, p.life / 20);
    const pj = project(p.wx + (p.x - p.wx*TILE - TILE/2) / TILE, p.wy + (p.y - p.wy*TILE - TILE/2) / TILE, 0);
    const sx = pj.sx - 8 * pj.scale * p.size;
    const sy = pj.sy - 8 * pj.scale * p.size;
    drawSprite(cell, sx, sy, 16 * pj.scale * p.size, 16 * pj.scale * p.size, 4, 1, alpha);
  }
}

// =====================================================================
// 2.9  TIME OF DAY  (sun angle, sky color, fog)
// =====================================================================

function timeOfDay(t) {
  // t in [0, 1440) minutes
  // 0-300: dawn, 300-1080: day, 1080-1260: dusk, 1260-1440: night
  if (t < 300) return 'dawn';
  if (t < 1080) return 'day';
  if (t < 1260) return 'dusk';
  return 'night';
}

function dayColor(t) {
  // returns {sunCol, ambCol, fogCol, sunLevel, skyHex, sunDir: {x, y}}
  // sunDir is the offset in screen pixels for shadows (sun-from direction is -sunDir).
  // At dawn (6am) sun is east → shadow falls west (sx negative).
  // At noon sun is overhead → shadow short.
  // At dusk (6pm) sun is west → shadow falls east (sx positive).
  const tod = timeOfDay(t);
  let sunCol, ambCol, fogCol, sunLevel, skyHex, sunDir;
  // compute sun direction from time of day (in minutes since midnight)
  // sun rises at 6h (360min), peaks at 12h (720min), sets at 18h (1080min)
  const hour = (t / 60) % 24;
  // sun's azimuth angle: 0=overhead, PI/2=east, -PI/2=west, PI=underground
  const sunAng = (hour - 12) / 12 * Math.PI / 2;  // -PI/2 at 6am, 0 at noon, +PI/2 at 6pm
  // sun height: 0 at 6am/18pm, 1 at noon
  const sunHeight = Math.max(0, Math.cos(sunAng));
  // sun direction (shadow offset, opposite to sun-to-ground)
  // when sun is east (6am): shadow goes west → sunDir = (-1, +0.5)
  // when sun is west (6pm): shadow goes east → sunDir = (+1, +0.5)
  // shadow length inversely related to sunHeight
  const shadowLen = 0.5 + 1.5 * (1 - sunHeight);  // 0.5 at noon, 2.0 at horizon
  const sunDirX = Math.sin(sunAng) * shadowLen * 6;  // east-west
  const sunDirY = shadowLen * 4;  // always a bit south (downward in screen)
  sunDir = { x: sunDirX, y: sunDirY };
  if (tod === 'dawn') {
    const f = (t - 240) / 60; // 0..1 across dawn (240 to 300 → wait we use 0-300)
    sunCol = lerp3([0.95, 0.6, 0.5], [1.0, 0.95, 0.8], clamp(f, 0, 1));
    ambCol = [0.5, 0.5, 0.6];
    fogCol = [0.95, 0.7, 0.55];
    sunLevel = 0.4 + 0.4 * clamp(f, 0, 1);
    skyHex = PAL.skyDawn;
  } else if (tod === 'day') {
    sunCol = [1.0, 0.95, 0.8];
    ambCol = [0.55, 0.6, 0.7];
    fogCol = [0.7, 0.85, 0.95];
    sunLevel = 0.85;
    skyHex = PAL.skyDay;
  } else if (tod === 'dusk') {
    const f = (t - 1080) / 180; // 0..1
    sunCol = lerp3([1.0, 0.85, 0.6], [0.9, 0.5, 0.4], clamp(f, 0, 1));
    ambCol = [0.5, 0.45, 0.55];
    fogCol = lerp3([0.85, 0.7, 0.7], [0.5, 0.4, 0.6], clamp(f, 0, 1));
    sunLevel = 0.8 - 0.4 * clamp(f, 0, 1);
    skyHex = PAL.skyDusk;
  } else { // night
    sunCol = [0.4, 0.45, 0.6];
    ambCol = [0.3, 0.32, 0.4];
    fogCol = [0.1, 0.12, 0.2];
    sunLevel = 0.25;
    skyHex = PAL.skyNight;
  }
  return {sunCol, ambCol, fogCol, sunLevel, skyHex, sunDir};
}

function lerp3(a, b, f) { return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, f) { return a + (b - a) * f; }

// =====================================================================
// SECTION 3 · WORLD + GAMEPLAY
// =====================================================================

// World is 64x64 tile grid. Each cell is one of:
// 'water' | 'sand' | 'grass' | 'tall-grass' | 'path-h' | 'path-v' | 'path-cross'
// | 'cliff' | 'asphalt' | 'asphalt-cross'
// Plus: building IDs (string) for special tiles (shop, house, etc.)
// Plus: char IDs in 'chars' array overlay
// Plus: items in 'items' array overlay
// Plus: crops in 'crops' array overlay (farming)

// World is an array of layers:
//   world.terrain[ty][tx] = base tile name
//   world.buildings[ty][tx] = building ID or null
//   world.items[ty][tx] = item or null
//   world.crops[ty][tx] = {stage, type} or null
//   world.scenery[ty][tx] = scenery name (tree, rock, etc.) or null
//   world.elevation[ty][tx] = 0..3 (0=ground, 1=raised 1 level, etc.)
//   world.path[ty][tx] = path style (0=none, 1=grass-path, 2=sand-path, 3=brick, 4=stone, 5=wood)
//   world.ramp[ty][tx] = ramp direction (0=none, 1=N, 2=E, 3=S, 4=W) — for connecting elevations

const WORLD_W = 64;
const WORLD_H = 64;

const world = {
  terrain: [],
  buildings: [],
  items: [],
  crops: [],
  scenery: [],
  decorations: [],
  elevation: [],
  path: [],
  ramp: [],
};

function initWorld() {
  const layers = ['terrain','buildings','items','crops','scenery','decorations','elevation','path','ramp'];
  for (const layer of layers) {
    world[layer] = [];
    for (let y=0; y<WORLD_H; y++) {
      const row = new Array(WORLD_W);
      if (layer === 'terrain') row.fill('water');
      else if (layer === 'elevation' || layer === 'path' || layer === 'ramp') row.fill(0);
      else row.fill(null);
      world[layer].push(row);
    }
  }
}
initWorld();

function inBounds(x, y) { return x>=0 && x<WORLD_W && y>=0 && y<WORLD_H; }

// Stamp a blob shape into terrain
function stampBlob(cx, cy, radius, tile, jitter=0.2) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.sqrt(x*x + y*y);
      const r2 = radius * (0.7 + Math.random() * jitter);
      if (d <= r2) {
        const tx = cx + x, ty = cy + y;
        if (inBounds(tx, ty)) world.terrain[ty][tx] = tile;
      }
    }
  }
}

// Hand-stamp the main island: organic shape with beach, grass, cliff, river
function generateIsland() {
  // Big grass island centered at (32, 32) with radius ~18
  stampBlob(32, 32, 20, 'grass', 0.3);
  stampBlob(32, 32, 22, 'grass', 0.4);

  // Beach: convert grass → sand at edges of the blob
  for (let y=0; y<WORLD_H; y++) {
    for (let x=0; x<WORLD_W; x++) {
      if (world.terrain[y][x] === 'grass') {
        // if any neighbor is water, become sand
        const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
        let nearWater = false;
        for (const [nx, ny] of neighbors) {
          if (inBounds(nx, ny) && world.terrain[ny][nx] === 'water') { nearWater = true; break; }
        }
        if (nearWater) world.terrain[y][x] = 'sand';
      }
    }
  }

  // River through the middle
  for (let x=10; x<54; x++) {
    const ry = 32 + Math.round(Math.sin(x*0.4) * 2);
    for (let dy=-1; dy<=1; dy++) {
      if (inBounds(x, ry+dy) && world.terrain[ry+dy][x] !== 'water') {
        world.terrain[ry+dy][x] = 'water';
      }
    }
  }
  // bridge across the river
  world.terrain[32][30] = 'bridge-h';
  world.terrain[32][31] = 'bridge-h';
  world.terrain[32][32] = 'bridge-h';
  world.terrain[32][33] = 'bridge-h';
  world.terrain[32][34] = 'bridge-h';

  // Cliff in the NE quadrant (a small plateau)
  for (let y=10; y<20; y++) {
    for (let x=42; x<54; x++) {
      if (inBounds(x, y) && world.terrain[y][x] === 'grass') {
        world.terrain[y][x] = 'cliff-top';
      }
    }
  }
  for (let y=20; y<22; y++) {
    for (let x=42; x<54; x++) {
      if (inBounds(x, y) && world.terrain[y][x] === 'grass') {
        world.terrain[y][x] = 'cliff';
      }
    }
  }

  // Paths: a cross through the plaza at (32, 32)
  for (let x=20; x<44; x++) {
    if (world.terrain[32][x] === 'grass') world.terrain[32][x] = 'path-h';
  }
  for (let y=20; y<44; y++) {
    if (world.terrain[y][32] === 'grass') world.terrain[y][32] = 'path-v';
  }

  // Town square around (32, 32) — asphalt cross + 4 plaza corners
  world.terrain[31][31] = 'asphalt-cross';
  world.terrain[32][32] = 'asphalt-cross';

  // Scenery: trees, rocks, bushes, flowers
  for (let i=0; i<200; i++) {
    const x = (Math.random() * WORLD_W) | 0;
    const y = (Math.random() * WORLD_H) | 0;
    if (world.terrain[y][x] === 'grass' && !world.scenery[y][x] && !world.buildings[y][x]) {
      const r = Math.random();
      if (r < 0.5) world.scenery[y][x] = Math.random() < 0.7 ? 'tree' : (Math.random() < 0.5 ? 'tree-pine' : 'tree-fruit');
      else if (r < 0.7) world.scenery[y][x] = Math.random() < 0.5 ? 'rock' : 'rock-gold';
      else if (r < 0.85) world.scenery[y][x] = 'bush';
      else world.scenery[y][x] = 'palm';
    }
  }

  // Flowers
  for (let i=0; i<60; i++) {
    const x = (Math.random() * WORLD_W) | 0;
    const y = (Math.random() * WORLD_H) | 0;
    if (world.terrain[y][x] === 'grass' && !world.scenery[y][x] && !world.decorations[y][x]) {
      const f = ['flower-r', 'flower-y', 'flower-p', 'flower-w', 'flower-o'][(Math.random()*5)|0];
      world.decorations[y][x] = f;
    }
  }

  // Tall grass patches (3-4 clusters)
  for (let c=0; c<4; c++) {
    const cx = (Math.random() * WORLD_W) | 0;
    const cy = (Math.random() * WORLD_H) | 0;
    for (let i=0; i<8; i++) {
      const x = cx + ((Math.random()*6)|0) - 3;
      const y = cy + ((Math.random()*6)|0) - 3;
      if (inBounds(x, y) && world.terrain[y][x] === 'grass' && !world.scenery[y][x] && !world.decorations[y][x]) {
        world.decorations[y][x] = 'tall-grass';
      }
    }
  }
}

// place a 1-tile building
function placeBuilding(x, y, id) {
  if (!inBounds(x, y)) return false;
  if (world.buildings[y][x]) return false;
  if (world.scenery[y][x]) return false;
  world.buildings[y][x] = id;
  // 4-tile footprint variants: a few buildings take 2x2
  return true;
}

// Place Nook's Cranny (2x2)
function placeLargeBuilding(x, y, id) {
  if (!inBounds(x, y) || !inBounds(x+1, y+1)) return false;
  if (world.buildings[y][x] || world.buildings[y][x+1] || world.buildings[y+1][x] || world.buildings[y+1][x+1]) return false;
  if (world.scenery[y][x] || world.scenery[y][x+1] || world.scenery[y+1][x] || world.scenery[y+1][x+1]) return false;
  world.buildings[y][x] = id;
  world.buildings[y][x+1] = id;
  world.buildings[y+1][x] = id;
  world.buildings[y+1][x+1] = id;
  return true;
}

function placeShopPlaza() {
  // Nook's Cranny at (28, 26) - 2x2
  placeLargeBuilding(28, 26, 'nooks');
  // Able Sisters at (28, 30) - 2x2
  placeLargeBuilding(28, 30, 'able');
  // Museum at (35, 25) - 2x2
  placeLargeBuilding(35, 25, 'museum');
  // Resident Services at (32, 22) - 2x2
  placeLargeBuilding(32, 22, 'resident');
  // Airport at (15, 28) - 2x2
  placeLargeBuilding(15, 28, 'airport');
  // Campsite at (45, 32) - 2x2
  placeLargeBuilding(45, 32, 'camp');
  // K.K. stage at (40, 38) - 1 tile
  placeBuilding(40, 38, 'kks');
  // Town hall (shop) at (32, 26) - 1 tile
  placeBuilding(33, 26, 'shop');
  // Bank at (33, 28) - 1 tile
  placeBuilding(33, 28, 'bank');
  // Pawn at (35, 33) - 1 tile
  placeBuilding(35, 33, 'pawn');
  // Tower at (45, 12) - 1 tile
  placeBuilding(45, 12, 'tower');
  // Sign at (31, 26) - 1 tile
  placeBuilding(31, 26, 'sign');
}

// =====================================================================
// 3.1  PLAYER + VILLAGERS
// =====================================================================

const player = {
  wx: 32, wy: 32,        // world tile position (continuous)
  vx: 0, vy: 0,
  dir: 'down',
  frame: 0,
  frameT: 0,
  running: false,
  tool: 0,               // current tool index
  // stats
  bells: 500,
  bank: 0,
  miles: 0,
  rep: 0,                // friendship with villagers (avg)
  islandName: 'M3 Island',
  islandStars: 1,
  // inventory
  hotbar: [],            // 8 slots, each {itemId, count, type}
  bag: {},               // full inventory {itemId: count}
  catalog: {             // discovered
    bugs: new Set(),
    fish: new Set(),
    fossils: new Set(),
    art: new Set(),
  },
  // island progress
  daysPlayed: 1,
  // wanted
  wanted: 0,
  // terraforming
  terraformMode: false,    // toggled by T key — when true, E applies current tool
  terraformTool: 'climb',  // 'climb' | 'river' | 'path' (cliff/water/path)
  terraformPathStyle: 'path-grass',  // path style for path tool
  terraformTarget: null,   // {tx, ty} ghost preview tile
  terraformUnlocked: {
    climb: true,
    river: false,
    path: true,
  },
  terraformFreeUses: {climb: 50, river: 0, path: 100},  // free edits before needing permission
  // pos
  x: 32 * TILE + TILE/2,
  y: 32 * TILE + TILE/2,
  bobT: 0,
};

const VILLAGER_SPECIES = [
  {id:'cat',name:'Whiskers',emoji:'🐱',color:'cat',home:[26,40]},
  {id:'bear',name:'Maple',emoji:'🐻',color:'bear',home:[38,42]},
  {id:'pig',name:'Pebble',emoji:'🐷',color:'pig',home:[42,40]},
  {id:'frog',name:'Lily',emoji:'🐸',color:'frog',home:[20,38]},
  {id:'dog',name:'Sheriff Bones',emoji:'🐶',color:'dog',home:[28,28]},
  {id:'wolf',name:'Rex',emoji:'🐺',color:'wolf',home:[44,28]},
  {id:'elephant',name:'Stompy',emoji:'🐘',color:'elephant',home:[24,18]},
  {id:'rabbit',name:'Coco',emoji:'🐰',color:'rabbit',home:[40,18]},
  {id:'lion',name:'Leo',emoji:'🦁',color:'lion',home:[12,40]},
  {id:'raccoon',name:'M3-Maxwell',emoji:'🦝',color:'raccoon',home:[32,18]},
  {id:'penguin',name:'Pingu',emoji:'🐧',color:'penguin',home:[50,42]},
  {id:'deer',name:'Fauna',emoji:'🦌',color:'deer',home:[36,18]},
  {id:'mouse',name:'Mabel',emoji:'🐭',color:'mouse',home:[18,28]},
  {id:'hippo',name:'Hippo',emoji:'🦛',color:'hippo',home:[48,38]},
  {id:'horse',name:'Buck',emoji:'🐴',color:'horse',home:[22,42]},
  {id:'chicken',name:'Clucky',emoji:'🐔',color:'chicken',home:[14,42]},
  {id:'koala',name:'Koa',emoji:'🐨',color:'koala',home:[44,18]},
  {id:'goat',name:'Billy',emoji:'🐐',color:'goat',home:[18,42]},
  {id:'octopus',name:'Inkwell',emoji:'🐙',color:'octopus',home:[12,30]},
  {id:'eagle',name:'Apollo',emoji:'🦅',color:'eagle',home:[50,28]},
];

const villagers = [];
function initVillagers() {
  VILLAGER_SPECIES.forEach((s, i) => {
    const v = {
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      color: s.color,
      wx: s.home[0] + 0.5,
      wy: s.home[1] + 0.5,
      x: s.home[0] * TILE + TILE/2,
      y: s.home[1] * TILE + TILE/2,
      dir: 'down',
      frame: 0,
      frameT: 0,
      wanderT: 30 + (Math.random() * 90) | 0,
      home: s.home,
      homeBuilding: null, // some villagers assigned to a building
      friendship: 0,
      personality: ['lazy','jock','peppy','snooty','cranky','normal','smug','uchi'][(Math.random()*8)|0],
      hobby: ['fishing','bug','fossil','music','fashion','gardening'][(Math.random()*6)|0],
    };
    villagers.push(v);
  });
}

// =====================================================================
// 3.2  ITEMS — Catalog (bugs, fish, fossils, art)
// =====================================================================

const ITEMS = {
  // Tools
  'shovel':    {name:'铲子',type:'tool',icon:'icon-shovel',desc:'挖坑、移除树苗'},
  'axe':       {name:'斧头',type:'tool',icon:'icon-axe',desc:'砍树'},
  'rod':       {name:'钓竿',type:'tool',icon:'icon-rod',desc:'钓鱼'},
  'net':       {name:'捕虫网',type:'tool',icon:'icon-net',desc:'抓虫'},
  'watering':  {name:'洒水壶',type:'tool',icon:'icon-watering',desc:'浇灌作物'},
  'slingshot': {name:'弹弓',type:'tool',icon:'icon-shovel',desc:'打气球'},
  // Materials
  'branch':    {name:'树枝',type:'mat',icon:'icon-tree',desc:'基础材料'},
  'stone':     {name:'石头',type:'mat',icon:'icon-tree',desc:'基础材料'},
  'clay':      {name:'黏土',type:'mat',icon:'icon-tree',desc:'陶瓷材料'},
  'iron':      {name:'铁矿',type:'mat',icon:'icon-tree',desc:'金属材料'},
  // Sellable
  'fruit-apple':  {name:'苹果',type:'fruit',icon:'icon-fruit',sell:100,desc:'红红的苹果'},
  'fruit-orange': {name:'橘子',type:'fruit',icon:'icon-fruit',sell:100,desc:'柑橘类'},
  'fruit-peach':  {name:'桃子',type:'fruit',icon:'icon-fruit',sell:100,desc:'多汁桃子'},
  'fruit-cherry': {name:'樱桃',type:'fruit',icon:'icon-fruit',sell:100,desc:'成对樱桃'},
  // Fish
  'fish-crucian':     {name:'鲫鱼',type:'fish',sell:160,icon:'icon-fish',desc:'最常见的淡水鱼'},
  'fish-carp':        {name:'鲤鱼',type:'fish',sell:300,icon:'icon-fish',desc:'体格健壮'},
  'fish-koi':         {name:'锦鲤',type:'fish',sell:4000,icon:'icon-fish',desc:'稀有观赏鱼'},
  'fish-bass':        {name:'鲈鱼',type:'fish',sell:400,icon:'icon-fish',desc:'河中常见'},
  'fish-trout':       {name:'鳟鱼',type:'fish',sell:800,icon:'icon-fish',desc:'喜冷水'},
  'fish-tuna':        {name:'金枪鱼',type:'fish',sell:7000,icon:'icon-fish',desc:'海洋巨鱼'},
  'fish-oarfish':     {name:'皇带鱼',type:'fish',sell:9000,icon:'icon-fish',desc:'传说中的深海鱼'},
  'fish-seahorse':    {name:'海马',type:'fish',sell:1100,icon:'icon-fish',desc:'海洋中的小骑士'},
  // Bugs
  'bug-butterfly':  {name:'凤蝶',type:'bug',sell:160,icon:'icon-bug',desc:'彩色蝴蝶'},
  'bug-moth':       {name:'飞蛾',type:'bug',sell:130,icon:'icon-bug',desc:'夜行飞蛾'},
  'bug-beetle':     {name:'锹形虫',type:'bug',sell:2000,icon:'icon-bug',desc:'大角甲虫'},
  'bug-cicada':     {name:'蝉',type:'bug',sell:200,icon:'icon-bug',desc:'夏日鸣虫'},
  'bug-firefly':    {name:'萤火虫',type:'bug',sell:300,icon:'icon-bug',desc:'夜光精灵'},
  'bug-spider':     {name:'狼蛛',type:'bug',sell:6000,icon:'icon-bug',desc:'夜间活动'},
  // Fossils
  'fossil-ammonite':    {name:'菊石',type:'fossil',sell:1100,icon:'icon-fossil',desc:'远古螺壳'},
  'fossil-trilobite':   {name:'三叶虫',type:'fossil',sell:1300,icon:'icon-fossil',desc:'节肢动物祖先'},
  'fossil-dino-skull':  {name:'恐龙头骨',type:'fossil',sell:6000,icon:'icon-fossil',desc:'远古霸主'},
  'fossil-dino-tail':   {name:'恐龙尾骨',type:'fossil',sell:4500,icon:'icon-fossil',desc:'远古遗迹'},
  'fossil-mammoth':     {name:'猛犸象骨',type:'fossil',sell:5000,icon:'icon-fossil',desc:'冰河时代'},
  // Art
  'art-painting':   {name:'名画',type:'art',sell:2000,icon:'icon-crown',desc:'博物馆展品'},
  'art-statue':     {name:'雕像',type:'art',sell:1500,icon:'icon-crown',desc:'博物馆展品'},
  // Furniture (basic 8)
  'fur-chair':  {name:'木椅',type:'fur',sell:200,icon:'icon-house'},
  'fur-table':  {name:'木桌',type:'fur',sell:300,icon:'icon-house'},
  'fur-bed':    {name:'床',type:'fur',sell:2000,icon:'icon-house'},
  'fur-lamp':   {name:'台灯',type:'fur',sell:300,icon:'icon-house'},
  'fur-rug':    {name:'地毯',type:'fur',sell:500,icon:'icon-house'},
  'fur-clock':  {name:'挂钟',type:'fur',sell:400,icon:'icon-house'},
  'fur-shelf':  {name:'书架',type:'fur',sell:800,icon:'icon-house'},
  'fur-cabinet':{name:'柜子',type:'fur',sell:1200,icon:'icon-house'},
};

function makeItem(id, count=1) {
  return {id, count};
}

function addToBag(itemId, count=1) {
  player.bag[itemId] = (player.bag[itemId] || 0) + count;
  // refresh hotbar
  refreshHotbar();
}

function removeFromBag(itemId, count=1) {
  if (!player.bag[itemId]) return false;
  if (player.bag[itemId] < count) return false;
  player.bag[itemId] -= count;
  if (player.bag[itemId] <= 0) delete player.bag[itemId];
  refreshHotbar();
  return true;
}

function refreshHotbar() {
  player.hotbar = [];
  // tools first
  ['shovel', 'axe', 'rod', 'net', 'watering', 'slingshot'].forEach(id => {
    if (player.bag[id]) player.hotbar.push({id, count: player.bag[id], type:'tool'});
  });
  // then materials and items
  Object.keys(player.bag).forEach(id => {
    if (!['shovel','axe','rod','net','watering','slingshot'].includes(id)) {
      if (player.hotbar.length < 8) player.hotbar.push({id, count: player.bag[id], type:'item'});
    }
  });
  renderHotbar();
}

function renderHotbar() {
  const hb = document.getElementById('hotbar');
  if (!hb) return;
  hb.innerHTML = '';
  for (let i=0; i<8; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === player.tool ? ' active' : '');
    if (player.hotbar[i]) {
      const item = ITEMS[player.hotbar[i].id];
      if (item) {
        const cell = cells[item.icon];
        if (cell) {
          const c = document.createElement('canvas');
          c.width = cell.w; c.height = cell.h;
          const cx = c.getContext('2d');
          cx.imageSmoothingEnabled = false;
          cx.drawImage(atlas, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
          c.style.width = '24px'; c.style.height = '24px';
          c.style.imageRendering = 'pixelated';
          slot.appendChild(c);
        }
        const ct = document.createElement('span');
        ct.className = 'count';
        ct.textContent = player.hotbar[i].count;
        slot.appendChild(ct);
      }
    }
    slot.addEventListener('click', () => {
      player.tool = i;
      renderHotbar();
    });
    hb.appendChild(slot);
  }
}

// =====================================================================
// 3.3  QUEST / MILES SYSTEM
// =====================================================================

const QUESTS = [
  {id:'q1', title:'初来乍到', desc:'与 Mayor M3-Maxwell 对话', target:'mayor', reward:{miles:100, bells:500}},
  {id:'q2', title:'采集者', desc:'采集 3 朵花', target:'flowers', count:3, reward:{miles:200, bells:200}},
  {id:'q3', title:'钓客入门', desc:'钓 1 条鱼', target:'fish', count:1, reward:{miles:300, bells:300}},
  {id:'q4', title:'捉虫勇者', desc:'抓 1 只虫', target:'bug', count:1, reward:{miles:300, bells:300}},
  {id:'q5', title:'伐木工', desc:'砍 1 棵树', target:'tree', count:1, reward:{miles:500, bells:500}},
  {id:'q6', title:'矿工', desc:'击碎 3 块石头', target:'rock', count:3, reward:{miles:500, bells:500}},
  {id:'q7', title:'考古学家', desc:'挖出 1 块化石', target:'fossil', count:1, reward:{miles:800, bells:800}},
  {id:'q8', title:'农场主', desc:'种下 1 颗种子', target:'plant', count:1, reward:{miles:400, bells:400}},
  {id:'q9', title:'富翁', desc:'拥有 10000 Bells', target:'rich', reward:{miles:1000, bells:0}},
  {id:'q10', title:'岛民之友', desc:'与每位村民对话一次', target:'villagers', reward:{miles:2000, bells:0}},
  {id:'q11', title:'捐给博物馆', desc:'捐赠 3 件物品给博物馆', target:'donate', count:3, reward:{miles:1500, bells:0}},
  {id:'q12', title:'升级房屋', desc:'存款 50000 Bells', target:'savings', reward:{miles:3000, bells:0}},
];

const questState = {};

const MILES_TIERS = [
  {tier:1, name:'五星级岛民', desc:'完成 50 个 Nook Miles 任务', threshold:50, badge:'🥉'},
  {tier:2, name:'旅游达人', desc:'完成 100 个 Nook Miles 任务', threshold:100, badge:'🥈'},
  {tier:3, name:'岛主', desc:'完成 500 个 Nook Miles 任务', threshold:500, badge:'🥇'},
  {tier:4, name:'传奇居民', desc:'完成 1000 个 Nook Miles 任务', threshold:1000, badge:'💎'},
  {tier:5, name:'M3 Master', desc:'完成 5000 个 Nook Miles 任务', threshold:5000, badge:'👑'},
];

function addMiles(n) {
  player.miles += n;
  showToast(`+${n} Nook Miles ✈`);
}

function grantReward(reward) {
  if (reward.miles) addMiles(reward.miles);
  if (reward.bells) { player.bells += reward.bells; showToast(`+${reward.bells} Bells 💰`); }
}

// =====================================================================
// 3.4  TIME / WEATHER / SEASON
// =====================================================================

const time = {
  minutes: 8 * 60,      // 8:00 AM
  dayLength: 24,        // real minutes per game day
  weather: 'sunny',
  weatherT: 0,
  season: 'spring',
  dayOfMonth: 1,
  month: 3,             // March = spring
  year: 1,
  paused: false,
};

function advanceTime(dt) {
  if (time.paused) return;
  // dt is real seconds
  const gameMinutesPerSec = (24 * 60) / (time.dayLength * 60);
  time.minutes += dt * gameMinutesPerSec;
  if (time.minutes >= 24 * 60) {
    time.minutes -= 24 * 60;
    time.dayOfMonth++;
    player.daysPlayed++;
    onNewDay();
  }
  // weather cycle
  time.weatherT -= dt;
  if (time.weatherT <= 0) {
    time.weather = ['sunny','cloudy','rainy','storm'][((Math.random()*4)|0)];
    time.weatherT = 60 + Math.random() * 60;
  }
  // season
  time.month = 3 + Math.floor((time.dayOfMonth-1) / 30);
  if (time.month >= 3 && time.month < 6) time.season = 'spring';
  else if (time.month >= 6 && time.month < 9) time.season = 'summer';
  else if (time.month >= 9 && time.month < 12) time.season = 'autumn';
  else time.season = 'winter';
}

function onNewDay() {
  showBanner(`Day ${time.dayOfMonth} · ${capitalize(time.season)}`);
  // decrement wanted
  if (player.wanted > 0) player.wanted = Math.max(0, player.wanted - 1);
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// =====================================================================
// 3.5  INPUT
// =====================================================================

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  // E / Space → interact OR terraform-apply (if terraform mode is active and no NPC/building nearby)
  if (e.key === 'e' || e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!dialogueOpen && !modalOpen) interact();
  }
  // Shift+E → terraform-remove (lower/remove water/remove path)
  if (e.shiftKey && (e.key === 'E' || e.key === 'e')) {
    e.preventDefault();
    if (!dialogueOpen && !modalOpen) doTerraform('remove');
  }
  // T → open Island Designer (and toggle terraform mode on)
  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    if (!dialogueOpen && !modalOpen) {
      player.terraformMode = true;
      openTerraform();
    }
  }
  // I / Tab → inventory / island
  if (e.key === 'i' || e.key === 'I') { if (!modalOpen && !dialogueOpen) openAction('inventory'); }
  if (e.key === 'm' || e.key === 'M') { if (!modalOpen && !dialogueOpen) openAction('map'); }
  if (e.key === 'y' || e.key === 'Y') { if (!modalOpen && !dialogueOpen) openAction('phone'); }
  if (e.key === 'n' || e.key === 'N') { if (!modalOpen && !dialogueOpen) openAction('miles'); }
  if (e.key === 'j' || e.key === 'J') { if (!modalOpen && !dialogueOpen) openAction('museum'); }
  if (e.key === 'k' || e.key === 'K') { if (!modalOpen && !dialogueOpen) openAction('npc'); }
  if (e.key === 'Tab') { e.preventDefault(); if (!modalOpen && !dialogueOpen) openAction('island'); }
  // Escape: close any open modal/dialogue first, else open settings
  if (e.key === 'Escape') {
    if (modalOpen) { closeModal(); e.preventDefault(); return; }
    if (dialogueOpen) { closeDialogue(); e.preventDefault(); return; }
    openAction('settings');
  }
  if (e.key === 'b' || e.key === 'B') player.running = !player.running;
  if (e.key === 'r' || e.key === 'R') shakeTreeNearPlayer();
  if (e.key === 'l' || e.key === 'L') tryDig();
  if (e.key === 'x' || e.key === 'X') useItem();
  if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4' ||
      e.key === '5' || e.key === '6' || e.key === '7' || e.key === '8') {
    player.tool = parseInt(e.key) - 1;
    renderHotbar();
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// =====================================================================
// 3.6  PLAYER MOVEMENT + COLLISION
// =====================================================================

function isWalkable(x, y) {
  if (!inBounds(x, y)) return false;
  if (world.buildings[y][x]) return false;
  const t = world.terrain[y][x];
  if (t === 'water' || t === 'cliff' || t === 'cliff-top') return false;
  // elevation: only allow movement if target elevation is within 1 step of current
  const fromElev = (world.elevation[player.wy|0] && world.elevation[player.wy|0][player.wx|0]) || 0;
  const toElev = (world.elevation[y] && world.elevation[y][x]) || 0;
  if (Math.abs(fromElev - toElev) > 1) return false;
  return true;
}

function updatePlayer(dt) {
  // wanted-cooldown countdown
  if (player._ramCooldown !== undefined && player._ramCooldown > 0) {
    player._ramCooldown -= dt;
    if (player._ramCooldown < 0) player._ramCooldown = 0;
  }
  // determine direction from input
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup'])    { dy -= 1; player.dir = 'up'; }
  if (keys['s'] || keys['arrowdown'])  { dy += 1; player.dir = 'down'; }
  if (keys['a'] || keys['arrowleft'])  { dx -= 1; player.dir = 'left'; }
  if (keys['d'] || keys['arrowright']) { dx += 1; player.dir = 'right'; }
  // normalize diagonal
  if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
  const speed = (player.running ? 200 : 110) * dt;
  // try move
  if (dx !== 0 || dy !== 0) {
    const nx = player.wx + dx * speed / TILE;
    const ny = player.wy + dy * speed / TILE;
    // collision: try x, then y separately for sliding
    if (isWalkable(Math.floor(nx), Math.floor(player.wy))) player.wx = nx;
    if (isWalkable(Math.floor(player.wx), Math.floor(ny))) player.wy = ny;
    // GTA: sprinting INTO a building tile = ram, bumps wanted
    if (player.running) {
      const tx = (player.wx + dx * 0.5) | 0;
      const ty = (player.wy + dy * 0.5) | 0;
      if (inBounds(tx, ty) && world.buildings[ty] && world.buildings[ty][tx]) {
        if (player._ramCooldown === undefined || player._ramCooldown <= 0) {
          player._ramCooldown = 2;
          bumpWanted();
          showToast('💢 撞到建筑！WANTED +1');
          if (player.bells >= 100) player.bells -= 100;
        }
      }
    }
    // animate
    player.frameT += dt * (player.running ? 16 : 8);
    if (player.frameT > 0.18) { player.frameT = 0; player.frame = (player.frame + 1) % 4; }
    // bob
    player.bobT += dt * 8;
    // GTA: sprint into villager = hit-and-run, increases wanted level
    if (player.running) {
      for (const v of villagers) {
        const dd = dist(v.wx, v.wy, player.wx, player.wy);
        if (dd < 0.6 && v.cooldownHit === undefined) {
          v.cooldownHit = 1.5;  // seconds before can hit again
          // push villager away (knockback)
          const ang = Math.atan2(v.wy - player.wy, v.wx - player.wx);
          v.wx += Math.cos(ang) * 1.2;
          v.wy += Math.sin(ang) * 1.2;
          // villager is now "knocked" - pauses wander for 2s
          v.knockedT = 2;
          bumpWanted();
          showToast('💥 撞到 ' + (v.ref.name || v.ref.id) + '！WANTED +1');
          // small bell fine
          if (player.bells >= 50) player.bells -= 50;
        }
      }
    }
  } else {
    player.frame = 0;
  }
  // continuous pixel pos
  player.x = player.wx * TILE + TILE/2;
  player.y = player.wy * TILE + TILE/2;
  // camera follow
  cam.targetZoom = 1.0;
  // pan camera smoothly (cam.x, cam.y are in world tile units, centered on player)
  const tgtX = player.wx;
  const tgtY = player.wy;
  cam.x = lerp(cam.x, tgtX, 0.12);
  cam.y = lerp(cam.y, tgtY, 0.12);
  cam.zoom = lerp(cam.zoom, cam.targetZoom, 0.08);
  // shake decay
  if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt * 8); }
}

function addShake(amount) { cam.shake = Math.max(cam.shake, amount); }

// =====================================================================
// 3.7  INTERACTION
// =====================================================================

function interact() {
  // 1) nearest villager
  let best = null, bestD = 1.2;
  for (const v of villagers) {
    const d = dist(v.wx, v.wy, player.wx, player.wy);
    if (d < bestD) { best = v; bestD = d; }
  }
  if (best) { talkToVillager(best); return; }
  // 2) nearest building
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.buildings[ty][tx]) {
        const bid = world.buildings[ty][tx];
        interactBuilding(bid);
        return;
      }
    }
  }
  // 3) shake tree / hit rock
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.scenery[ty][tx]) {
        const s = world.scenery[ty][tx];
        if (s && s.startsWith('tree')) { shakeTree(tx, ty); return; }
        if (s === 'rock' || s === 'rock-gold') { hitRock(tx, ty); return; }
      }
    }
  }
  // 4) pickup item
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.items[ty][tx]) {
        const it = world.items[ty][tx];
        addToBag(it.id, it.count || 1);
        delete world.items[ty][tx];
        showToast(`获得 ${ITEMS[it.id] ? ITEMS[it.id].name : it.id}`);
        questProgress('q2', 1);
        return;
      }
    }
  }
  // 5) harvest crop
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.crops[ty][tx] && world.crops[ty][tx].stage === 3) {
        harvestCrop(tx, ty);
        return;
      }
    }
  }
  // 6) flowers → bug
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.decorations[ty][tx] && world.decorations[ty][tx].startsWith('flower')) {
        tryCatchBug();
        return;
      }
    }
  }
  // 7) water nearby → fish
  for (let dy=-2; dy<=2; dy++) {
    for (let dx=-2; dx<=2; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.terrain[ty][tx] === 'water') {
        tryFish();
        return;
      }
    }
  }
  // 8) terraform apply (only if terraform mode is active)
  if (player.terraformMode) {
    doTerraform('apply');
  } else {
    showToast('没什么可以互动的 (按 T 进入 Island Designer)');
  }
  return;
}

function dist(ax, ay, bx, by) { return Math.hypot(ax-bx, ay-by); }

function shakeTreeNearPlayer() {
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.scenery[ty][tx] && world.scenery[ty][tx].startsWith('tree')) {
        shakeTree(tx, ty);
        return;
      }
    }
  }
}

function tryDig() {
  // dig with shovel
  if (!player.bag['shovel']) { showToast('没有铲子'); return; }
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.terrain[ty][tx] === 'grass') {
        world.terrain[ty][tx] = 'tilled';
        showToast('挖好了！可以种田了');
        return;
      }
      // dig up flower
      if (inBounds(tx, ty) && world.decorations[ty][tx]) {
        delete world.decorations[ty][tx];
        addToBag('branch', 1);
        showToast('采集了 1 朵花');
        questProgress('q2', 1);
        return;
      }
    }
  }
}

function useItem() {
  if (!player.hotbar[player.tool]) { showToast('没选东西'); return; }
  const id = player.hotbar[player.tool].id;
  if (id === 'shovel') { tryDig(); return; }
  if (id === 'axe') { tryCutTree(); return; }
  if (id === 'rod') { tryFish(); return; }
  if (id === 'net') { tryCatchBug(); return; }
  if (id === 'watering') { tryWater(); return; }
  if (id === 'slingshot') { showToast('🎈 砰！打中一个气球！'); addMiles(10); return; }
  if (id.startsWith('seed-') || id === 'fruit-apple') { tryPlant(id); return; }
  if (id === 'fruit-apple' || id === 'fruit-orange' || id === 'fruit-peach' || id === 'fruit-cherry') {
    showToast('吃了一个水果 (体力满满)');
    removeFromBag(id, 1);
    addMiles(5);
  }
  if (id === 'shell') showToast('漂亮的贝壳');
}

function tryCutTree() {
  if (!player.bag['axe']) { showToast('没有斧头'); return; }
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.scenery[ty][tx] && world.scenery[ty][tx].startsWith('tree')) {
        const s = world.scenery[ty][tx];
        delete world.scenery[ty][tx];
        addToBag(s === 'tree-fruit' ? 'fruit-apple' : 'branch', 1);
        addToBag('wood', 2 + ((Math.random()*3)|0));
        showToast('砍了棵树 +木材');
        questProgress('q5', 1);
        return;
      }
    }
  }
}

function tryFish() {
  if (!player.bag['rod']) { showToast('没有钓竿'); return; }
  // 70% catch a fish, 30% trash
  const r = Math.random();
  let caught;
  if (r < 0.5) caught = 'fish-crucian';
  else if (r < 0.7) caught = 'fish-bass';
  else if (r < 0.8) caught = 'fish-trout';
  else if (r < 0.9) caught = 'fish-carp';
  else if (r < 0.95) caught = 'fish-koi';
  else caught = 'fish-tuna';
  addToBag(caught, 1);
  player.catalog.fish.add(caught);
  showToast(`钓到了 ${ITEMS[caught].name}! 🐟`);
  addMiles(20);
  questProgress('q3', 1);
  // small particle splash
  for (let i=0; i<6; i++) spawnParticle('bubble', player.wx, player.wy, {vx: (Math.random()-0.5)*1, vy: -0.5 - Math.random(), life: 40});
}

function tryCatchBug() {
  if (!player.bag['net']) { showToast('没有捕虫网'); return; }
  const tod = timeOfDay(time.minutes);
  const r = Math.random();
  let caught;
  if (tod === 'night') {
    caught = r < 0.5 ? 'bug-firefly' : 'bug-moth';
  } else {
    if (r < 0.5) caught = 'bug-butterfly';
    else if (r < 0.8) caught = 'bug-cicada';
    else if (r < 0.9) caught = 'bug-beetle';
    else caught = 'bug-spider';
  }
  addToBag(caught, 1);
  player.catalog.bugs.add(caught);
  showToast(`抓到了 ${ITEMS[caught].name}! 🐛`);
  addMiles(20);
  questProgress('q4', 1);
}

function hitRock(tx, ty) {
  addShake(2);
  for (let i=0; i<4; i++) spawnParticle('dust', tx, ty, {vx:(Math.random()-0.5)*2, vy:-1-Math.random(), life: 30});
  const r = Math.random();
  let item;
  if (world.scenery[ty][tx] === 'rock-gold') {
    item = r < 0.5 ? 'gold' : 'iron';
  } else {
    if (r < 0.6) item = 'stone';
    else if (r < 0.85) item = 'clay';
    else if (r < 0.95) item = 'iron';
    else { item = 'fossil-ammonite'; player.catalog.fossils.add(item); showBanner(`发现新化石! ${ITEMS[item].name}`); }
  }
  addToBag(item, 1);
  addMiles(5);
  questProgress('q6', 1);
  if (item.startsWith('fossil')) questProgress('q7', 1);
}

function shakeTree(tx, ty) {
  addShake(1.5);
  const r = Math.random();
  let item;
  if (r < 0.5) item = 'branch';
  else if (r < 0.7) item = 'fruit-apple';
  else if (r < 0.85) item = 'bell';
  else item = 'shell';
  addToBag(item, 1);
  for (let i=0; i<6; i++) spawnParticle('leaf', tx, ty, {vx:(Math.random()-0.5)*1.5, vy:-0.5-Math.random(), life: 60});
  showToast(`树掉下了 ${ITEMS[item] ? ITEMS[item].name : item}`);
  addMiles(5);
}

function tryWater() {
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && world.terrain[ty][tx] === 'tilled') {
        world.terrain[ty][tx] = 'tilled-water';
        addMiles(2);
        return;
      }
    }
  }
  showToast('没有可浇的田');
}

function tryPlant(seedId) {
  for (let dy=-1; dy<=1; dy++) {
    for (let dx=-1; dx<=1; dx++) {
      const tx = (player.wx + dx) | 0, ty = (player.wy + dy) | 0;
      if (inBounds(tx, ty) && (world.terrain[ty][tx] === 'tilled' || world.terrain[ty][tx] === 'tilled-water')) {
        world.crops[ty][tx] = {stage: 0, type: 'apple'};
        removeFromBag(seedId, 1);
        showToast('种下了种子');
        questProgress('q8', 1);
        return;
      }
    }
  }
  showToast('没找到可种的地');
}

function harvestCrop(tx, ty) {
  addToBag('fruit-apple', 1);
  world.crops[ty][tx] = null;
  world.terrain[ty][tx] = 'tilled';
  showToast('收获了苹果!');
  addMiles(10);
  for (let i=0; i<4; i++) spawnParticle('sparkle', tx, ty, {vx:(Math.random()-0.5), vy:-0.5-Math.random(), life: 30});
}

// crop growth tick
function updateCrops() {
  for (let y=0; y<WORLD_H; y++) {
    for (let x=0; x<WORLD_W; x++) {
      const c = world.crops[y][x];
      if (!c) continue;
      // only grow if watered
      if (world.terrain[y][x] === 'tilled-water') {
        if (Math.random() < 0.01) {
          c.stage = Math.min(3, c.stage + 1);
          if (c.stage === 3) world.terrain[y][x] = 'tilled';
        }
      }
    }
  }
}

function questProgress(qid, amt=1) {
  const q = QUESTS.find(q => q.id === qid);
  if (!q) return;
  if (!questState[qid]) questState[qid] = 0;
  if (q.count) questState[qid] += amt;
  if (q.target === 'rich' && player.bells >= 10000) questState[qid] = 1;
  if (q.target === 'savings' && player.bank >= 50000) questState[qid] = 1;
  if (q.count && questState[qid] >= q.count) {
    completeQuest(qid);
  }
}

function completeQuest(qid) {
  if (questState[qid + '-done']) return;
  questState[qid + '-done'] = true;
  const q = QUESTS.find(q => q.id === qid);
  if (!q) return;
  grantReward(q.reward);
  showBanner(`任务完成: ${q.title}! +${q.reward.miles} ✈`);
  addMiles(50);
  player.rep += 5;
}

// =====================================================================
// 3.8  TALK TO VILLAGER
// =====================================================================

let dialogueOpen = false;
let modalOpen = false;

function talkToVillager(v) {
  dialogueOpen = true;
  // open dialog
  const dlg = document.getElementById('dialogue');
  dlg.classList.remove('hidden');
  document.getElementById('dlg-portrait').textContent = v.emoji;
  document.getElementById('dlg-name').textContent = v.name;
  const greetings = [
    `欢迎来到 M3 Island! 我是 ${v.name}，${v.personality}的${v.id}~`,
    `${v.name} 在这里! 今天想干嘛？`,
    `你好呀! 我的爱好是${v.hobby}哦。`,
    `我听说你收集了好多 Nook Miles? 真厉害!`,
    `${v.name} 给你的小贴士: 多和岛民聊天能提升岛民评级!`,
  ];
  const text = greetings[(Math.random()*greetings.length)|0];
  document.getElementById('dlg-text').textContent = text;
  const choices = document.getElementById('dlg-choices');
  choices.innerHTML = '';
  // give gift option if friendship
  if (v.friendship >= 1) {
    const btn = document.createElement('button');
    btn.textContent = '🎁 送礼物';
    btn.onclick = () => { giveGift(v); closeDialogue(); };
    choices.appendChild(btn);
  }
  const btn2 = document.createElement('button');
  btn2.textContent = '👋 告别';
  btn2.onclick = () => { v.friendship++; questProgress('q10', 1); closeDialogue(); };
  choices.appendChild(btn2);
  // also small friendship gain
  v.friendship++;
  if (!questState['q1-done']) {
    completeQuest('q1');
  }
}

function giveGift(v) {
  // find giftable in bag
  for (const k of Object.keys(player.bag)) {
    const it = ITEMS[k];
    if (!it) continue;
    if (it.type === 'fruit' || it.type === 'fish' || it.type === 'bug') {
      removeFromBag(k, 1);
      v.friendship += 3;
      addMiles(20);
      showToast(`${v.name} 很喜欢你的礼物!`);
      return;
    }
  }
  showToast('没有可送的礼物');
}

function closeDialogue() {
  document.getElementById('dialogue').classList.add('hidden');
  dialogueOpen = false;
}
document.getElementById('dlg-close').addEventListener('click', closeDialogue);

// =====================================================================
// 3.9  BUILDING INTERACTIONS
// =====================================================================

function interactBuilding(id) {
  if (id === 'nooks') openNooks();
  else if (id === 'able') openAbleSisters();
  else if (id === 'museum') openMuseum();
  else if (id === 'resident') openResident();
  else if (id === 'airport') openAirport();
  else if (id === 'shop') openShop();
  else if (id === 'bank') openBank();
  else if (id === 'pawn') openPawn();
  else if (id === 'tower') openTower();
  else if (id === 'kks') openKKS();
  else if (id === 'camp') openCamp();
  else if (id === 'sign') showToast('欢迎来到 M3 Island!');
  else showToast(`进入 ${id}`);
}

// =====================================================================
// 3.7b TERRAFORMING — Island Designer
// =====================================================================
// Tools: climb (raise/lower cliff by 1 level), river (place water), path (place path pattern).
// Permission: 50 free cliff edits, 100 free path edits, 0 free water (locked by default).
// Unlock water after island 3-star (matches AC progression).
// Elevation is rendered as a Y-offset in pixels: elevation * 16 px.
// Ramps are auto-placed at boundaries between different elevations.

const ELEVATION_PX = 32;  // visual offset per elevation level (more dramatic)

function terraformUp(tx, ty) {
  // raise tile one level
  if (!inBounds(tx, ty)) return false;
  if (world.buildings[ty][tx]) { showToast('不能改建筑'); return false; }
  if (world.scenery[ty][tx]) { showToast('清掉树/石头再改'); return false; }
  const t = world.terrain[ty][tx];
  if (t === 'water') { showToast('不能在水里建'); return false; }
  if (world.elevation[ty][tx] >= 3) { showToast('已经最高了'); return false; }
  world.elevation[ty][tx]++;
  showToast('⬆ 抬高了地形');
  addMiles(2);
  return true;
}

function terraformDown(tx, ty) {
  if (!inBounds(tx, ty)) return false;
  if (world.buildings[ty][tx] || world.scenery[ty][tx]) { showToast('清掉再改'); return false; }
  if (world.elevation[ty][tx] <= 0) { showToast('已经最低了'); return false; }
  world.elevation[ty][tx]--;
  showToast('⬇ 降低了地形');
  addMiles(2);
  return true;
}

function terraformWater(tx, ty) {
  if (!player.terraformUnlocked.river) { showToast('Island Designer: 河流需要岛屿 3⭐ 解锁'); return false; }
  if (!inBounds(tx, ty)) return false;
  if (world.buildings[ty][tx] || world.scenery[ty][tx]) return false;
  const t = world.terrain[ty][tx];
  if (t === 'water') {
    // remove water
    world.terrain[ty][tx] = 'grass';
    world.elevation[ty][tx] = 0;
    showToast('填了水');
    addMiles(2);
    return true;
  }
  if (t === 'cliff' || t === 'cliff-top') { showToast('不能在悬崖上'); return false; }
  world.terrain[ty][tx] = 'water';
  world.elevation[ty][tx] = 0;
  showToast('💧 挖了水');
  addMiles(5);
  return true;
}

function terraformPath(tx, ty) {
  if (!inBounds(tx, ty)) return false;
  if (world.buildings[ty][tx] || world.scenery[ty][tx]) return false;
  const t = world.terrain[ty][tx];
  if (t === 'water' || t === 'cliff' || t === 'cliff-top') { showToast('这里不能铺路'); return false; }
  if (world.path[ty][tx] === 0) {
    // place path
    world.path[ty][tx] = player.terraformPathStyle;
    showToast('铺了路');
    addMiles(1);
    return true;
  } else {
    // remove path
    world.path[ty][tx] = 0;
    showToast('拆了路');
    return true;
  }
}

function openTerraform() {
  // The Island Designer tool picker
  const tools = [
    {id:'climb', icon:'⛰', name:'高地建设器', desc:'抬高 / 降低地形。按 E 抬高, R 降低。'},
    {id:'river', icon:'💧', name:'河水建设器', desc:'挖水 / 填水。需要岛屿 3⭐ 解锁。'},
    {id:'path',  icon:'🛤', name:'路径建设器', desc:'铺设自定义路径。'},
  ];
  const pathStyles = [
    {id:'path-grass', icon:'🟢', name:'草路'},
    {id:'path-cross', icon:'🟡', name:'石板路'},
    {id:'path-brick', icon:'🟫', name:'砖路'},
    {id:'path-stone', icon:'⬜', name:'灰石路'},
    {id:'path-wood',  icon:'🟧', name:'木栈道'},
  ];
  openModal('⛰ Island Designer — 岛屿设计师', `
    <p style="font-size:10px;color:#1c1917">选择工具 (按 ESC 取消)。</p>
    <div class="modal-grid">
      ${tools.map(t => `
        <div class="icon-cell ${player.terraformTool === t.id ? 'collected' : ''}" onclick="window._tfSelectTool('${t.id}')">
          <span class="ico" style="font-size:32px">${t.icon}</span>
          <div>${t.name}</div>
          <div style="color:#57534e;font-size:8px">${t.desc}</div>
          ${player.terraformUnlocked[t.id] ? '' : '<div style="color:#dc2626;font-size:8px">🔒 未解锁</div>'}
        </div>
      `).join('')}
    </div>
    <h3 style="margin-top:12px">路径样式 (路径建设器)</h3>
    <div class="modal-grid">
      ${pathStyles.map(p => `
        <div class="icon-cell ${player.terraformPathStyle === p.id ? 'collected' : ''}" onclick="window._tfSelectPath('${p.id}')">
          <span class="ico" style="font-size:32px">${p.icon}</span>
          <div>${p.name}</div>
        </div>
      `).join('')}
    </div>
    <p style="font-size:9px;color:#57534e;margin-top:12px">
      工具已选: <b>${tools.find(t => t.id === player.terraformTool).icon} ${tools.find(t => t.id === player.terraformTool).name}</b><br>
      路径样式: <b>${pathStyles.find(p => p.id === player.terraformPathStyle).name}</b><br>
      <b>操作:</b> 走到地块上按 <b>E</b> 应用当前工具（E 按下方向 = 抬高/挖水/铺路；E 长按 R 键 = 降低/填水/拆路）
    </p>
  `);
}

window._tfSelectTool = function(id) {
  if (!player.terraformUnlocked[id]) { showToast('该工具未解锁'); return; }
  player.terraformTool = id;
  openTerraform();
  showBanner(`工具切换: ${id}`);
};
window._tfSelectPath = function(id) {
  player.terraformPathStyle = id;
  openTerraform();
};

function doTerraform(action) {
  // action = 'apply' or 'remove'
  const tx = (player.wx)|0, ty = (player.wy)|0;
  if (!inBounds(tx, ty)) return;
  if (action === 'apply') {
    if (player.terraformTool === 'climb') terraformUp(tx, ty);
    else if (player.terraformTool === 'river') terraformWater(tx, ty);
    else if (player.terraformTool === 'path') terraformPath(tx, ty);
  } else {
    if (player.terraformTool === 'climb') terraformDown(tx, ty);
    else if (player.terraformTool === 'river') terraformWater(tx, ty);
    else if (player.terraformTool === 'path') terraformPath(tx, ty);
  }
}

function openNooks() {
  // shopping modal: tools + furniture
  const stock = [
    {id:'shovel',price:800},{id:'axe',price:1200},{id:'rod',price:2500},
    {id:'net',price:2000},{id:'watering',price:1500},{id:'slingshot',price:900},
    {id:'fur-chair',price:1200},{id:'fur-table',price:1800},{id:'fur-bed',price:5000},
    {id:'fur-lamp',price:800},{id:'fur-rug',price:1500},{id:'fur-clock',price:1400},
  ];
  openModal('Nook\'s Cranny 🏪 — 商店', `
    <div class="modal-stats">
      <div class="stat-box"><b>💰 ${player.bells}</b><span>你的铃钱</span></div>
      <div class="stat-box"><b>✈ ${player.miles}</b><span>Nook Miles</span></div>
    </div>
    <div class="modal-grid">
      ${stock.map(s => {
        const it = ITEMS[s.id];
        return `<div class="icon-cell"><span class="ico">${iconEmoji(s.id)}</span><div>${it.name}</div><div style="color:#7c3aed">${s.price}💰</div><button onclick="window._buy('${s.id}',${s.price})" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button></div>`;
      }).join('')}
    </div>
  `);
}

window._buy = function(id, price) {
  if (player.bells < price) { showToast('铃钱不够'); return; }
  player.bells -= price;
  addToBag(id, 1);
  showToast(`购买了 ${ITEMS[id].name}!`);
  openNooks();
};

function iconEmoji(id) {
  const map = {
    'shovel':'⛏️','axe':'🪓','rod':'🎣','net':'🥅','watering':'💧','slingshot':'🎯',
    'fur-chair':'🪑','fur-table':'🪑','fur-bed':'🛏️','fur-lamp':'💡','fur-rug':'🟫','fur-clock':'⏰',
  };
  return map[id] || '📦';
}

function openAbleSisters() {
  // clothing shop
  const patterns = ['🌸','🌺','🌷','🌹','🌻','🌼','🌿','🍀','🎀','👒','👗','👜','💎','🌟','⭐','✨'];
  openModal('Able Sisters 👗 — 时装店', `
    <div class="modal-stats">
      <div class="stat-box"><b>💰 ${player.bells}</b><span>铃钱</span></div>
      <div class="stat-box"><b>👗 ${player.bag['pattern'] || 0}</b><span>我的花样</span></div>
    </div>
    <p style="font-size:10px;color:#1c1917">购买我的设计: 自定义花样、衣服、包包!</p>
    <div class="modal-grid">
      ${patterns.map((p, i) => `
        <div class="icon-cell"><span class="ico" style="font-size:32px">${p}</span><div>花样 #${i+1}</div><div style="color:#7c3aed">${200 + i*100}💰</div>
          <button onclick="window._buyPattern(${i},${200+i*100})" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#ec4899;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button>
        </div>
      `).join('')}
    </div>
  `);
}

window._buyPattern = function(i, price) {
  if (player.bells < price) { showToast('铃钱不够'); return; }
  player.bells -= price;
  addToBag('pattern', 1);
  showToast(`购买了花样 #${i+1}!`);
  openAbleSisters();
};

function openMuseum() {
  const bugs = Object.keys(ITEMS).filter(k => ITEMS[k].type === 'bug');
  const fish = Object.keys(ITEMS).filter(k => ITEMS[k].type === 'fish');
  const fossils = Object.keys(ITEMS).filter(k => ITEMS[k].type === 'fossil');
  const art = Object.keys(ITEMS).filter(k => ITEMS[k].type === 'art');
  const stats = {
    bug: player.catalog.bugs.size, bugMax: bugs.length,
    fish: player.catalog.fish.size, fishMax: fish.length,
    fossil: player.catalog.fossils.size, fossilMax: fossils.length,
    art: player.catalog.art.size, artMax: art.length,
  };
  openModal('🏛 Blathers 博物馆', `
    <div class="modal-stats">
      <div class="stat-box"><b>🐛 ${stats.bug}/${stats.bugMax}</b><span>虫子</span></div>
      <div class="stat-box"><b>🐟 ${stats.fish}/${stats.fishMax}</b><span>鱼</span></div>
      <div class="stat-box"><b>🦴 ${stats.fossil}/${stats.fossilMax}</b><span>化石</span></div>
      <div class="stat-box"><b>🎨 ${stats.art}/${stats.artMax}</b><span>艺术品</span></div>
    </div>
    <p style="font-size:10px;color:#1c1917;margin-bottom:8px">捐赠物品以填充博物馆。每件物品首次捐赠可获 Nook Miles 奖励!</p>
    <div class="modal-tabs">
      <button class="tab active" onclick="window._museumTab='bug';window._showMuseumTab()">虫子</button>
      <button class="tab" onclick="window._museumTab='fish';window._showMuseumTab()">鱼</button>
      <button class="tab" onclick="window._museumTab='fossil';window._showMuseumTab()">化石</button>
      <button class="tab" onclick="window._museumTab='art';window._showMuseumTab()">艺术品</button>
    </div>
    <div id="museum-grid">
      ${renderMuseumGrid('bug', bugs)}
    </div>
  `);
}

window._museumTab = 'bug';
window._showMuseumTab = function() {
  const tab = window._museumTab;
  const items = Object.keys(ITEMS).filter(k => ITEMS[k].type === tab);
  document.getElementById('museum-grid').innerHTML = renderMuseumGrid(tab, items);
  // update tab visuals
  document.querySelectorAll('.modal-tabs .tab').forEach((b, i) => {
    b.classList.toggle('active', ['bug','fish','fossil','art'][i] === tab);
  });
};

function renderMuseumGrid(tab, items) {
  const cat = player.catalog[tab === 'bug' ? 'bugs' : tab === 'fish' ? 'fish' : tab === 'fossil' ? 'fossils' : 'art'];
  return `<div class="modal-grid">` + items.map(id => {
    const it = ITEMS[id];
    const have = cat.has(id);
    const bagCount = player.bag[id] || 0;
    return `<div class="icon-cell ${have ? 'collected' : 'undiscovered'}">
      <span class="ico">${have ? iconEmoji(id) : '?'}</span>
      <div>${have ? it.name : '???'}</div>
      ${have ? '' : `<div style="color:#57534e;font-size:8px">未发现</div>`}
      ${have && bagCount > 0 ? `<button onclick="window._donate('${id}')" style="margin-top:2px;padding:2px 4px;font-size:8px;background:#16a34a;color:#fff;border:1px solid #0f172a;border-radius:2px;cursor:pointer">捐赠(${bagCount})</button>` : ''}
    </div>`;
  }).join('') + `</div>`;
}

window._donate = function(id) {
  if (!removeFromBag(id, 1)) return;
  addMiles(100);
  player.rep += 5;
  showToast(`已捐赠 ${ITEMS[id].name}! +100 ✈`);
  questProgress('q11', 1);
  openMuseum();
};

function openResident() {
  // island services: pay loan, get advice
  openModal('🏛 Resident Services — 居民服务', `
    <p style="font-size:10px;color:#1c1917">你好, ${player.islandName} 居民! 这里是岛屿服务中心。</p>
    <div class="modal-stats">
      <div class="stat-box"><b>💰 ${player.bells}</b><span>钱包</span></div>
      <div class="stat-box"><b>🏦 ${player.bank}</b><span>银行</span></div>
      <div class="stat-box"><b>${'⭐'.repeat(player.islandStars)}${'☆'.repeat(5-player.islandStars)}</b><span>岛屿评级</span></div>
      <div class="stat-box"><b>📅 Day ${time.dayOfMonth}</b><span>${capitalize(time.season)}</span></div>
    </div>
    <h3>🏠 房屋升级</h3>
    <p style="font-size:10px;color:#1c1917">存入更多铃钱以升级房屋。</p>
    <button onclick="window._saveBell(1000)" style="margin:4px;padding:8px 16px;background:#16a34a;color:#fff;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">存入 1000💰</button>
    <button onclick="window._saveBell(10000)" style="margin:4px;padding:8px 16px;background:#16a34a;color:#fff;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">存入 10000💰</button>
    <button onclick="window._saveBell(100000)" style="margin:4px;padding:8px 16px;background:#16a34a;color:#fff;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">存入 100000💰</button>
  `);
}

window._saveBell = function(n) {
  if (player.bells < n) { showToast('钱包铃钱不够'); return; }
  player.bells -= n;
  player.bank += n;
  addMiles(Math.floor(n/100));
  questProgress('q12', 1);
  openResident();
  showToast(`已存 ${n}💰到银行`);
};

function openAirport() {
  // mystery island travel
  const islands = [
    {name:'Tarot Island',emoji:'🃏',desc:'高贝壳高化石'},
    {name:'Bamboo Island',emoji:'🎋',desc:'竹子和杂草多'},
    {name:'Bell Island',emoji:'💰',desc:'摇钱树岛'},
    {name:'Fossil Island',emoji:'🦴',desc:'化石富集'},
    {name:'Cherry Island',emoji:'🌸',desc:'樱花花瓣雨'},
  ];
  openModal('✈ Dodo Airlines — 神秘岛屿', `
    <p style="font-size:10px;color:#1c1917">花 2000 Nook Miles 飞往神秘岛屿采集！</p>
    <div class="modal-grid">
      ${islands.map((is, i) => `
        <div class="icon-cell"><span class="ico" style="font-size:32px">${is.emoji}</span><div>${is.name}</div><div style="color:#57534e;font-size:8px">${is.desc}</div>
          <button onclick="window._travel(${i})" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#3a5a8a;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">2000✈</button>
        </div>
      `).join('')}
    </div>
  `);
}

window._travel = function(idx) {
  if (player.miles < 2000) { showToast('Nook Miles 不够'); return; }
  player.miles -= 2000;
  // spawn random items on player tile
  const items = ['branch','stone','fruit-apple','bell','shell','fossil-ammonite','clay','iron'];
  const r = items[(Math.random()*items.length)|0];
  addToBag(r, 1 + ((Math.random()*3)|0));
  if (r.startsWith('fossil')) player.catalog.fossils.add(r);
  showBanner(`飞到了神秘岛屿! 找到了 ${ITEMS[r] ? ITEMS[r].name : r}!`);
  closeModal();
};

function openShop() {
  // general store: misc items
  openModal('🏪 杂货店', `
    <p style="font-size:10px;color:#1c1917">杂货、日用品、小工具。</p>
    <div class="modal-grid">
      <div class="icon-cell"><span class="ico">🍎</span><div>苹果种子</div><div style="color:#7c3aed">100💰</div>
        <button onclick="window._buyFruit('fruit-apple',100)" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button>
      </div>
      <div class="icon-cell"><span class="ico">🍊</span><div>橘子种子</div><div style="color:#7c3aed">100💰</div>
        <button onclick="window._buyFruit('fruit-orange',100)" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button>
      </div>
      <div class="icon-cell"><span class="ico">🌸</span><div>樱花种子</div><div style="color:#7c3aed">200💰</div>
        <button onclick="window._buyFruit('fruit-cherry',200)" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button>
      </div>
      <div class="icon-cell"><span class="ico">🌺</span><div>桃花种子</div><div style="color:#7c3aed">200💰</div>
        <button onclick="window._buyFruit('fruit-peach',200)" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:3px;cursor:pointer">买</button>
      </div>
    </div>
  `);
}

window._buyFruit = function(id, price) {
  if (player.bells < price) { showToast('铃钱不够'); return; }
  player.bells -= price;
  addToBag(id, 1);
  showToast(`购买了 ${ITEMS[id].name}!`);
};

function openBank() {
  openModal('🏦 Nook Bank — 银行', `
    <div class="modal-stats">
      <div class="stat-box"><b>💰 ${player.bells}</b><span>钱包</span></div>
      <div class="stat-box"><b>🏦 ${player.bank}</b><span>存款</span></div>
      <div class="stat-box"><b>💎 ${(player.bank * 0.001)|0}</b><span>利息 (年化 0.1%)</span></div>
    </div>
    <p style="font-size:10px;color:#1c1917">把铃钱存进银行赚取利息！</p>
    <button onclick="window._bank(1000)" style="margin:4px;padding:6px 12px;background:#67e8f9;color:#0f172a;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">存 1000</button>
    <button onclick="window._bank(10000)" style="margin:4px;padding:6px 12px;background:#67e8f9;color:#0f172a;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">存 10000</button>
    <button onclick="window._bankAll()" style="margin:4px;padding:6px 12px;background:#67e8f9;color:#0f172a;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">全存</button>
  `);
}

window._bank = function(n) {
  if (player.bells < n) { showToast('不够'); return; }
  player.bells -= n;
  player.bank += n;
  addMiles(Math.floor(n/100));
  openBank();
};

window._bankAll = function() {
  player.bank += player.bells;
  player.bells = 0;
  openBank();
};

function openPawn() {
  // sell items
  const sellable = Object.keys(player.bag).filter(k => {
    const it = ITEMS[k];
    return it && (it.sell || it.type === 'mat' || it.type === 'fur');
  });
  if (sellable.length === 0) {
    openModal('💰 当铺', `<p style="font-size:10px;color:#1c1917">没有可卖的物品。先去采集吧!</p>`);
    return;
  }
  openModal('💰 当铺 — 出售', `
    <p style="font-size:10px;color:#1c1917">出售你的物品换铃钱。</p>
    <div class="modal-grid">
      ${sellable.map(id => {
        const it = ITEMS[id];
        const sellPrice = it.sell || 50;
        const count = player.bag[id];
        return `<div class="icon-cell">
          <span class="ico">${iconEmoji(id)}</span>
          <div>${it.name} (${count})</div>
          <div style="color:#7c3aed">${sellPrice}💰/个</div>
          <button onclick="window._sell('${id}',${sellPrice})" style="margin-top:2px;padding:2px 4px;font-size:8px;background:#dc2626;color:#fff;border:1px solid #0f172a;border-radius:2px;cursor:pointer">卖 1</button>
          <button onclick="window._sellAll('${id}',${sellPrice})" style="margin-top:2px;padding:2px 4px;font-size:8px;background:#dc2626;color:#fff;border:1px solid #0f172a;border-radius:2px;cursor:pointer">卖全部</button>
        </div>`;
      }).join('')}
    </div>
  `);
}

window._sell = function(id, price) {
  if (!removeFromBag(id, 1)) return;
  player.bells += price;
  showToast(`+${price}💰`);
  openPawn();
};

window._sellAll = function(id, price) {
  const count = player.bag[id] || 0;
  if (!count) return;
  removeFromBag(id, count);
  player.bells += price * count;
  showToast(`+${price * count}💰`);
  openPawn();
};

function openTower() {
  openModal('🗼 观景塔', `
    <p style="font-size:10px;color:#1c1917">登高望远, 一览 M3 Island 全景。</p>
    <div class="modal-stats">
      <div class="stat-box"><b>🌅 ${capitalize(timeOfDay(time.minutes))}</b><span>时间</span></div>
      <div class="stat-box"><b>🌦 ${capitalize(time.weather)}</b><span>天气</span></div>
      <div class="stat-box"><b>📅 ${time.dayOfMonth}</b><span>日期</span></div>
      <div class="stat-box"><b>🌸 ${capitalize(time.season)}</b><span>季节</span></div>
    </div>
    <p style="font-size:10px;color:#1c1917">这里可以看到流星! 在晴朗夜空下偶尔有流星雨事件。</p>
  `);
}

function openKKS() {
  // K.K. Slider concert
  const tod = timeOfDay(time.minutes);
  if (tod === 'night') {
    openModal('🎤 K.K. Slider 演唱会', `
      <p style="font-size:10px;color:#1c1917">🎵 K.K. Slider is playing tonight! 🎵</p>
      <div style="text-align:center;font-size:48px;padding:20px;background:#7c3aed;border-radius:8px;color:#fef3c7">🎵 ♪ ♫ 🎶</div>
      <p style="font-size:10px;color:#1c1917">享受音乐! K.K. 演奏的是 城市流行 (City Pop)。</p>
      <p style="font-size:10px;color:#7c3aed">每周六晚 8:00 准时开演! 欢迎带朋友来听!</p>
      <button onclick="window._kkConcert()" style="margin-top:8px;padding:8px 16px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">享受演出</button>
    `);
  } else {
    openModal('🎤 K.K. 舞台', `
      <p style="font-size:10px;color:#1c1917">K.K. Slider 在每周六晚 8:00 演出。</p>
      <p style="font-size:10px;color:#7c3aed">现在是 ${capitalize(tod)}。晚上再来吧!</p>
    `);
  }
}

window._kkConcert = function() {
  addMiles(500);
  player.rep += 20;
  showBanner('K.K. Slider 演唱会大成功! +500 ✈');
  closeModal();
};

function openCamp() {
  // invite new villager
  openModal('🏕 Campsite — 露营地', `
    <p style="font-size:10px;color:#1c1917">露营地每天都可能来新村民。邀请他们入住你的岛屿吧!</p>
    <div class="modal-grid">
      ${VILLAGER_SPECIES.filter(s => !villagers.find(v => v.id === s.id)).slice(0, 6).map(s => `
        <div class="icon-cell"><span class="ico" style="font-size:32px">${s.emoji}</span><div>${s.name}</div>
          <button onclick="window._inviteVillager('${s.id}')" style="margin-top:4px;padding:2px 6px;font-size:9px;background:#16a34a;color:#fff;border:2px solid #0f172a;border-radius:3px;cursor:pointer">邀请入住</button>
        </div>
      `).join('') || '<p style="font-size:10px;color:#1c1917">所有村民已经入住!</p>'}
    </div>
  `);
}

window._inviteVillager = function(id) {
  const sp = VILLAGER_SPECIES.find(s => s.id === id);
  if (!sp) return;
  if (villagers.length >= 30) { showToast('村民已满 (30)'); return; }
  const v = {
    id: sp.id, name: sp.name, emoji: sp.emoji, color: sp.color,
    wx: 50, wy: 28, x: 50*TILE, y: 28*TILE,
    dir: 'down', frame: 0, frameT: 0,
    wanderT: 30, home: [50, 28], homeBuilding: null,
    friendship: 0,
    personality: ['lazy','jock','peppy','snooty','cranky','normal','smug','uchi'][(Math.random()*8)|0],
    hobby: ['fishing','bug','fossil','music','fashion','gardening'][(Math.random()*6)|0],
  };
  villagers.push(v);
  addMiles(300);
  showBanner(`${sp.name} 已入住你的岛屿!`);
  closeModal();
};

// =====================================================================
// 3.10  ACTION WHEEL OPENERS
// =====================================================================

function openAction(act) {
  if (act === 'phone') openPhone();
  else if (act === 'map') openMap();
  else if (act === 'inventory') openInventory();
  else if (act === 'island') openIslandEval();
  else if (act === 'museum') openMuseum();
  else if (act === 'miles') openMiles();
  else if (act === 'npc') openVillagers();
  else if (act === 'settings') openSettings();
  else if (act === 'terraform') openTerraform();
}

function openPhone() {
  openModal('📱 NookPhone', `
    <p style="font-size:10px;color:#1c1917">欢迎使用 NookPhone!</p>
    <div class="modal-grid">
      <div class="icon-cell" onclick="closeModal();openInventory()"><span class="ico">🎒</span><div>背包</div></div>
      <div class="icon-cell" onclick="closeModal();openMap()"><span class="ico">🗺</span><div>地图</div></div>
      <div class="icon-cell" onclick="closeModal();openIslandEval()"><span class="ico">⭐</span><div>岛屿评级</div></div>
      <div class="icon-cell" onclick="closeModal();openMuseum()"><span class="ico">🏛</span><div>博物馆</div></div>
      <div class="icon-cell" onclick="closeModal();openMiles()"><span class="ico">✈</span><div>Nook Miles+</div></div>
      <div class="icon-cell" onclick="closeModal();openVillagers()"><span class="ico">🐾</span><div>村民</div></div>
      <div class="icon-cell" onclick="closeModal();openTerraform()"><span class="ico">⛰</span><div>Island Designer</div></div>
      <div class="icon-cell" onclick="closeModal();openKKS()"><span class="ico">🎤</span><div>K.K.</div></div>
      <div class="icon-cell" onclick="closeModal();openResident()"><span class="ico">🏛</span><div>服务处</div></div>
    </div>
  `);
}

function openMap() {
  // full-screen minimap of the island
  const cellSize = 6;
  let html = `<div style="display:grid;grid-template-columns:repeat(${WORLD_W},${cellSize}px);grid-auto-rows:${cellSize}px;gap:0;border:2px solid #0f172a;background:#0f172a;width:fit-content;margin:0 auto;max-width:90vw;overflow:auto;max-height:60vh">`;
  for (let y=0; y<WORLD_H; y++) {
    for (let x=0; x<WORLD_W; x++) {
      let color = '#4fa8d8';
      const t = world.terrain[y][x];
      if (t === 'grass' || t === 'grass-dark' || t === 'tilled' || t === 'tilled-water') color = '#7cbe3a';
      else if (t === 'sand') color = '#f6e2a4';
      else if (t === 'path-h' || t === 'path-v' || t === 'path-cross') color = '#e7c87f';
      else if (t === 'asphalt' || t === 'asphalt-cross') color = '#3a3d44';
      else if (t === 'cliff' || t === 'cliff-top') color = '#8b6d4a';
      else if (t === 'bridge-h' || t === 'bridge-v') color = '#a37041';
      if (world.scenery[y][x] && world.scenery[y][x].startsWith('tree')) color = '#2e6e2a';
      if (world.buildings[y][x]) color = '#c84a3a';
      const isPlayer = (x === (player.wx|0) && y === (player.wy|0));
      const isVillager = villagers.find(v => (v.wx|0) === x && (v.wy|0) === y);
      html += `<div style="background:${isPlayer ? '#7c3aed' : isVillager ? '#fb923c' : color};${isPlayer ? 'box-shadow:inset 0 0 0 1px #fef3c7;' : ''}width:${cellSize}px;height:${cellSize}px"></div>`;
    }
  }
  html += `</div>`;
  openModal('🗺 M3 Island 地图', html);
}

function openInventory() {
  const items = Object.keys(player.bag);
  if (items.length === 0) {
    openModal('🎒 背包', `<p style="font-size:10px;color:#1c1917">背包是空的。出去采集吧!</p>`);
    return;
  }
  openModal('🎒 背包', `
    <div class="modal-stats">
      <div class="stat-box"><b>💰 ${player.bells}</b><span>铃钱</span></div>
      <div class="stat-box"><b>🏦 ${player.bank}</b><span>存款</span></div>
      <div class="stat-box"><b>📦 ${Object.values(player.bag).reduce((a,b)=>a+b,0)}</b><span>物品总数</span></div>
      <div class="stat-box"><b>🎒 ${items.length}</b><span>种类</span></div>
    </div>
    <div class="modal-grid">
      ${items.map(id => {
        const it = ITEMS[id];
        if (!it) return '';
        return `<div class="icon-cell">
          <span class="ico">${iconEmoji(id)}</span>
          <div>${it.name}</div>
          <div style="color:#7c3aed">x${player.bag[id]}</div>
          ${it.sell ? `<div style="color:#16a34a;font-size:8px">卖: ${it.sell}💰</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `);
}

function openIslandEval() {
  // calculate island rating
  const trees = (function(){let n=0; for (let y=0;y<WORLD_H;y++) for (let x=0;x<WORLD_W;x++) if (world.scenery[y][x] && world.scenery[y][x].startsWith('tree')) n++; return n;})();
  const flowers = (function(){let n=0; for (let y=0;y<WORLD_H;y++) for (let x=0;x<WORLD_W;x++) if (world.decorations[y][x] && world.decorations[y][x].startsWith('flower')) n++; return n;})();
  const villagersN = villagers.length;
  const catalogTotal = player.catalog.bugs.size + player.catalog.fish.size + player.catalog.fossils.size + player.catalog.art.size;
  const avgFriendship = villagers.length > 0 ? (villagers.reduce((a,v)=>a+v.friendship, 0) / villagers.length) : 0;
  const trash = (function(){let n=0; for (let y=0;y<WORLD_H;y++) for (let x=0;x<WORLD_W;x++) if (world.items[y][x]) n++; return n;})();

  // 5-star formula
  let stars = 1;
  if (trees >= 20 && flowers >= 15) stars = 2;
  if (stars >= 2 && villagersN >= 8) stars = 3;
  if (stars >= 3 && trash === 0) stars = 4;
  if (stars >= 4 && avgFriendship >= 5 && catalogTotal >= 20) stars = 5;
  player.islandStars = stars;

  const detail = `
    <p style="font-size:10px;color:#1c1917">${player.islandName} 评级</p>
    <p class="modal-stars">${'⭐'.repeat(stars)}${'☆'.repeat(5-stars)}</p>
    <div class="modal-stats">
      <div class="stat-box"><b>${trees}</b><span>🌳 树木</span></div>
      <div class="stat-box"><b>${flowers}</b><span>🌸 花卉</span></div>
      <div class="stat-box"><b>${villagersN}/10+</b><span>🐾 村民</span></div>
      <div class="stat-box"><b>${avgFriendship.toFixed(1)}</b><span>💕 友谊</span></div>
    </div>
    <div class="modal-stats">
      <div class="stat-box"><b>${catalogTotal}</b><span>📚 收集</span></div>
      <div class="stat-box"><b>${trash}</b><span>🗑 垃圾</span></div>
      <div class="stat-box"><b>${player.daysPlayed}</b><span>📅 天数</span></div>
      <div class="stat-box"><b>${'⭐'.repeat(stars)}</b><span>当前评级</span></div>
    </div>
    <h3>📋 升级条件</h3>
    <ul style="font-size:10px;color:#1c1917;line-height:1.6;padding-left:20px">
      <li>2⭐: 20 树 + 15 花 ${trees >= 20 && flowers >= 15 ? '✅' : '⏳'}</li>
      <li>3⭐: 8 村民 ${villagersN >= 8 ? '✅' : '⏳'}</li>
      <li>4⭐: 无垃圾 ${trash === 0 ? '✅' : '⏳'}</li>
      <li>5⭐: 平均友谊 5+ + 收集 20+ ${avgFriendship >= 5 && catalogTotal >= 20 ? '✅' : '⏳'}</li>
    </ul>
  `;
  openModal('⭐ 岛屿评级 — Isabelle 的报告', detail);
}

function openMiles() {
  const totalMissions = Object.keys(QUESTS).length;
  const completedMissions = Object.keys(questState).filter(k => k.endsWith('-done')).length;
  const progress = Math.min(1, completedMissions / totalMissions);
  const tier = MILES_TIERS.find(t => completedMissions < t.threshold) || MILES_TIERS[MILES_TIERS.length-1];
  const nextTier = MILES_TIERS.find(t => t.threshold > completedMissions);

  openModal('✈ Nook Miles+ 里程', `
    <p style="font-size:10px;color:#1c1917">你完成了 <b>${completedMissions}/${totalMissions}</b> 任务</p>
    <div class="modal-stats">
      <div class="stat-box"><b>${player.miles}</b><span>当前里程</span></div>
      <div class="stat-box"><b>${tier.badge} ${tier.name}</b><span>当前等级</span></div>
      <div class="stat-box"><b>${nextTier ? nextTier.threshold - completedMissions : '✓'}</b><span>到下一级</span></div>
      <div class="stat-box"><b>${MILES_TIERS.length}</b><span>总等级</span></div>
    </div>
    <h3>📋 所有任务</h3>
    <ul style="font-size:10px;color:#1c1917;line-height:1.6;padding-left:20px;max-height:300px;overflow-y:auto">
      ${QUESTS.map(q => {
        const done = questState[q.id + '-done'];
        return `<li>${done ? '✅' : '⏳'} <b>${q.title}</b>: ${q.desc} — ${q.reward.miles || 0}✈</li>`;
      }).join('')}
    </ul>
  `);
}

function openVillagers() {
  openModal('🐾 村民列表', `
    <p style="font-size:10px;color:#1c1917">${villagers.length} 位村民住在你的岛上。</p>
    <div class="modal-grid">
      ${villagers.map(v => `
        <div class="icon-cell ${v.friendship >= 5 ? 'collected' : ''}">
          <span class="ico" style="font-size:32px">${v.emoji}</span>
          <div>${v.name}</div>
          <div style="color:#7c3aed;font-size:9px">${v.personality}</div>
          <div style="color:#fb923c;font-size:9px">${'❤️'.repeat(Math.min(5, v.friendship))}${'🤍'.repeat(Math.max(0, 5-v.friendship))}</div>
        </div>
      `).join('')}
    </div>
  `);
}

function openSettings() {
  openModal('⚙ 设置', `
    <p style="font-size:10px;color:#1c1917">游戏设置</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
      <button onclick="closeModal();saveGame();showToast('已保存')" style="padding:8px;background:#16a34a;color:#fff;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">💾 保存</button>
      <button onclick="closeModal();if(confirm('确定重置?')){localStorage.removeItem('m3_save_v4');location.reload()}" style="padding:8px;background:#dc2626;color:#fff;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">🗑 重置</button>
      <button onclick="closeModal()" style="padding:8px;background:#7c3aed;color:#fef3c7;border:2px solid #0f172a;border-radius:4px;cursor:pointer;font-family:inherit">✖ 关闭</button>
    </div>
    <h3 style="margin-top:16px">🎮 操作</h3>
    <ul style="font-size:10px;color:#1c1917;line-height:1.6;padding-left:20px">
      <li>WASD / 方向键 · 移动</li>
      <li>E / Space · 互动</li>
      <li>B · 跑 / 走</li>
      <li>X · 使用物品</li>
      <li>R · 摇树</li>
      <li>L · 挖掘</li>
      <li>1-8 · 选工具</li>
      <li>I · 背包 · M · 地图 · Y · 手机</li>
      <li>J · 博物馆 · N · 里程 · K · 村民</li>
      <li>Tab · 岛屿评级 · Esc · 设置</li>
    </ul>
  `);
}

function openModal(title, body) {
  modalOpen = true;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  modalOpen = false;
  document.getElementById('modal').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// action wheel buttons
document.querySelectorAll('.action-wheel button').forEach(b => {
  b.addEventListener('click', () => openAction(b.dataset.action));
});

// =====================================================================
// 3.11  WANTED / CRIME (GTA flavor)
// =====================================================================

function bumpWanted() { player.wanted = Math.min(5, player.wanted + 1); updateWantedStars(); }
function updateWantedStars() {
  const ws = document.getElementById('wanted-stars');
  if (!ws) return;
  ws.innerHTML = '';
  for (let i=0; i<5; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (i < player.wanted ? ' on' : '');
    s.textContent = '★';
    ws.appendChild(s);
  }
}

// =====================================================================
// 3.12  SAVE / LOAD
// =====================================================================

function saveGame() {
  const data = {
    v: 4.1,  // v4.1 = added terraforming (elevation, path, ramp)
    player: {
      wx: player.wx, wy: player.wy,
      bells: player.bells, bank: player.bank, miles: player.miles,
      rep: player.rep, islandName: player.islandName, islandStars: player.islandStars,
      bag: player.bag, catalog: {bugs: [...player.catalog.bugs], fish: [...player.catalog.fish], fossils: [...player.catalog.fossils], art: [...player.catalog.art]},
      daysPlayed: player.daysPlayed, wanted: player.wanted, tool: player.tool,
      terraformMode: player.terraformMode, terraformTool: player.terraformTool,
      terraformPathStyle: player.terraformPathStyle,
      terraformUnlocked: player.terraformUnlocked,
    },
    time: {minutes: time.minutes, weather: time.weather, dayOfMonth: time.dayOfMonth, month: time.month, year: time.year, season: time.season},
    world: {
      terrain: world.terrain,
      buildings: world.buildings,
      items: world.items,
      crops: world.crops,
      scenery: world.scenery,
      decorations: world.decorations,
      elevation: world.elevation,
      path: world.path,
      ramp: world.ramp,
    },
    villagers: villagers.map(v => ({id:v.id, name:v.name, emoji:v.emoji, color:v.color, wx:v.wx, wy:v.wy, home:v.home, friendship:v.friendship, personality:v.personality, hobby:v.hobby})),
    quests: questState,
  };
  try { localStorage.setItem('m3_save_v4', JSON.stringify(data)); } catch(e) { console.warn('save failed', e); }
}

function loadGame() {
  try {
    const raw = localStorage.getItem('m3_save_v4');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== 4) return false;
    Object.assign(player, data.player);
    player.catalog.bugs = new Set(data.player.catalog.bugs);
    player.catalog.fish = new Set(data.player.catalog.fish);
    player.catalog.fossils = new Set(data.player.catalog.fossils);
    player.catalog.art = new Set(data.player.catalog.art);
    Object.assign(time, data.time);
    Object.assign(world, data.world);
    Object.assign(questState, data.quests);
    villagers.length = 0;
    (data.villagers || []).forEach(v => {
      villagers.push(Object.assign({}, v, {x: v.wx * TILE, y: v.wy * TILE, dir:'down', frame:0, frameT:0, wanderT:30}));
    });
    return true;
  } catch(e) { console.warn('load failed', e); return false; }
}

// =====================================================================
// 3.13  VILLAGER AI
// =====================================================================

function updateVillagers(dt) {
  for (const v of villagers) {
    // hit-cooldown countdown
    if (v.cooldownHit !== undefined) {
      v.cooldownHit -= dt;
      if (v.cooldownHit <= 0) delete v.cooldownHit;
    }
    // knocked timer (pause wander)
    if (v.knockedT && v.knockedT > 0) {
      v.knockedT -= dt;
      v.frame = 0;  // idle
      v.x = v.wx * TILE + TILE/2;
      v.y = v.wy * TILE + TILE/2;
      continue;  // skip wander while knocked
    }
    v.wanderT -= dt;
    if (v.wanderT <= 0) {
      // pick random direction
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const d = dirs[(Math.random()*4)|0];
      v.wx += d[0] * 0.5;
      v.wy += d[1] * 0.5;
      if (d[0] > 0) v.dir = 'right';
      else if (d[0] < 0) v.dir = 'left';
      else if (d[1] > 0) v.dir = 'down';
      else v.dir = 'up';
      v.wanderT = 2 + Math.random() * 4;
    }
    // GTA-style: if wanted >= 3, the SPECIFIC species=dog (sheriff hat) chases the player
    if (player.wanted >= 3 && v.ref.id === 'dog') {
      const dx = player.wx - v.wx;
      const dy = player.wy - v.wy;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d > 0.3) {
        v.wx += (dx/d) * 0.4;  // chase
        v.wy += (dy/d) * 0.4;
        if (Math.abs(dx) > Math.abs(dy)) v.dir = dx > 0 ? 'right' : 'left';
        else v.dir = dy > 0 ? 'down' : 'up';
      } else if (d < 0.7 && v.cooldownArrest === undefined) {
        // catch player
        v.cooldownArrest = 3;
        // arrest! reset wanted, fine 500 bells
        const fine = 500 * player.wanted;
        if (player.bells >= fine) player.bells -= fine; else player.bells = 0;
        player.wanted = 0;
        // teleport player home
        player.wx = 32.5; player.wy = 32.5;
        showToast('🚔 被捕！罚款 ' + fine + ' Bells，押回广场');
      }
    }
    // arrest cooldown
    if (v.cooldownArrest !== undefined) {
      v.cooldownArrest -= dt;
      if (v.cooldownArrest <= 0) delete v.cooldownArrest;
    }
    // bounds
    v.wx = clamp(v.wx, 8, 56);
    v.wy = clamp(v.wy, 8, 56);
    v.x = v.wx * TILE + TILE/2;
    v.y = v.wy * TILE + TILE/2;
    v.frameT += dt * 6;
    if (v.frameT > 0.2) { v.frameT = 0; v.frame = (v.frame + 1) % 4; }
  }
}

// (ram detection is inline in updatePlayer — no separate helper needed)

// =====================================================================
// SECTION 4 · RENDERING
// =====================================================================
// Frame loop:
//   1. clear → sky color (from time of day)
//   2. draw ground tiles (sorted by depth)
//   3. draw buildings/props (with shadows)
//   4. draw characters (player, villagers) with shadows
//   5. draw particles
//   6. draw UI overlay (DOM)
// =====================================================================

function render() {
  // 1. set viewport to full canvas (in case resize happened)
  gl.viewport(0, 0, canvas.width, canvas.height);
  // 2. clear
  const dc = dayColor(time.minutes);
  const skyHex = dc.skyHex;
  // parse hex to RGB
  const r = parseInt(skyHex.substr(1,2), 16) / 255;
  const g = parseInt(skyHex.substr(3,2), 16) / 255;
  const b = parseInt(skyHex.substr(5,2), 16) / 255;
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // 2. set uniforms
  flushAtlas();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, vdata, gl.DYNAMIC_DRAW);
  // enable attributes
  const stride = FLOATS_PER_VERT * 4;
  gl.enableVertexAttribArray(aPos);   gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aUv);    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(aLayer); gl.vertexAttribPointer(aLayer, 1, gl.FLOAT, false, stride, 16);
  gl.enableVertexAttribArray(aLit);   gl.vertexAttribPointer(aLit, 1, gl.FLOAT, false, stride, 20);
  gl.enableVertexAttribArray(aAlpha); gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(aTint);  gl.vertexAttribPointer(aTint, 3, gl.FLOAT, false, stride, 28);
  gl.enableVertexAttribArray(aGlow);  gl.vertexAttribPointer(aGlow, 1, gl.FLOAT, false, stride, 40);
  gl.uniform1i(uTex, 0);
  gl.uniform1f(uTime, performance.now() / 1000);
  gl.uniform1f(uSunLevel, dc.sunLevel);
  gl.uniform3f(uSunColor, dc.sunCol[0], dc.sunCol[1], dc.sunCol[2]);
  gl.uniform3f(uAmbColor, dc.ambCol[0], dc.ambCol[1], dc.ambCol[2]);
  gl.uniform3f(uFogColor, dc.fogCol[0], dc.fogCol[1], dc.fogCol[2]);
  gl.uniform1f(uPhase, (time.minutes % 360) / 360);

  // build draw list
  clearDrawList();
  vHead = 0;

  // camera shake (applied to render output, not cam.x)
  let shakeX = 0, shakeY = 0;
  if (cam.shake > 0) {
    shakeX = (Math.random() - 0.5) * cam.shake * 2;
    shakeY = (Math.random() - 0.5) * cam.shake * 2;
  }

  // compute visible tile range (in world tile units, account for axonometric scale)
  // tile width on screen = TILE_W; tile height = TILE_H
  // worst case: half-width / TILE_W/2 tiles in each direction
  const minWx = Math.max(0, Math.floor(cam.x - VW / TILE_W) - 2);
  const maxWx = Math.min(WORLD_W-1, Math.ceil(cam.x + VW / TILE_W) + 2);
  const minWy = Math.max(0, Math.floor(cam.y - VH / TILE_H) - 2);
  const maxWy = Math.min(WORLD_H-1, Math.ceil(cam.y + VH / TILE_H) + 2);

  // 2. ground tiles (layer 0)
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const t = world.terrain[y][x];
      if (!t || t === 'void') continue;
      // water is animated via 3 frames
      let cellName = t;
      if (t === 'water') cellName = `water-${(performance.now()/200|0) % 3}`;
      const cell = cells[cellName];
      if (!cell) continue;
      // compute lit (sunlight from above, dimmer for water)
      const isWater = t.startsWith('water');
      const lit = isWater ? 0.7 : 1.0;
      // fog: distance from camera
      const d = Math.hypot(x - player.wx, y - player.wy);
      const fog = clamp((d - 12) * 0.04, 0, 0.7);
      gl.uniform1f(uFog, fog);
      // elevation: draw raised tiles higher on screen
      const elev = world.elevation[y][x] || 0;
      drawTileAt(cell, x + 0.5, y + 0.5, TILE, isWater ? 2 : 0, lit, 0, elev * ELEVATION_PX);
      // path overlay (if path style set, render on top of grass/sand)
      if (!isWater && world.path[y][x]) {
        const pathCell = cells[world.path[y][x]];
        if (pathCell) {
          drawTileAt(pathCell, x + 0.5, y + 0.5, TILE, 0.5, lit, 0, elev * ELEVATION_PX);
        }
      }
      // cliff side faces (visible on south + east borders of elevated tiles)
      if (elev > 0 && !isWater) {
        const cliffCell = cells['cliff'];
        const cliffTopCell = cells['cliff-top'];
        if (cliffCell) {
          const myElev = elev;
          // south face: a tile to my south with lower elevation → I show cliff facing south
          const southElev = (inBounds(x, y+1) ? (world.elevation[y+1][x] || 0) : 0);
          const eastElev  = (inBounds(x+1, y) ? (world.elevation[y][x+1] || 0) : 0);
          if (southElev < myElev) {
            // draw a vertical face facing south (below my tile, height = elevation step)
            const p = project(x + 0.5, y + 0.5, 0);
            const sz = TILE;
            // place the face below the tile, top edge aligned with bottom of elevated tile
            drawSprite(cliffCell,
              p.sx - sz/2 * p.scale,
              p.sy + sz/2 * p.scale - (elev * ELEVATION_PX) * p.scale,
              sz * p.scale, (elev * ELEVATION_PX) * p.scale,
              0.4, lit * 0.7, 1, 1, 1, 1, 0);
          }
          if (eastElev < myElev) {
            // east-facing face (parallelogram-ish, drawn as a small strip on the east)
            const p = project(x + 0.5, y + 0.5, 0);
            const sz = TILE;
            // approximate with a tilted strip — use a square clipped by elevation
            drawSprite(cliffCell,
              p.sx + sz/4 * p.scale,
              p.sy - (elev * ELEVATION_PX) * p.scale * 0.3,
              sz/2 * p.scale, (elev * ELEVATION_PX) * p.scale,
              0.45, lit * 0.6, 1, 1, 1, 1, 0);
          }
        }
      }
    }
  }
  gl.uniform1f(uFog, 0);

  // 3. scenery (trees, rocks, etc) — layer 1 with shadows + wind sway
  // Wind: a global phase that loops every few seconds; per-tree phase offset for variation.
  const windT = performance.now() * 0.001;
  // Sun direction in screen pixels (for cast shadows)
  const sunDx = dc.sunDir.x, sunDy = dc.sunDir.y;
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const s = world.scenery[y][x];
      if (!s) continue;
      const cell = cells[s];
      if (!cell) continue;
      // wind: only trees sway, rocks don't
      let windDx = 0, windDy = 0;
      if (s.startsWith('tree')) {
        const phase = (x * 1.7 + y * 2.3 + s.length);
        windDx = Math.sin(windT * 1.6 + phase) * 1.2;  // horizontal sway
        windDy = Math.cos(windT * 2.4 + phase * 0.7) * 0.6;  // tiny vertical bob
      }
      // shadow first — also swayed a bit (shadow moves less than tree top)
      if (s.startsWith('tree') || s === 'rock' || s === 'rock-gold') {
        const shadowCell = cells['shadow'];
        const p = project(x + 0.5, y + 0.5, 0);
        const shOff = 6;
        // tree shadow also tilts in the wind direction (very subtle)
        // AND in the sun direction (longer shadows at low sun)
        const shDx = (s.startsWith('tree') ? windDx * 0.5 : 0) + dc.sunDir.x;
        const shDy = dc.sunDir.y;
        drawSprite(shadowCell,
          p.sx - 16 * p.scale + shDx,
          p.sy - 4 * p.scale + shOff + shDy,
          32 * p.scale, 16 * p.scale, 0, 0.5, 0.4);
      }
      // lit (1.0 for normal, dim for night)
      const lit = dc.sunLevel;
      const elev = world.elevation[y][x] || 0;
      // Tree gets drawn with the wind offset. The tree sprite is 32x32 covering
      // the trunk and crown. The wind shift will look like the crown swinging
      // while the trunk (anchored at the bottom) stays put.
      const pTree = project(x + 0.5, y + 0.5, 0);
      const sz = TILE;
      drawSprite(cell,
        pTree.sx - sz/2 * pTree.scale + windDx * pTree.scale,
        pTree.sy - sz/2 * pTree.scale + windDy * pTree.scale - elev * ELEVATION_PX * pTree.scale,
        sz * pTree.scale, sz * pTree.scale, 1, lit, 1, 1, 1, 1, 0);
    }
  }

  // 3b. decorations (flowers, tall grass) — layer 1, with wind sway
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const d = world.decorations[y][x];
      if (!d) continue;
      const cell = cells[d];
      if (!cell) continue;
      // flowers and grass sway with the wind (smaller amplitude than trees)
      let dWindDx = 0;
      if (d.startsWith('flower') || d === 'tall-grass') {
        const phase = (x * 2.1 + y * 1.3 + d.length * 0.7);
        dWindDx = Math.sin(windT * 1.9 + phase) * 0.7;
      }
      const elev = world.elevation[y][x] || 0;
      const pD = project(x + 0.5, y + 0.5, 0);
      const sz = TILE;
      drawSprite(cell,
        pD.sx - sz/2 * pD.scale + dWindDx * pD.scale,
        pD.sy - sz/2 * pD.scale - elev * ELEVATION_PX * pD.scale,
        sz * pD.scale, sz * pD.scale, 1, dc.sunLevel, 1, 1, 1, 1, 0);
    }
  }

  // 3c. buildings (3D-extruded, 32x48 cells with wall face visible below roof)
  // Sun direction in screen space (projected): for HD-2D, sun comes from upper-left
  // so shadows fall to lower-right. shadowDir = (1, 1) in (sx, sy) units.
  const sunSx = 6, sunSy = 4;  // shadow offset in pixels (low sun = long shadow)
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const b = world.buildings[y][x];
      if (!b) continue;
      const cell = cells[b];
      if (!cell) continue;
      const elev = world.elevation[y][x] || 0;
      // Ground-level base: project at the actual building base (slight elevation)
      const pBase = project(x + 0.5, y + 0.5, 0);
      // 3D extrusion height — how many pixels the building pokes up
      // 32x48 cell is 1.5x the normal TILE_H, so we render at TILE_W × 1.5*TILE_H
      const extrude = 32;  // additional height in screen pixels above the tile
      const cellH = cell.h;  // 48 for buildings, 32 for others
      const sz = TILE;
      const lit = dc.sunLevel;
      const glow = (b === 'house-mayor' || b === 'shop' || b === 'nooks' || b === 'bank' || b === 'pawn' || b === 'museum' || b === 'tower' || b === 'kks' || b === 'resident') ? 1 : 0;

      // 1. Cast shadow on ground (skewed to the south-east for sun-from-north-west)
      const shadowCell = cells['shadow'];
      if (shadowCell) {
        drawSprite(shadowCell,
          pBase.sx - sz/2 * pBase.scale + sunSx,
          pBase.sy - sz/2 * pBase.scale + sunSy + 8,
          sz * pBase.scale * 1.4, sz * pBase.scale * 0.6,
          3, 0.35, 0.3);
      }

      // 2. The whole 32x48 building sprite is drawn at the tile center, raised by extrude
      // tall: 1.5x the normal TILE_H = 48 screen pixels
      // y_offset: shifts sprite up by (extrude + elev)
      const totalH = sz * 1.5;  // 96 px tall on screen for 32x48 cell
      const sy = pBase.sy - totalH / 2 * pBase.scale - extrude * pBase.scale - elev * ELEVATION_PX * pBase.scale;
      const sx = pBase.sx - sz / 2 * pBase.scale;
      drawSprite(cell,
        sx, sy,
        sz * pBase.scale, totalH * pBase.scale,
        3, lit, 1, 1, 1, 1, glow);
    }
  }

  // 3d. crops
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const c = world.crops[y][x];
      if (!c) continue;
      const cell = cells[`crop-${c.stage}`];
      if (!cell) continue;
      const elev = world.elevation[y][x] || 0;
      drawTileAt(cell, x + 0.5, y + 0.5, TILE, 1, dc.sunLevel, 0, elev * ELEVATION_PX);
    }
  }

  // 3e. items on ground
  for (let y=minWy; y<=maxWy; y++) {
    for (let x=minWx; x<=maxWx; x++) {
      const it = world.items[y][x];
      if (!it) continue;
      // small icon at this position
      const itemDef = ITEMS[it.id];
      if (!itemDef) continue;
      const cell = cells[itemDef.icon];
      if (!cell) continue;
      const p = project(x + 0.5, y + 0.5, 0);
      const sz = 24;
      const elev = world.elevation[y][x] || 0;
      drawSprite(cell, p.sx - sz/2 * p.scale, p.sy - sz/2 * p.scale - 8 - elev * ELEVATION_PX * p.scale, sz * p.scale, sz * p.scale, 1, dc.sunLevel, 1, 1, 1, 1, 0);
    }
  }

  // 4. characters (player + villagers) — layer 4 (top)
  // Sort by wy so far tiles render behind near tiles
  const charList = [];
  charList.push({wx: player.wx, wy: player.wy, x: player.x, y: player.y, type: 'player', ref: player});
  for (const v of villagers) {
    charList.push({wx: v.wx, wy: v.wy, x: v.x, y: v.y, type: 'villager', ref: v});
  }
  charList.sort((a, b) => a.wy - b.wy);

  for (const c of charList) {
    const p = project(c.wx, c.wy, 0);
    // shadow
    const shadowCell = cells['shadow'];
    drawSprite(shadowCell, p.sx - 12 * p.scale, p.sy + 16 * p.scale, 24 * p.scale, 12 * p.scale, 0, 0.5, 0.4);
    // char sprite
    let species, frame;
    if (c.type === 'player') {
      species = 'm3';
      frame = player.frame;
    } else {
      species = c.ref.id;
      frame = c.ref.frame;
    }
    const cell = cells[`${species}-${c.ref.dir}-${frame}`];
    if (!cell) continue;
    // bob
    const bob = c.type === 'player' ? Math.sin(player.bobT) * 1.5 : 0;
    const sz = 64;
    // elevation offset: characters on raised tiles render higher
    const tx = c.wx|0, ty = c.wy|0;
    const elev = (inBounds(tx, ty) ? (world.elevation[ty][tx] || 0) : 0);
    drawSprite(cell, p.sx - sz/2 * p.scale, p.sy - sz/2 * p.scale - 32 * p.scale - bob - elev * ELEVATION_PX * p.scale, sz * p.scale, sz * p.scale, 4, dc.sunLevel, 1, 1, 1, 1, 0);
  }

  // 5. particles
  drawParticles(performance.now() / 1000);

  // 5b. weather / season particle emitters
  if (time.weather === 'rainy' || time.weather === 'storm') {
    if (Math.random() < 0.5) {
      const wx = cam.x + (Math.random() - 0.5) * 30;
      const wy = cam.y + (Math.random() - 0.5) * 20;
      spawnParticle('rain', wx, wy, {vy: 8, vx: -0.5, life: 30});
    }
  }
  if (time.season === 'winter' && Math.random() < 0.3) {
    const wx = cam.x + (Math.random() - 0.5) * 30;
    const wy = cam.y + (Math.random() - 0.5) * 20;
    spawnParticle('snow', wx, wy, {vy: 0.5, vx: -0.2, life: 80});
  }
  if (timeOfDay(time.minutes) === 'night' && Math.random() < 0.1) {
    const wx = cam.x + (Math.random() - 0.5) * 30;
    const wy = cam.y + (Math.random() - 0.5) * 20;
    spawnParticle('firefly', wx, wy, {vy: -0.2, vx: (Math.random()-0.5)*0.3, life: 100});
  }
  if (time.season === 'spring' && Math.random() < 0.1) {
    const wx = cam.x + (Math.random() - 0.5) * 30;
    const wy = cam.y + (Math.random() - 0.5) * 20;
    spawnParticle('cherry', wx, wy, {vy: 0.3, vx: (Math.random()-0.5)*0.4, life: 100});
  }
  if (time.season === 'autumn' && Math.random() < 0.1) {
    const wx = cam.x + (Math.random() - 0.5) * 30;
    const wy = cam.y + (Math.random() - 0.5) * 20;
    spawnParticle('leaf', wx, wy, {vy: 0.2, vx: (Math.random()-0.5)*0.5, life: 80});
  }
  // 6. flush
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, vdata.subarray(0, vHead * FLOATS_PER_VERT));
  gl.drawArrays(gl.TRIANGLES, 0, vHead);
}

// =====================================================================
// 4.x  UI UPDATES
// =====================================================================

function showToast(msg) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function showBanner(msg) {
  const b = document.getElementById('banner');
  if (!b) return;
  b.textContent = msg;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 3000);
}

function updateHUD() {
  document.getElementById('hud-bells').textContent = player.bells.toLocaleString();
  document.getElementById('hud-bank').textContent = player.bank.toLocaleString();
  document.getElementById('hud-miles').textContent = player.miles.toLocaleString();
  document.getElementById('hud-rep').textContent = '⭐';
  document.getElementById('hud-island-stars').textContent = '⭐'.repeat(player.islandStars) + '☆'.repeat(5 - player.islandStars);
  document.getElementById('hud-island-name').textContent = player.islandName;
  // weather
  const wc = {sunny:'☀️',cloudy:'☁️',rainy:'🌧',storm:'⛈'};
  document.getElementById('weather-ico').textContent = wc[time.weather] || '☀️';
  document.getElementById('hud-weather').textContent = capitalize(time.weather);
  // time
  const h = ((time.minutes / 60) | 0);
  const m = ((time.minutes % 60) | 0);
  document.getElementById('hud-time').textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
  document.getElementById('hud-date').textContent = `Day ${time.dayOfMonth} · ${capitalize(time.season)}`;
}

// =====================================================================
// 5.x  BOOT
// =====================================================================

function boot() {
  buildAllSprites();
  flushAtlas();
  generateIsland();
  initVillagers();
  placeShopPlaza();
  // initial inventory
  if (Object.keys(player.bag).length === 0) {
    addToBag('shovel', 1);
    addToBag('rod', 1);
    addToBag('fruit-apple', 5);
    addToBag('branch', 10);
    addToBag('stone', 5);
  }
  // give each villager a home
  villagers.forEach((v, i) => {
    v.home = [12 + (i % 10) * 4, 16 + ((i / 10)|0) * 8];
    v.wx = v.home[0] + 0.5;
    v.wy = v.home[1] + 0.5;
    v.x = v.wx * TILE;
    v.y = v.wy * TILE;
  });
  renderHotbar();
  updateHUD();
  updateWantedStars();

  // detect existing save
  const hasSave = !!localStorage.getItem('m3_save_v4');
  document.getElementById('load-game').classList.toggle('hidden', !hasSave);
  document.getElementById('resume').classList.toggle('hidden', !hasSave);

  // boot tip — change based on whether we have a save
  const tip = document.getElementById('load-tip');
  tip.textContent = hasSave
    ? '按 Enter / 点击屏幕 继续游戏'
    : '按 Enter / 点击屏幕 开始新游戏';

  // Make the loading screen itself clickable / keyable
  const startGame = (loadSaved) => {
    if (loadSaved) {
      if (!loadGame()) { showToast('载入失败，新开'); loadSaved = false; }
    }
    document.getElementById('loading').classList.add('hide');
    document.getElementById('title').classList.add('hidden');
    cam.x = player.wx;
    cam.y = player.wy;
    showBanner(loadSaved ? '欢迎回到 M3 Island!' : '欢迎来到 M3 Island!');
    startLoop();
  };
  // Title-screen buttons
  document.getElementById('new-game').addEventListener('click', () => startGame(false));
  document.getElementById('load-game').addEventListener('click', () => startGame(true));
  document.getElementById('how-to').addEventListener('click', () => openAction('settings'));
  document.getElementById('resume').addEventListener('click', () => startGame(true));

  // Loading-screen click + Enter / Space
  const loadingEl = document.getElementById('loading');
  loadingEl.style.cursor = 'pointer';
  loadingEl.addEventListener('click', () => startGame(hasSave));
  document.addEventListener('keydown', (e) => {
    // Only intercept Enter/Space while the title or loading is still showing
    if (document.getElementById('loading').classList.contains('hide')) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      startGame(hasSave);
    }
  });
}

let lastTime = 0;
let loopStarted = false;
function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!modalOpen && !dialogueOpen && document.getElementById('title').classList.contains('hidden')) {
    updatePlayer(dt);
    updateVillagers(dt);
    advanceTime(dt);
    updateCrops();
  }
  updateParticles();
  render();
  updateHUD();
  requestAnimationFrame(loop);
}

// auto-save every 30s
setInterval(() => {
  if (loopStarted) saveGame();
}, 30000);

// boot the game
boot();

})();
