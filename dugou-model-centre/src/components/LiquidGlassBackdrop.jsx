import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ComposedGlassScene from './ComposedGlassScene'
import { isComposedGlassStyle } from '../design/liquidGlassThemes'

/* ── LIQUID_PARAMS：全部调色与行为参数集中在此，微调只改这里 ──
 * 颜色用 hex，运行时转 [r,g,b]（0-1）。
 * c1..c5        流体基色（n / swirl 由低到高依次混入），浅色主题下都是白底上的淡色晕染
 * glowColor1..3 鼠标辉光渐变色（近→远：glowColor1 最近）
 * glowIntensity 鼠标辉光强度（0 关闭）
 * scale         流体噪声空间缩放（越大纹理越碎）
 * offset        噪声采样偏移（平移整个流体图案）
 * timeScale     时间流速倍率
 * distortBoost  鼠标对流体的扭曲位移强度
 * swirlBoost    鼠标旋涡强度
 * mouseRadius   flowmap 笔刷半径（归一化屏幕坐标）
 * mouseStrength flowmap 笔刷强度
 * decay         flowmap 每帧衰减（越接近 1 拖尾越长）
 * lightPos      光源位置（uv 坐标，y 向上）
 * lightCore     光源核心暖色强度
 * lightHalo     光源外围冷色光晕强度
 * vignette      边缘暗角强度（0 无暗角）
 * bloom*        高亮泛光：阈值 / 过渡宽度 / 强度
 */
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const LIQUID_PARAMS = {
  c1: hexToRgb('#dde6f3'), // 冷白基底
  c2: hexToRgb('#5ea8f5'), // 蓝
  c3: hexToRgb('#f5a94f'), // 琥珀
  c4: hexToRgb('#9d86f2'), // 紫罗兰
  c5: hexToRgb('#46cdA6'), // 青碧
  glowColor1: hexToRgb('#ffffff'),
  glowColor2: hexToRgb('#7fb2ff'),
  glowColor3: hexToRgb('#ffb35c'),
  glowIntensity: 0.95,
  scale: 1.9,
  offset: [0, 0],
  timeScale: 1.35,
  distortBoost: 1.5,
  swirlBoost: 1.5,
  mouseRadius: 0.22,
  mouseStrength: 0.85,
  decay: 0.972,
  lightPos: [0.75, 0.8],
  lightCore: 0.06,
  lightHalo: 0.035,
  vignette: 0.1,
  bloomThreshold: 0.93,
  bloomRange: 0.08,
  bloomStrength: 0.2,
}

const MAX_DPR = 1.5
const FLOWMAP_SCALE = 0.25 // flowmap 渲染分辨率为画布的 1/4
const FRAME_MS = 1000 / 30 // 30fps 节流
const REDUCED_MOTION_TIME = 12 // prefers-reduced-motion 时只渲染这一帧静态画面

/* ── 旗舰主题的性能纪律（视觉规格不变）──
 * 旗舰的环境动效周期是 20~300s 级的"呼吸"，30fps 是纯浪费：
 *   · 待机 12fps，鼠标移动 / 滚动后 1.6s 内升回 30fps（交互永远满帧）
 *   · 画布按 0.75 倍分辨率渲染（背景本质是柔光渐变场，肉眼无差）
 * 这两项把「面片数 × 帧率 × 面积」的合成税降掉约 5-8 倍。
 */
const FLAGSHIP_IDLE_FRAME_MS = 1000 / 12
const FLAGSHIP_INTERACTIVE_WINDOW_MS = 1600
const FLAGSHIP_DPR_CAP = 1.2
const FLAGSHIP_RES_SCALE = 0.75

/* ── 红果（构图化色场）参数：品牌色对 青 × 橙 ──
 * 额外字段：sat 全局饱和度 / calmR+calmA 中央静区 / breath 呼吸幅度 / roam 环游幅度
 * 画布以视口 89% 内部分辨率渲染（CSS 拉伸），兼顾细腻与开销
 */
const HONGGUO_SCALE = 0.89
const HONGGUO_PARAMS = {
  c1: hexToRgb('#f4f7f8'), // 净白底
  c2: hexToRgb('#38bdb4'), // 品牌主色 · 青（大面积主调）
  c3: hexToRgb('#f28a4b'), // 品牌副色 · 橙（兴奋点）
  c4: hexToRgb('#a6ded8'), // 浅青
  c5: hexToRgb('#e9c98f'), // 香槟金（暖色过渡）
  glowColor1: hexToRgb('#ffffff'),
  glowColor2: hexToRgb('#8fd8d2'),
  glowColor3: hexToRgb('#f2b98a'),
  glowIntensity: 0.7,
  scale: 1.35,
  offset: [0, 0],
  timeScale: 0.8,
  distortBoost: 1.15,
  swirlBoost: 1.1,
  mouseRadius: 0.22,
  mouseStrength: 0.85,
  decay: 0.972,
  lightPos: [0.78, 0.82],
  lightCore: 0.05,
  lightHalo: 0.035,
  vignette: 0.1,
  sat: 0.96,
  calmR: 0.34,
  calmA: 0.22,
  breath: 0.55,
  roam: 1.0,
}

/* ── 旗舰深色三主题（璇玑 / 光谱 / 牵星）参数 ──
 * 共用同一支 MAIN_FRAG_SRC_FLAGSHIP，差异全部由 uniform 驱动：
 * base/baseB     深底垂直渐变（base=顶，baseB=底）
 * glowA/glowB    两团漂移辉光：颜色 / 位置（uv，y 向上）/ 衰减指数 / 强度
 * beam           对角光束 + 色散边强度（光谱）
 * rings          同心刻度环强度（璇玑）；ringColor / ringPos
 * stars          星场密度（牵星）
 * grain          胶片颗粒（深色渐变去色带）
 */
/* 旗舰 shader 不消费、但 renderFrame 会无条件读取的公共字段（c1..c5 必须存在：uniform3fv 对 undefined 直接抛错，null location 也救不了） */
const FLAGSHIP_DEFAULTS = {
  scale: 1, offset: [0, 0], lightPos: [0.78, 0.82], lightCore: 0, lightHalo: 0,
  c1: hexToRgb('#000000'), c2: hexToRgb('#000000'), c3: hexToRgb('#000000'), c4: hexToRgb('#000000'), c5: hexToRgb('#000000'),
}

const FLAGSHIP_PARAMS = {
  xuanji: {
    flagship: true, ...FLAGSHIP_DEFAULTS,
    base: hexToRgb('#0d1713'), baseB: hexToRgb('#060d0a'),
    glowA: hexToRgb('#e8dfc8'), glowAPos: [0.78, 0.86], glowAR: 2.4, glowAAmp: 0.16,
    glowB: hexToRgb('#3f6b58'), glowBPos: [0.14, 0.08], glowBR: 2.0, glowBAmp: 0.5,
    beam: 0, beamColor: hexToRgb('#a8c4ff'),
    rings: 0.42, ringColor: hexToRgb('#c9a96a'), ringPos: [0.84, 0.88],
    stars: 0,
    glowColor1: hexToRgb('#ffffff'), glowColor2: hexToRgb('#bfe3d2'), glowColor3: hexToRgb('#e4cd9c'),
    glowIntensity: 0.14,
    mouseRadius: 0.22, mouseStrength: 0.6, decay: 0.965,
    timeScale: 0.8, vignette: 0.32, grain: 0.014,
    fallback: 'radial-gradient(circle at 78% 14%, rgba(232,223,200,.14), transparent 52%), radial-gradient(circle at 14% 92%, rgba(63,107,88,.5), transparent 60%), linear-gradient(160deg, #0d1713, #060d0a)',
  },
  spectra: {
    flagship: true, ...FLAGSHIP_DEFAULTS,
    base: hexToRgb('#0a1122'), baseB: hexToRgb('#04070f'),
    glowA: hexToRgb('#16336b'), glowAPos: [0.22, 0.8], glowAR: 2.2, glowAAmp: 0.55,
    glowB: hexToRgb('#2a1e5c'), glowBPos: [0.9, 0.06], glowBR: 2.6, glowBAmp: 0.5,
    beam: 1.0, beamColor: hexToRgb('#a8c4ff'),
    rings: 0, ringColor: hexToRgb('#c9a96a'), ringPos: [0.84, 0.88],
    stars: 0,
    glowColor1: hexToRgb('#ffffff'), glowColor2: hexToRgb('#9dbcff'), glowColor3: hexToRgb('#b18cff'),
    glowIntensity: 0.12,
    mouseRadius: 0.22, mouseStrength: 0.55, decay: 0.965,
    timeScale: 0.8, vignette: 0.3, grain: 0.014,
    fallback: 'linear-gradient(115deg, transparent 40%, rgba(168,196,255,.22) 47%, rgba(255,255,255,.30) 50%, rgba(177,140,255,.2) 53%, transparent 60%), radial-gradient(circle at 20% 18%, rgba(22,51,107,.6), transparent 55%), linear-gradient(160deg, #0a1122, #04070f)',
  },
  starward: {
    flagship: true, ...FLAGSHIP_DEFAULTS,
    base: hexToRgb('#040b1c'), baseB: hexToRgb('#0c2148'),
    glowA: hexToRgb('#123a6e'), glowAPos: [0.5, 0.02], glowAR: 1.5, glowAAmp: 0.42,
    glowB: hexToRgb('#0a1b3a'), glowBPos: [0.82, 0.32], glowBR: 2.4, glowBAmp: 0.4,
    beam: 0, beamColor: hexToRgb('#a8c4ff'),
    rings: 0, ringColor: hexToRgb('#c9a96a'), ringPos: [0.84, 0.88],
    stars: 0.9,
    glowColor1: hexToRgb('#ffffff'), glowColor2: hexToRgb('#b9d9ff'), glowColor3: hexToRgb('#7fa8e8'),
    glowIntensity: 0.1,
    mouseRadius: 0.22, mouseStrength: 0.5, decay: 0.965,
    timeScale: 0.7, vignette: 0.3, grain: 0.012,
    fallback: 'radial-gradient(1.5px 1.5px at 22% 18%, rgba(255,255,255,.9), transparent 60%), radial-gradient(1px 1px at 64% 12%, rgba(255,255,255,.65), transparent 60%), radial-gradient(1.2px 1.2px at 82% 34%, rgba(255,255,255,.75), transparent 60%), radial-gradient(1px 1px at 38% 48%, rgba(255,255,255,.5), transparent 60%), radial-gradient(ellipse 120% 60% at 50% 108%, rgba(18,58,110,.55), transparent 62%), linear-gradient(180deg, #040b1c, #0c2148)',
  },
}

const VERTEX_SRC = `#version 300 es
in vec4 a_position;
out vec2 vUv;
void main() { vUv = a_position.xy * 0.5 + 0.5; gl_Position = a_position; }
`

const FLOW_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;
void main() {
  vec4 prev = texture(u_prev, vUv);
  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);
  float dist = distance(vUv, u_mouse);
  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);
  float speed = length(u_velocity);
  float totalStrength = u_brushStrength * 0.3 + min(speed * 3.0, 0.7) * u_brushStrength;
  prev.r = max(prev.r, influence * totalStrength);
  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  fragColor = prev;
}
`

const MAIN_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_scale;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1, u_glowColor2, u_glowColor3;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
uniform vec2 u_lightPos;
uniform float u_lightCore, u_lightHalo, u_vignette;
uniform float u_bloomThreshold, u_bloomRange, u_bloomStrength;
out vec4 fragColor;
// ashima 3D simplex noise (webgl-noise)
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  vec4 a1 = b0.zwzw + s1.zwzw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float fbm(vec3 p){ float v=0.,amp=.6; vec3 shift=vec3(100.); for(int i=0;i<1;i++){ v+=amp*snoise(p); p=p*2.+shift; amp*=.4; } return v; }
float fluidNoise(vec2 uv,float t){
  float n1=fbm(vec3(uv*.6,t*.06));
  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
  vec2 w1=vec2(n1,n2)*.6;
  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
  vec2 w2=vec2(n3,n4)*.5;
  return fbm(vec3((uv+w1+w2)*.5,t*.04));
}
void main(){
  float aspect=u_resolution.x/u_resolution.y;
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 suv=vec2(uv.x*aspect,uv.y)*u_scale+u_offset;
  float t=u_time;
  vec4 flow=texture(u_flowmap,uv);
  float influence=flow.r;
  vec2 flowDir=(flow.gb-.5)*2.;
  suv+=flowDir*influence*u_distortBoost*.8;
  float swirlAngle=influence*u_swirlBoost*2.5;
  float cs=cos(swirlAngle),sn=sin(swirlAngle);
  vec2 delta=suv-vec2(uv.x*aspect,uv.y)*u_scale;
  suv+=(mat2(cs,sn,-sn,cs)*delta-delta)*influence;
  vec2 uvD=suv+.55*vec2(fbm(vec3(suv*.9,t*.05+11.)),fbm(vec3(suv*.9+3.7,t*.05+23.)));
  float f=fluidNoise(uvD,t);
  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
  float n=f*.7+.5;
  vec3 col=mix(u_c1,u_c2,smoothstep(.12,.5,n));
  col=mix(col,u_c3,smoothstep(.48,.82,n+swirl*.2)*.85);
  col=mix(col,u_c4,smoothstep(.5,.92,swirl)*.8);
  col=mix(col,u_c5,smoothstep(.38,.85,n*swirl)*.65);
  float glow=smoothstep(0.,.8,influence);
  float glowNoise=snoise(vec3(uvD*1.5,t*.08))*.5+.5;
  float glowDist=smoothstep(0.,1.,influence);
  vec3 glowMix=mix(u_glowColor3,u_glowColor2,glowDist);
  glowMix=mix(glowMix,u_glowColor1,glowDist*glowNoise);
  col=mix(col,glowMix,glow*u_glowIntensity);
  float luma=dot(col,vec3(.299,.587,.114));
  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;
  float ld=length((uv-u_lightPos)*vec2(aspect,1.));
  float core=exp(-ld*ld*4.5);
  float halo=exp(-ld*1.8);
  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;
  float vig=1.-smoothstep(.35,.75,length(uv-.5));
  col=mix(col*(1.-u_vignette),col,vig);
  fragColor=vec4(col,1.);
}
`

/* ── 红果（构图化色场）主 shader ──
 * 品牌色对：青 × 橙；色团绕屏幕中心公转（各团周期互不成整数倍），t=0 呈现设计构图；
 * 边缘由两层低频 simplex 驱动（不用会折叠的强域扭曲——高渲染比例下会出碎片割裂）。
 * 复用与 vivid 相同的 vertex / flow / 光标参数；额外 uniform：u_sat / u_calm* / u_breath / u_roam。
 */
const MAIN_FRAG_SRC_HONGGUO = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_scale;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1, u_glowColor2, u_glowColor3;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
uniform vec2 u_lightPos;
uniform float u_lightCore, u_lightHalo, u_vignette;
uniform float u_sat, u_calmR, u_calmA, u_breath, u_roam;
out vec4 fragColor;
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  vec4 a1 = b0.zwzw + s1.zwzw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){ float v=0.,amp=.6; vec3 shift=vec3(100.); for(int i=0;i<1;i++){ v+=amp*snoise(p); p=p*2.+shift; amp*=.4; } return v; }
void main(){
  float aspect = u_resolution.x/u_resolution.y;
  vec2 uv = gl_FragCoord.xy/u_resolution;
  vec2 p = (uv-.5)*vec2(aspect,1.);
  float t = u_time;
  // 整体轻微摆动（有界，绝不把构图推出画面）
  vec2 drift = vec2(sin(t*.017), sin(t*.023)) * .07;
  // 鼠标 flowmap
  vec4 flow = texture(u_flowmap, uv);
  float influence = flow.r;
  vec2 flowDir = (flow.gb-.5)*2.;
  vec2 suv = p + drift + flowDir*influence*u_distortBoost*.8;
  float swirlAngle = influence*u_swirlBoost*2.2;
  float cs = cos(swirlAngle), sn = sin(swirlAngle);
  suv += (mat2(cs,sn,-sn,cs)*suv - suv)*influence;
  // 边缘驱动噪声：低频为主 + 一点中频（光滑 simplex，无折痕）
  float nA = snoise(vec3(suv*.55, t*.035))*.5+.5;
  float nB = snoise(vec3(suv*1.15+7.3, t*.03+2.0))*.5+.5;
  float n = nA + (nB-.5)*.4;
  // 极轻域扭曲，只用于鼠标辉光
  vec2 uvD = suv*u_scale + .18*vec2(fbm(vec3(suv*.5, t*.04+11.)), fbm(vec3(suv*.5+3.7, t*.04+23.)));
  // 三段错相呼吸（约 25s 周期）
  float br = u_breath;
  float bA = 1. + (sin(t*.22)*.5+.5 - .5)*.34*br;
  float bB = 1. + (sin(t*.29+2.1)*.5+.5 - .5)*.38*br;
  float bC = 1. + (sin(t*.25+4.4)*.5+.5 - .5)*.42*br;
  // 构图：左上香槟金 · 左下青（主调） · 右下橙（兴奋点） · 右上浅青
  // 环游：各团绕屏幕中心公转，初始相位 = 构图方位；rm=0 完全固定
  float rm = u_roam;
  float aA = t*.045 - 2.320;
  float aB = t*.037 - 0.843;
  float aC = t*.058 + 2.277;
  float aD = t*.029 + 1.017;
  vec2 orbA = vec2(cos(aA), sin(aA)*.62) * .617;
  vec2 orbB = vec2(cos(aB), sin(aB)*.62) * .691;
  vec2 orbC = vec2(cos(aC), sin(aC)*.62) * .678;
  vec2 orbD = vec2(cos(aD), sin(aD)*.62) * .683;
  vec2 posA = mix(vec2(-.42,-.28), orbA, rm);
  vec2 posB = mix(vec2(.46,-.32),  orbB, rm);
  vec2 posC = mix(vec2(-.44,.32),  orbC, rm);
  vec2 posD = mix(vec2(.36,.36),   orbD, rm);
  float dd;
  dd = length(suv - posA); dd += (n-.5)*.22;
  float mA = 1. - smoothstep(.34*bA, .86*bA, dd);
  dd = length(suv - posB); dd += (n-.5)*.24;
  float mB = 1. - smoothstep(.30*bB, .76*bB, dd);
  dd = length(suv - posC); dd += (n-.5)*.20;
  float mC = 1. - smoothstep(.24*bC, .64*bC, dd);
  dd = length(suv - posD); dd += (n-.5)*.22;
  float mD = 1. - smoothstep(.26, .68, dd);
  vec3 col = u_c1;
  col = mix(col, u_c2, mA*.80);
  col = mix(col, u_c3, mB*.78);
  col = mix(col, u_c5, mC*.62);
  col = mix(col, u_c4, mD*.46);
  // 鼠标辉光
  float glow = smoothstep(0.,.8,influence);
  float glowNoise = snoise(vec3(uvD*1.5, t*.08))*.5+.5;
  float glowDist = smoothstep(0.,1.,influence);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
  glowMix = mix(glowMix, u_glowColor1, glowDist*glowNoise);
  col = mix(col, glowMix, glow*u_glowIntensity);
  // 饱和度 + 静区
  float luma = dot(col, vec3(.299,.587,.114));
  col = mix(vec3(luma), col, u_sat);
  float d = length((uv-.5)*vec2(aspect,1.));
  float calm = 1.0 - smoothstep(u_calmR, u_calmR+.42, d);
  col = mix(col, mix(col, vec3(.95,.957,.968), .6), calm*u_calmA);
  // 光源（右上）+ vignette
  vec2 lp = (vec2(.78,.82)-.5)*vec2(aspect,1.);
  float ld = length(p-lp);
  col += vec3(1.,.97,.9)*exp(-ld*ld*4.5)*u_lightCore + vec3(.72,.8,1.)*exp(-ld*1.8)*u_lightHalo;
  float vig = 1.0 - smoothstep(.5,.95,length(uv-.5));
  col = mix(col*(1.-u_vignette), col, vig);
  fragColor = vec4(col,1.);
}
`

/* ── 旗舰深色主 shader（璇玑 / 光谱 / 牵星共用，差异全部由 uniform 驱动）──
 * 深底渐变 + 两团漂移辉光（滚动视差）+ 可选光束色散 / 刻度环 / 星场 + 颗粒去色带。
 * 鼠标 flowmap 只做克制提亮，不扭曲画面——旗舰的动是「呼吸」，不是「玩耍」。
 */
const MAIN_FRAG_SRC_FLAGSHIP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_flowmap;
uniform vec3 u_base, u_baseB;
uniform vec3 u_glowA, u_glowB;
uniform vec2 u_glowAPos, u_glowBPos;
uniform float u_glowAR, u_glowBR, u_glowAAmp, u_glowBAmp;
uniform float u_beam;
uniform vec3 u_beamColor;
uniform float u_rings;
uniform vec3 u_ringColor;
uniform vec2 u_ringPos;
uniform float u_stars;
uniform float u_scroll;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1, u_glowColor2, u_glowColor3;
uniform float u_vignette, u_grain;
out vec4 fragColor;
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
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
  vec4 a1 = b0.zwzw + s1.zwzw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  float aspect = u_resolution.x/u_resolution.y;
  vec2 uv = gl_FragCoord.xy/u_resolution;
  vec2 p = (uv-.5)*vec2(aspect,1.);
  float t = u_time;
  vec3 col = mix(u_baseB, u_base, smoothstep(-.08, 1.06, uv.y));
  float n = snoise(vec3(p*.7, t*.04))*.5+.5;
  float n2 = snoise(vec3(p*1.3+4.7, t*.033+2.2))*.5+.5;
  vec2 drift = vec2(sin(t*.021), cos(t*.017))*.05;
  vec2 par = vec2(0., u_scroll*.16);
  float dA = length(p - ((u_glowAPos-.5)*vec2(aspect,1.) + drift + par));
  float dB = length(p - ((u_glowBPos-.5)*vec2(aspect,1.) - drift*1.3 + par*.6));
  col += u_glowA * exp(-dA*u_glowAR) * (.72+.28*n) * u_glowAAmp;
  col += u_glowB * exp(-dB*u_glowBR) * (.68+.32*n2) * u_glowBAmp;
  if (u_beam > .001) {
    vec2 bp = (vec2(.30,.80)-.5)*vec2(aspect,1.) + par*.4;
    vec2 nrm = vec2(.276, .961);
    float d = dot(p-bp, nrm);
    float flick = .82+.18*n2;
    vec3 beam = vec3(1.) * exp(-d*d*320.) * .85;
    beam += vec3(1.,.58,.38) * exp(-pow((d-.018)*120.,2.)) * .9;
    beam += vec3(.45,.72,1.) * exp(-pow((d+.018)*120.,2.)) * .9;
    col += beam * u_beamColor * u_beam * flick;
    col += u_beamColor * exp(-abs(d)*7.) * .05 * u_beam;
  }
  if (u_rings > .001) {
    vec2 rp = (u_ringPos-.5)*vec2(aspect,1.) + par*.5;
    float rd = length(p-rp);
    float fr = fract(rd*7.);
    float ringLine = smoothstep(.045,.0,min(fr,1.-fr));
    float fade = exp(-rd*2.05) * smoothstep(.08,.26,rd);
    col += u_ringColor * ringLine * fade * u_rings;
  }
  if (u_stars > .001) {
    vec2 sg = p*13. + vec2(0., u_scroll*2.4);
    vec2 cell = floor(sg);
    float h = hash(cell);
    if (h > .80) {
      vec2 f = fract(sg);
      vec2 sp = vec2(hash(cell+7.13), hash(cell+3.71))*.8+.1;
      float sd = length(f-sp);
      float tw = .6+.4*sin(t*(.75+h*1.8)+h*31.);
      col += vec3(.86,.92,1.) * smoothstep(.065,.02,sd) * smoothstep(.82,.94,h) * tw * u_stars;
    }
  }
  vec4 flow = texture(u_flowmap, uv);
  float influence = smoothstep(0.,.8,flow.r);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, influence);
  glowMix = mix(glowMix, u_glowColor1, influence*n);
  col += glowMix * influence * u_glowIntensity;
  col += (hash(gl_FragCoord.xy + fract(t)*17.)-.5)*u_grain;
  float vig = 1.-smoothstep(.35,.78,length(uv-.5));
  col = mix(col*(1.-u_vignette), col, vig);
  fragColor = vec4(col,1.);
}
`

/**
 * 液态玻璃背景层：WebGL2 流体渐变 + flowmap 鼠标交互。
 * createPortal 到 document.body，fixed 全视口，pointer-events:none，z-index:0
 * （#root 由 CSS 抬到 z-index:1，canvas 透过被中和为透明的容器底色显现）。
 * WebGL2 不可用时静默无操作；prefers-reduced-motion 时只渲染一帧静态画面。
 */
export default function LiquidGlassBackdrop({ variant = 'vivid' }) {
  const canvasRef = useRef(null)
  // 旗舰深色主题在 WebGL2 不可用时退化为静态深底渐变（否则深色文字会浮在白页上）
  const [glDead, setGlDead] = useState(false)

  useEffect(() => {
    if (isComposedGlassStyle(variant)) return undefined
    if (import.meta.env.DEV) window.__liquidGlassDebug = { stage: 'effect-enter' }
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })
    if (!gl) {
      if (import.meta.env.DEV) window.__liquidGlassDebug = { failed: 'no-webgl2' }
      if (FLAGSHIP_PARAMS[variant]) setGlDead(true)
      return undefined // WebGL2 不可用：静默无操作
    }
    setGlDead(false)

    const flagshipParams = FLAGSHIP_PARAMS[variant]
    const P = flagshipParams || (variant === 'hongguo' ? HONGGUO_PARAMS : LIQUID_PARAMS)
    const mainFragSrc = flagshipParams
      ? MAIN_FRAG_SRC_FLAGSHIP
      : variant === 'hongguo' ? MAIN_FRAG_SRC_HONGGUO : MAIN_FRAG_SRC

    const compile = (type, src) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[LiquidGlass] shader compile failed:', gl.getShaderInfoLog(shader))
        if (import.meta.env.DEV) {
          window.__liquidGlassCompileLog = `${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}: ${gl.getShaderInfoLog(shader)}`
        }
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const linkProgram = (fragSrc) => {
      const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC)
      const fs = compile(gl.FRAGMENT_SHADER, fragSrc)
      if (!vs || !fs) return null
      const prog = gl.createProgram()
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[LiquidGlass] program link failed:', gl.getProgramInfoLog(prog))
        if (import.meta.env.DEV) window.__liquidGlassLinkLog = gl.getProgramInfoLog(prog)
        gl.deleteProgram(prog)
        return null
      }
      return prog
    }

    const flowProg = linkProgram(FLOW_FRAG_SRC)
    const mainProg = linkProgram(mainFragSrc)
    if (!flowProg || !mainProg) {
      if (import.meta.env.DEV) {
        window.__liquidGlassDebug = { failed: `link flow=${!!flowProg} main=${!!mainProg}` }
      }
      if (flowProg) gl.deleteProgram(flowProg)
      if (mainProg) gl.deleteProgram(mainProg)
      if (FLAGSHIP_PARAMS[variant]) setGlDead(true)
      return undefined
    }
    const flowU = {}
    ;['u_prev', 'u_mouse', 'u_velocity', 'u_brushRadius', 'u_brushStrength', 'u_decay'].forEach((name) => {
      flowU[name] = gl.getUniformLocation(flowProg, name)
    })
    const mainU = {}
    ;[
      'u_time', 'u_resolution', 'u_scale', 'u_offset', 'u_flowmap',
      'u_distortBoost', 'u_swirlBoost', 'u_glowIntensity',
      'u_glowColor1', 'u_glowColor2', 'u_glowColor3',
      'u_c1', 'u_c2', 'u_c3', 'u_c4', 'u_c5',
      'u_lightPos', 'u_lightCore', 'u_lightHalo', 'u_vignette',
      'u_bloomThreshold', 'u_bloomRange', 'u_bloomStrength',
      'u_sat', 'u_calmR', 'u_calmA', 'u_breath', 'u_roam',
      'u_base', 'u_baseB', 'u_glowA', 'u_glowB', 'u_glowAPos', 'u_glowBPos',
      'u_glowAR', 'u_glowBR', 'u_glowAAmp', 'u_glowBAmp',
      'u_beam', 'u_beamColor', 'u_rings', 'u_ringColor', 'u_ringPos',
      'u_stars', 'u_scroll', 'u_grain',
    ].forEach((name) => {
      mainU[name] = gl.getUniformLocation(mainProg, name)
    })

    // 全屏 quad（TRIANGLE_STRIP，attrib 传 2 分量，GL 自动补 z=0 w=1）
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const bindQuad = (prog) => {
      const loc = gl.getAttribLocation(prog, 'a_position')
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }

    // flowmap ping-pong：RGBA8 + LINEAR + CLAMP，无需浮点扩展；初始 r=0 g=b=0.5（无影响、无速度）
    const createFlowTarget = (w, h) => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.clearColor(0, 0.5, 0.5, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return { tex, fbo, w, h }
    }
    let flowTargets = null
    const setupFlowTargets = () => {
      if (flowTargets) {
        flowTargets.forEach((t) => {
          gl.deleteTexture(t.tex)
          gl.deleteFramebuffer(t.fbo)
        })
      }
      const fw = Math.max(1, Math.round(canvas.width * FLOWMAP_SCALE))
      const fh = Math.max(1, Math.round(canvas.height * FLOWMAP_SCALE))
      flowTargets = [createFlowTarget(fw, fh), createFlowTarget(fw, fh)]
    }
    const resize = () => {
      // vivid：全分辨率（DPR ≤ 1.5）；红果：视口 89%；旗舰：DPR ≤ 1.2 × 0.75（柔光场，肉眼无差）
      const scale = flagshipParams
        ? Math.min(window.devicePixelRatio || 1, FLAGSHIP_DPR_CAP) * FLAGSHIP_RES_SCALE
        : variant === 'hongguo' ? HONGGUO_SCALE : Math.min(window.devicePixelRatio || 1, MAX_DPR)
      canvas.width = Math.max(1, Math.round(window.innerWidth * scale))
      canvas.height = Math.max(1, Math.round(window.innerHeight * scale))
      setupFlowTargets() // 跟随画布按 1/4 比例重建（内容重置为中性）
    }

    // 鼠标状态（监听 window；canvas 本身 pointer-events:none）
    const hoverCapable = !window.matchMedia || window.matchMedia('(hover: hover)').matches
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let mouseInit = false
    let tx = 0.5
    let ty = 0.5
    let sx = 0.5
    let sy = 0.5
    let svx = 0
    let svy = 0
    let lastInteraction = -Infinity
    const markInteraction = () => {
      lastInteraction = performance.now()
    }
    const onMouseMove = (e) => {
      markInteraction()
      tx = e.clientX / window.innerWidth
      ty = 1 - e.clientY / window.innerHeight // y 翻转到 GL 坐标
      if (!mouseInit) {
        mouseInit = true
        sx = tx
        sy = ty
      }
    }

    let scrollTarget = 0
    let scrollSmooth = 0
    const onScroll = (e) => {
      markInteraction()
      const el = e.target
      if (el && typeof el.scrollTop === 'number' && el.scrollHeight > el.clientHeight) {
        scrollTarget = Math.min(1, Math.max(0, el.scrollTop / (el.scrollHeight - el.clientHeight)))
      }
    }

    let readIdx = 0
    const renderFrame = (tSec) => {
      sx += (tx - sx) * 0.08
      scrollSmooth += (scrollTarget - scrollSmooth) * 0.06
      sy += (ty - sy) * 0.08
      svx += ((tx - sx) * 0.5 - svx) * 0.12
      svy += ((ty - sy) * 0.5 - svy) * 0.12

      // 1) flow pass：读 readIdx，写入另一张
      const readTarget = flowTargets[readIdx]
      const writeTarget = flowTargets[1 - readIdx]
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo)
      gl.viewport(0, 0, writeTarget.w, writeTarget.h)
      gl.useProgram(flowProg)
      bindQuad(flowProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex)
      gl.uniform1i(flowU.u_prev, 0)
      gl.uniform2f(flowU.u_mouse, sx, sy)
      gl.uniform2f(flowU.u_velocity, svx, svy)
      gl.uniform1f(flowU.u_brushRadius, P.mouseRadius)
      gl.uniform1f(flowU.u_brushStrength, P.mouseStrength)
      gl.uniform1f(flowU.u_decay, P.decay)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      readIdx = 1 - readIdx

      // 2) main pass：全屏流体，采样 flowmap 做扭曲 + 旋涡 + 辉光
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(mainProg)
      bindQuad(mainProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, writeTarget.tex)
      gl.uniform1i(mainU.u_flowmap, 0)
      gl.uniform1f(mainU.u_time, tSec)
      gl.uniform2f(mainU.u_resolution, canvas.width, canvas.height)
      gl.uniform1f(mainU.u_scale, P.scale)
      gl.uniform2f(mainU.u_offset, P.offset[0], P.offset[1])
      gl.uniform1f(mainU.u_distortBoost, P.distortBoost)
      gl.uniform1f(mainU.u_swirlBoost, P.swirlBoost)
      gl.uniform1f(mainU.u_glowIntensity, P.glowIntensity)
      gl.uniform3fv(mainU.u_glowColor1, P.glowColor1)
      gl.uniform3fv(mainU.u_glowColor2, P.glowColor2)
      gl.uniform3fv(mainU.u_glowColor3, P.glowColor3)
      gl.uniform3fv(mainU.u_c1, P.c1)
      gl.uniform3fv(mainU.u_c2, P.c2)
      gl.uniform3fv(mainU.u_c3, P.c3)
      gl.uniform3fv(mainU.u_c4, P.c4)
      gl.uniform3fv(mainU.u_c5, P.c5)
      gl.uniform2f(mainU.u_lightPos, P.lightPos[0], P.lightPos[1])
      gl.uniform1f(mainU.u_lightCore, P.lightCore)
      gl.uniform1f(mainU.u_lightHalo, P.lightHalo)
      gl.uniform1f(mainU.u_vignette, P.vignette)
      gl.uniform1f(mainU.u_bloomThreshold, P.bloomThreshold)
      gl.uniform1f(mainU.u_bloomRange, P.bloomRange)
      gl.uniform1f(mainU.u_bloomStrength, P.bloomStrength)
      // 红果专用（vivid 传入 null location，会被静默忽略）
      if (P.sat !== undefined) gl.uniform1f(mainU.u_sat, P.sat)
      if (P.calmR !== undefined) gl.uniform1f(mainU.u_calmR, P.calmR)
      if (P.calmA !== undefined) gl.uniform1f(mainU.u_calmA, P.calmA)
      if (P.breath !== undefined) gl.uniform1f(mainU.u_breath, P.breath)
      if (P.roam !== undefined) gl.uniform1f(mainU.u_roam, P.roam)
      // 旗舰深色三主题（vivid / 红果无这些 location，静默忽略；故按字段存在性整体守卫）
      if (P.flagship) {
        gl.uniform3fv(mainU.u_base, P.base)
        gl.uniform3fv(mainU.u_baseB, P.baseB)
        gl.uniform3fv(mainU.u_glowA, P.glowA)
        gl.uniform3fv(mainU.u_glowB, P.glowB)
        gl.uniform2f(mainU.u_glowAPos, P.glowAPos[0], P.glowAPos[1])
        gl.uniform2f(mainU.u_glowBPos, P.glowBPos[0], P.glowBPos[1])
        gl.uniform1f(mainU.u_glowAR, P.glowAR)
        gl.uniform1f(mainU.u_glowBR, P.glowBR)
        gl.uniform1f(mainU.u_glowAAmp, P.glowAAmp)
        gl.uniform1f(mainU.u_glowBAmp, P.glowBAmp)
        gl.uniform1f(mainU.u_beam, P.beam)
        gl.uniform3fv(mainU.u_beamColor, P.beamColor)
        gl.uniform1f(mainU.u_rings, P.rings)
        gl.uniform3fv(mainU.u_ringColor, P.ringColor)
        gl.uniform2f(mainU.u_ringPos, P.ringPos[0], P.ringPos[1])
        gl.uniform1f(mainU.u_stars, P.stars)
        gl.uniform1f(mainU.u_scroll, scrollSmooth)
        gl.uniform1f(mainU.u_grain, P.grain)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    let rafId = 0
    let running = false
    let last = 0
    const startTime = performance.now()
    const tick = (now) => {
      if (!running) return
      rafId = window.requestAnimationFrame(tick)
      // 旗舰：待机 12fps，交互窗口内 30fps；其余主题恒定 30fps
      const frameMs = flagshipParams
        ? (now - lastInteraction < FLAGSHIP_INTERACTIVE_WINDOW_MS ? FRAME_MS : FLAGSHIP_IDLE_FRAME_MS)
        : FRAME_MS
      if (now - last < frameMs) return
      last = now
      renderFrame(((now - startTime) / 1000) * P.timeScale)
    }
    const start = () => {
      if (running || reduced) return
      running = true
      last = 0
      rafId = window.requestAnimationFrame(tick)
    }
    const stop = () => {
      running = false
      window.cancelAnimationFrame(rafId)
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }
    const onResize = () => {
      resize()
      if (reduced) renderFrame(REDUCED_MOTION_TIME) // 静态帧也需要跟随新尺寸
    }

    resize()
    if (import.meta.env.DEV) {
      window.__liquidGlassDebug = {
        render: (t = 5) => renderFrame(t),
        params: P,
        // 直接在渲染同一任务内 readPixels，绕过合成器拿 shader 的真实输出
        capture: (t = 5) => {
          renderFrame(t)
          const w = canvas.width
          const h = canvas.height
          const px = new Uint8Array(w * h * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
          const c2 = document.createElement('canvas')
          const scale = 400 / w
          c2.width = 400
          c2.height = Math.round(h * scale)
          const ctx = c2.getContext('2d')
          const img = ctx.createImageData(w, h)
          img.data.set(px)
          const tmp = document.createElement('canvas')
          tmp.width = w
          tmp.height = h
          tmp.getContext('2d').putImageData(img, 0, 0)
          ctx.scale(1, -1) // GL y 轴翻转
          ctx.translate(0, -c2.height)
          ctx.drawImage(tmp, 0, 0, c2.width, c2.height)
          return c2.toDataURL('image/png')
        },
      }
    }
    if (reduced) {
      renderFrame(REDUCED_MOTION_TIME) // 只渲染一帧静态画面
    } else {
      start()
      if (hoverCapable) window.addEventListener('mousemove', onMouseMove, { passive: true })
      window.addEventListener('scroll', onScroll, { capture: true, passive: true })
      document.addEventListener('visibilitychange', onVisibility)
    }
    window.addEventListener('resize', onResize)

    return () => {
      stop()
      if (import.meta.env.DEV) delete window.__liquidGlassDebug
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('visibilitychange', onVisibility)
      if (flowTargets) {
        flowTargets.forEach((t) => {
          gl.deleteTexture(t.tex)
          gl.deleteFramebuffer(t.fbo)
        })
      }
      gl.deleteBuffer(quad)
      gl.deleteProgram(flowProg)
      gl.deleteProgram(mainProg)
      // 不调 loseContext：StrictMode 双挂载会让第二次 effect 拿到同一个已销毁的 context
    }
  }, [variant])

  if (typeof document === 'undefined') return null
  if (isComposedGlassStyle(variant)) {
    return createPortal(<ComposedGlassScene variant={variant} />, document.body)
  }
  return createPortal(
    <>
      {FLAGSHIP_PARAMS[variant] && glDead ? (
        <div
          aria-hidden
          className="flagship-glass-fallback pointer-events-none fixed inset-0 h-full w-full"
          style={{ zIndex: 0, background: FLAGSHIP_PARAMS[variant].fallback }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 h-full w-full"
        style={{ zIndex: 0 }}
      />
    </>,
    document.body,
  )
}
