// scene.js —— Three.js 月球场景（真材贴图 + 画质增强）
//
// 关键思路：不去手算月相明暗界线，而是把太阳方向作为平行光方向，
// 让 PBR 材质自己算出“哪半边被照亮”。月相因此天然正确，方位也随季节自动变化。
//
// 贴图策略：优先加载本地 NASA 实拍月面（assets/moon_1024.jpg），
// 加载失败则退回程序化生成的 2048 月面，功能不受影响。

import * as THREE from 'three';
import { makeMoonTexture, makeBumpTexture, makeGlowTexture, makeEnvTexture } from './texture.js';

// 优先实拍，失败回落程序化
function loadMoonMap(loader) {
  return new Promise((resolve) => {
    loader.load(
      './assets/moon_1024.jpg',
      (tex) => resolve({ tex, real: true }),
      undefined,
      () => resolve({ tex: null, real: false })
    );
  });
}

export async function createMoonScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // 供导出卡片时截图
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  camera.position.set(0, 0, 4.75); // 月球约占画面七成，留出夜空余地
  camera.lookAt(0, -0.04, 0);

  // ── 环境反射 ──
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCanvas = new THREE.CanvasTexture(makeEnvTexture(512));
  envCanvas.mapping = THREE.EquirectangularReflectionMapping;
  envCanvas.colorSpace = THREE.SRGBColorSpace;
  const envTex = pmrem.fromEquirectangular(envCanvas).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.35; // 月球不吃太多环境光，否则暗面会发灰

  // ── 月球贴图：先试实拍 ──
  const loader = new THREE.TextureLoader();
  const { tex: realTex, real } = await loadMoonMap(loader);

  let colorTex;
  if (real) {
    colorTex = realTex;
    colorTex.colorSpace = THREE.SRGBColorSpace;
  } else {
    colorTex = new THREE.CanvasTexture(makeMoonTexture(2048));
    colorTex.colorSpace = THREE.SRGBColorSpace;
  }
  colorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const bumpTex = new THREE.CanvasTexture(makeBumpTexture(1024));

  const moonMat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: real ? 0.55 : 0.42,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.2,
  });
  // 球面边缘变暗（limb darkening）：满月时也能一眼看出这是个球而不是平贴图
  // 注入点必须在 outgoingLight 已定义之后，否则 shader 编译失败、月球直接不渲染
  moonMat.onBeforeCompile = (shader) => {
    const inject = `
{
  float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight *= mix(0.5, 1.0, pow(ndv, 0.3));
}
`;
    const markers = ['#include <opaque_fragment>', '#include <output_fragment>'];
    for (const m of markers) {
      if (shader.fragmentShader.includes(m)) {
        shader.fragmentShader = shader.fragmentShader.replace(m, inject + m);
        return;
      }
    }
    console.warn('月球边缘暗化注入失败：找不到输出片元标记');
  };
  moonMat.customProgramCacheKey = () => 'moon-limb-darkening';

  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), moonMat);
  moon.rotation.y = -Math.PI / 2;
  scene.add(moon);

  // 月晕（在月球背后，满月时更亮更大）
  const glowTex = new THREE.CanvasTexture(makeGlowTexture(512));
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    })
  );
  glow.position.set(0, 0, -1.6);
  glow.scale.setScalar(3.2);
  scene.add(glow);

  // ── 光照 ──
  const sun = new THREE.DirectionalLight(0xfff4dc, 3.2);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8fa6ff, 0.05)); // 环境光当“地照”
  scene.add(new THREE.HemisphereLight(0x2a3a7a, 0x0a0a1a, 0.12));

  // ── 星空 ──
  scene.add(makeStars());
  scene.add(makeMilkyWay());

  // ── 后期辉光（失败则退回直接渲染）──
  let composer = null;
  try {
    const [ec, rp, ub, op] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
    composer = new ec.EffectComposer(renderer);
    composer.addPass(new rp.RenderPass(scene, camera));
    const bloom = new ub.UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth || 512, canvas.clientHeight || 512),
      0.5,  // strength
      0.62, // radius
      0.78  // threshold：只让月亮亮部溢光
    );
    composer.addPass(bloom);
    composer.addPass(new op.OutputPass());
  } catch (err) {
    console.warn('辉光后期不可用，已退回直接渲染：', err);
    composer = null;
  }

  let disposed = false;
  let t0 = performance.now();

  function makeStars() {
    const g = new THREE.Group();
    const layer = (count, radius, size, opacity, colorFn) => {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const R = radius + Math.random() * 30;
        pos[i * 3] = Math.cos(a) * s * R;
        pos[i * 3 + 1] = u * R;
        pos[i * 3 + 2] = Math.sin(a) * s * R;
        colorFn(c);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      g.add(new THREE.Points(geo, mat));
    };
    layer(1400, 70, 0.34, 0.75, (c) => c.setHSL(0.55 + Math.random() * 0.12, 0.25, 0.72 + Math.random() * 0.28));
    layer(120, 45, 0.72, 0.95, (c) => c.setHSL(0.09 + Math.random() * 0.1, 0.35, 0.85));
    return g;
  }

  function makeMilkyWay() {
    const count = 900;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const t = Math.random() * 2 - 1;
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.22;
      const R = 80 + Math.random() * 20;
      const a = t * Math.PI * 0.9;
      pos[i * 3] = Math.cos(a) * Math.cos(spread) * R;
      pos[i * 3 + 1] = Math.sin(spread) * R * 0.9 + Math.sin(a) * 3;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(spread) * R;
      c.setHSL(0.58, 0.3, 0.55 + Math.random() * 0.3);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.42,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const p = new THREE.Points(geo, mat);
    p.rotation.z = 0.5;
    return p;
  }

  // 按画框比例自动取景：宽扁的大框里也让月亮占满合适比例
  function fitCamera() {
    const aspect = camera.aspect || 1;
    const halfTan = Math.tan((camera.fov * Math.PI) / 180 / 2);
    const dH = 2.0 / (0.84 * 2 * halfTan);
    const dW = 2.0 / (0.68 * 2 * halfTan * aspect);
    camera.position.set(0, 0, Math.max(dH, dW));
    camera.lookAt(0, -0.04, 0);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
    if (composer) composer.setSize(w, h);
  }

  function setSunDirection(dir, fraction = 1) {
    sun.position.set(dir.x * 30, dir.y * 30, dir.z * 30);
    // 月晕随月相变化：满月最盛，新月几乎不发光
    const f = Math.max(0, Math.min(1, fraction));
    glow.material.opacity = 0.16 + 0.4 * Math.pow(f, 1.3);
    glow.scale.setScalar(2.9 + 0.5 * f);
  }

  function render() {
    if (disposed) return;
    const t = (performance.now() - t0) / 1000;
    // 天平动：极缓慢的摆动，让画面不死板
    moon.rotation.y = -Math.PI / 2 + Math.sin(t * 0.08) * 0.07;
    moon.rotation.x = Math.sin(t * 0.05) * 0.03;
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  function snapshot() {
    render();
    return renderer.domElement.toDataURL('image/png');
  }

  function dispose() {
    disposed = true;
    renderer.dispose();
  }

  return { resize, render, setSunDirection, snapshot, dispose, usingRealTexture: real };
}
