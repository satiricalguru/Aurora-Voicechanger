// One WebGL renderer, two passes:
//  1. a full-screen aurora (Superwhisper's black → navy → violet → lavender horizon)
//     that breathes with your voice and sinks as you scroll;
//  2. an audio-reactive sphere (ElevenLabs-style colour orb) that sits in the
//     hero, deforms with the output spectrum, and drifts up and away on scroll.

import * as THREE from 'three';
import { live, tickLive } from '../lib/engine';
import { motion } from '../lib/motion';

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const auroraFrag = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uLevel; uniform float uHero;
uniform float uPage; uniform vec3 uTint; uniform vec2 uPointer;
varying vec2 vUv;
${NOISE}
float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.02;a*=0.5;}return s;}

vec3 ramp(float t){
  // #000000 → #112d72 → #4b52aa → #a887dc → #e6c4e7 → #fcdbef
  vec3 c0=vec3(0.0), c1=vec3(0.067,0.176,0.447), c2=vec3(0.294,0.322,0.667);
  vec3 c3=vec3(0.659,0.529,0.863), c4=vec3(0.902,0.769,0.906), c5=vec3(0.988,0.859,0.937);
  t=clamp(t,0.0,1.0);
  if(t<0.35) return mix(c0,c1,t/0.35);
  if(t<0.6)  return mix(c1,c2,(t-0.35)/0.25);
  if(t<0.78) return mix(c2,c3,(t-0.6)/0.18);
  if(t<0.92) return mix(c3,c4,(t-0.78)/0.14);
  return mix(c4,c5,(t-0.92)/0.08);
}

void main(){
  vec2 uv=vUv; float aspect=uRes.x/uRes.y;
  vec2 p=vec2((uv.x-0.5)*aspect, uv.y);
  float t=uTime*0.045;

  // Horizon glow: black at the top, lavender-pink only along the bottom edge.
  // The line is warped by slow noise and lifted a little while you speak.
  float warp=fbm(vec3(p.x*0.9+uPointer.x*0.05, t, 0.0))*0.10;
  float curtain=fbm(vec3(p.x*2.4, p.y*0.6-t*1.6, t*0.7));
  float sink=uHero*0.35 + uPage*0.12;
  float y=uv.y + warp - uLevel*0.06 + sink + curtain*0.035;
  float h=1.0-smoothstep(-0.02, 0.92, y);        // 1 at the bottom edge, 0 by the top
  h=pow(clamp(h,0.0,1.0),2.1);
  vec3 col=ramp(h*0.98);
  // Voice tint is mixed into the mid-band so each character colours the sky.
  col=mix(col, col*0.55+uTint*0.55*h, 0.35*smoothstep(0.15,0.75,h));
  // Vertical streaks of light, brighter while speaking.
  float streak=pow(max(0.0, snoise(vec3(p.x*7.0, t*2.0, 3.0))),3.0);
  col+=uTint*streak*smoothstep(0.05,0.6,h)*(0.06+uLevel*0.5);

  // Fade toward pure black under content as the page scrolls.
  col*=mix(1.0, 0.45, smoothstep(0.0,1.0,uHero));
  // Vignette and grain (grain hides 8-bit banding in the gradient).
  float vig=smoothstep(1.25,0.25,length((uv-vec2(0.5,0.35))*vec2(aspect*0.8,1.0)));
  col*=mix(0.55,1.0,vig);
  float g=fract(sin(dot(gl_FragCoord.xy+uTime,vec2(12.9898,78.233)))*43758.5453);
  col+=(g-0.5)/255.0*2.0;
  gl_FragColor=vec4(col,1.0);
}`;

const sphereVert = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uBass; uniform float uTreble;
varying vec3 vNormal; varying vec3 vPos; varying float vDisp;
${NOISE}
void main(){
  vec3 p=position;
  float t=uTime*0.35;
  float n=snoise(p*1.1+vec3(t, t*0.6, -t*0.4));
  float fine=snoise(p*4.5+vec3(-t*1.8))*uTreble;
  float disp=n*(0.045+uLevel*0.22+uBass*0.10)+fine*0.05;
  p+=normal*disp;
  vDisp=disp;
  vNormal=normalize(normalMatrix*normal);
  vec4 mv=modelViewMatrix*vec4(p,1.0);
  vPos=mv.xyz;
  gl_Position=projectionMatrix*mv;
}`;

const sphereFrag = /* glsl */ `
precision highp float;
uniform float uTime; uniform float uLevel; uniform float uAlpha; uniform vec3 uTint; uniform vec3 uWarm; uniform vec3 uCool;
varying vec3 vNormal; varying vec3 vPos; varying float vDisp;
${NOISE}
void main(){
  vec3 n=normalize(vNormal);
  vec3 v=normalize(-vPos);
  float fres=pow(1.0-max(dot(n,v),0.0),2.2);
  float swirl=snoise(vec3(n.xy*1.6, uTime*0.12))*0.5+0.5;
  // ElevenLabs-style blend: cool violet top, warm ember bottom, the voice colour in between.
  float k=smoothstep(-0.7,0.9,n.y+swirl*0.6-0.3);
  vec3 base=mix(uWarm, uCool, k);
  base=mix(base, uTint, 0.45*smoothstep(0.2,0.8,swirl));
  base+=vDisp*1.2;
  float lit=max(dot(n,normalize(vec3(-0.4,0.8,0.6))),0.0);
  vec3 col=base*(0.72+0.38*lit);
  col=mix(col, vec3(1.0,0.93,0.97), 0.12+0.18*pow(lit,6.0));   // soft pastel sheen
  col+=fres*(vec3(0.85,0.8,1.0)*0.5+uTint*0.5)*(0.6+uLevel*0.8);
  gl_FragColor=vec4(col, uAlpha*(0.9+0.1*fres));
}`;

export class AuroraScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.autoClear = false;

    // Pass 1: aurora
    this.bgScene = new THREE.Scene();
    this.bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bgUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uLevel: { value: 0 }, uHero: { value: 0 }, uPage: { value: 0 },
      uTint: { value: new THREE.Color(0.72, 0.33, 0.9) },
      uPointer: { value: new THREE.Vector2() },
    };
    this.bgScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
        fragmentShader: auroraFrag,
        uniforms: this.bgUniforms,
        depthWrite: false,
      }),
    ));

    // Pass 2: sphere
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    this.camera.position.set(0, 0, 6);
    this.sphereUniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uBass: { value: 0 }, uTreble: { value: 0 }, uAlpha: { value: 1 },
      uTint: { value: new THREE.Color(0.72, 0.33, 0.9) },
      uWarm: { value: new THREE.Color('#ff4704') },
      uCool: { value: new THREE.Color('#0447ff') },
    };
    this.sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 96),
      new THREE.ShaderMaterial({
        vertexShader: sphereVert,
        fragmentShader: sphereFrag,
        uniforms: this.sphereUniforms,
        transparent: true,
      }),
    );
    this.scene.add(this.sphere);

    this.clock = new THREE.Clock();
    this.tint = new THREE.Color(0.72, 0.33, 0.9);
    this._target = new THREE.Color();
    this._pointer = new THREE.Vector2();
    this.running = true;
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.onVisibility = () => {
      this.running = !document.hidden;
      if (this.running) { this.clock.getDelta(); this.raf = requestAnimationFrame(this.frame); }
    };
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.bgUniforms.uRes.value.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewW = w; this.viewH = h;
  }

  frame() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    tickLive();

    const bands = live.bands;
    let bass = 0, treble = 0;
    for (let i = 0; i < 8; i++) bass += bands[i] || 0;
    for (let i = 14; i < 24; i++) treble += bands[i] || 0;
    bass /= 8; treble /= 10;

    // Ease the tint toward the active voice colour.
    this.tint.lerp(this._target.setRGB(...motion.tint), 1 - Math.pow(0.02, dt));

    const u = this.bgUniforms;
    u.uTime.value = t;
    u.uLevel.value = live.level;
    u.uHero.value += (motion.hero - u.uHero.value) * 0.12;
    u.uPage.value = motion.page;
    u.uTint.value.copy(this.tint);
    u.uPointer.value.lerp(this._pointer.set(motion.pointer.x, motion.pointer.y), 0.05);

    const s = this.sphereUniforms;
    s.uTime.value = t;
    s.uLevel.value = live.level;
    s.uBass.value += (bass - s.uBass.value) * 0.25;
    s.uTreble.value += (treble - s.uTreble.value) * 0.25;
    s.uTint.value.copy(this.tint);

    // Scroll choreography: the orb sits right of the headline, then rises,
    // shrinks and tucks into the top-right corner as content takes over.
    const p = easeInOut(Math.min(1, u.uHero.value));
    const wide = this.viewW / this.viewH;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    const halfW = halfH * wide;
    const x0 = this.viewW < 1100 ? halfW * 0.38 : halfW * 0.42;
    // End state peeks in from the top-right corner, dimmed, as ambient light.
    const x1 = halfW - 0.1;
    const y0 = -0.05, y1 = halfH - 0.05;
    s.uAlpha.value = lerp(1, 0.55, p);
    this.sphere.position.set(lerp(x0, x1, p), lerp(y0, y1, p), 0);
    const pulse = 1 + live.level * 0.08;
    const scale = lerp(this.viewW < 1100 ? 0.95 : 1.1, 0.6, p) * pulse;
    this.sphere.scale.setScalar(scale);
    this.sphere.rotation.y += dt * (0.12 + live.level * 0.6) + motion.velocity * 0.0008;
    this.sphere.rotation.x = lerp(this.sphere.rotation.x, motion.pointer.y * 0.25, 0.05);
    this.sphere.rotation.z = lerp(this.sphere.rotation.z, -motion.pointer.x * 0.15, 0.05);

    this.renderer.clear();
    this.renderer.render(this.bgScene, this.bgCam);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
