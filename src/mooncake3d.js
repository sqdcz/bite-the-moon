// mooncake3d.js —— 3D 月饼（配方驱动版）
//
// 只有一个几何体：把「月饼的截面形状」沿高度拉伸成实心柱体
//   ExtrudeGeometry(shape, { depth }) → 形状在 XZ 平面，沿 Y 拉伸
//   形状本身就是被咬过的轮廓，所以咬口处的断面是实心的平面，不是空壳
//
// 一个 shader 负责给各个面分区上色（靠几何局部法线与半径判断）：
//   法线朝上          → 顶面，采样压花贴图
//   法线朝下          → 底面，烤得最深
//   法线水平 且 r≈1   → 外壁，烘焙色渐变（底深 → 中部最亮 → 靠饼面回深）
//   法线水平 且 r<1   → 咬口面 / 切开断面，按半径与高度画 皮 / 馅 / 蛋黄
//
// 咬口几何：双圆月牙
//   用一个与月饼等半径的「咬痕圆」沿 u 轴负方向咬进去，落在咬痕圆内的部分被 discard。
//   两圆等半径时的差集正好是一枚月牙，而且随圆心距连续变化 —— 这是关键。
//   早先用的是椭圆终止线模型 (u ≥ −k·√(1−v²))：它在圆盘上没问题，但圆柱面上
//   bpx² + bpy² ≡ 1，判据退化成恒等式，k 从 1 略减就会把整个左半边侧壁切光，
//   满月时又因浮点误差随机 discard，渲出一片细纹。双圆模型没有这个退化。
//
// 配方参数如何影响画面：
//   克重      → 整体缩放（重量正比于体积，所以按立方根缩放）
//   皮馅比    → 断面上皮层的厚度
//   蛋黄      → 断面上蛋黄的数量与直径
//   馅料种类  → 断面填充色
//   月相      → 咬口深度（咬掉面积 = 暗面比例）
//   切开开关  → 沿视线方向切掉靠镜头的一半，露出剖面

import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMooncakeTopTexture, makeShadowTexture, makeEnvTexture } from './texture.js';

const H = 0.72;                        // 月饼厚度（厚径比约 0.36，接近实物的 0.35~0.4）
const R = 1.0;                         // 月饼半径
const PITCH = (34 * Math.PI) / 180;    // 常规俯角
const PITCH_CUT = (14 * Math.PI) / 180;// 切开看剖面时压低角度，让断面正对镜头

// 皮馅比（重量比≈体积比）→ 皮厚 t：解 1 − (1−t)²(H−2t)/H = ratio（二分法）
// 直接用立方根那种粗估会把皮算厚一倍，断面上就变成"厚皮小馅"了
function crustThickness(ratio) {
  const target = 1 - Math.min(0.9, Math.max(0.02, ratio));
  let lo = 0;
  let hi = Math.min(0.4, H / 2 - 0.02);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const inner = ((1 - mid) ** 2 * (H - 2 * mid)) / H;
    if (inner > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 亮面比例 → 咬痕圆的圆心距 D
// 两圆等半径 R=1、圆心距 D 时的交集面积：A(D) = 2·acos(D/2) − (D/2)·√(4 − D²)
// 要求 A = (1 − fraction)·π（咬掉的正是暗面那份），二分反解 D。
//   D = 2 → 两圆外切，交集 0 → 满月，月饼完整
//   D = 0 → 两圆重合，交集 π → 新月，月饼全没
function biteD(fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  const target = Math.PI * (1 - f);
  let lo = 0;
  let hi = 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const a = 2 * Math.acos(mid / 2) - (mid / 2) * Math.sqrt(Math.max(0, 4 - mid * mid));
    if (a > target) lo = mid; // 交集偏大 → 圆心距要更大
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 月饼截面 = 月饼圆 − 咬痕圆（两圆等半径，圆心距 D）
//   交点横坐标 x0 = −D/2，纵坐标 ±√(1 − D²/4)
//   边界 = 月饼圆的右侧弧 + 咬痕圆的右侧弧（向后凹），合起来就是月牙
// 切开模式下直接取左半圆（正好是被半空间 u ≤ 0 裁掉的那半）
function buildShape(D, halfCut) {
  const shape = new THREE.Shape();
  if (halfCut) {
    shape.absarc(0, 0, R, Math.PI / 2, Math.PI * 1.5, false);
    shape.closePath();
    return shape;
  }
  const cl = Math.min(0.9999, Math.max(-0.9999, D / 2));
  const phi = Math.acos(-cl); // 月饼圆上的交点角
  const beta = Math.acos(cl); // 咬痕圆上的交点角
  shape.absarc(0, 0, R, -phi, phi, false);            // 月饼圆：右弧
  shape.absarc(-D * R, 0, R, beta, -beta, true);      // 咬痕圆：凹弧
  shape.closePath();
  return shape;
}

function loadTopTexture(loader) {
  return new Promise((resolve) => {
    loader.load(
      './assets/mooncake_top.png',
      (tex) => resolve({ tex, real: true }),
      undefined,
      () => resolve({ tex: null, real: false })
    );
  });
}

export async function createMooncakeScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

  const group = new THREE.Group();
  scene.add(group);

  // 环境反射：给饼皮一点光泽，别像塑料
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCanvas = new THREE.CanvasTexture(makeEnvTexture(512));
  envCanvas.mapping = THREE.EquirectangularReflectionMapping;
  envCanvas.colorSpace = THREE.SRGBColorSpace;
  scene.environment = pmrem.fromEquirectangular(envCanvas).texture;
  scene.environmentIntensity = 0.75;

  // 参数状态存在外面：着色器可能晚于第一次 setParams 才编译，编译时再同步
  const state = {
    cutD: 2,       // 咬痕圆圆心距（2 = 不咬）
    angle: 0,      // 咬口方向
    halfCut: false,// 切开看剖面
    crustT: crustThickness(0.3),
    yolkN: 1,
    yolkR: 0.3,
    fill: new THREE.Color(0x8a4d22),
    scale: 1,
  };

  // ── 顶面压花贴图 ──
  const loader = new THREE.TextureLoader();
  const { tex: realTop, real } = await loadTopTexture(loader);

  let topTex;
  if (real) {
    topTex = realTop;
  } else {
    topTex = new THREE.CanvasTexture(makeMooncakeTopTexture(1024));
  }
  topTex.colorSpace = THREE.SRGBColorSpace;
  topTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // ExtrudeGeometry 的顶面 UV 直接就是形状坐标（范围 ±R），这里把它映射到
  // 贴图中心那块 84% 的区域：uv' = uv·0.42 + 0.5。
  // v 轴取负号是因为纹理默认 flipY，不翻的话图案会上下颠倒。
  topTex.center.set(0, 0);
  topTex.repeat.set(0.42, -0.42);
  topTex.offset.set(0.5, 0.5);

  // ── 材质：一个 shader 管所有面 ──
  const mat = new THREE.MeshStandardMaterial({
    map: topTex,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.88,
    side: THREE.DoubleSide, // 切开后能看到内壁
  });

  const Y = (v) => v.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFill = { value: state.fill.clone() };
    shader.uniforms.uCrust = { value: new THREE.Color(0xd8a45c) };
    shader.uniforms.uCrustBot = { value: new THREE.Color(0x8a5620) };
    shader.uniforms.uYolk = { value: new THREE.Color(0xeb9a2e) };
    shader.uniforms.uCrustT = { value: state.crustT };
    shader.uniforms.uYolkN = { value: state.yolkN };
    shader.uniforms.uYolkR = { value: state.yolkR };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLocalPos;\nvarying vec3 vLocalNormal;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLocalPos = position;\nvLocalNormal = normal;'
      );

    // 咬口和切开都已经体现在几何形状里了（形状就是被咬过的轮廓），
    // 所以这里不需要再做 discard —— 早先两处都裁，形状和 shader 各切一次，
    // 切开模式就只剩四分之一圆，画面偏到一边去。
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
uniform vec3 uFill;
uniform vec3 uCrust;
uniform vec3 uCrustBot;
uniform vec3 uYolk;
uniform float uCrustT;
uniform float uYolkN;
uniform float uYolkR;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
// 按面的朝向与半径分区上色。顶面保留上面刚采样到的压花贴图。
{
  float ny = vLocalNormal.y;
  float r = length(vLocalPos.xz);

  if (ny < -0.55) {
    // 底面：烤得最深，几乎不反光
    diffuseColor.rgb = uCrustBot;
  } else if (ny < 0.55) {
    bool onWall = r > ${Y(R)} - 0.02;
    if (onWall) {
      // 外壁：烘焙色渐变（底深 → 中部最亮 → 靠饼面一圈烤痕）
      float ty = clamp((vLocalPos.y + ${Y(H / 2)}) / ${Y(H)}, 0.0, 1.0);
      vec3 c = mix(vec3(0.52, 0.32, 0.13), vec3(0.835, 0.635, 0.375), smoothstep(0.0, 0.55, ty));
      c = mix(c, vec3(0.63, 0.40, 0.165), smoothstep(0.68, 1.0, ty));
      diffuseColor.rgb = c;
    } else {
      // 咬口面 / 切开断面：馅料底 → 蛋黄椭球截面 → 饼皮
      vec3 c = uFill;
      float best = 1e9;
      // 多个蛋黄沿 z 轴排开，间距按馅料区的可用宽度自适应 ——
      // 固定间距会让最外侧的蛋黄被塞进饼皮里（3 个时特别明显）
      float span = max(0.0, 2.0 * (${Y(R)} - uCrustT) * 0.98 - 2.0 * uYolkR);
      float spacing = span / max(1.0, uYolkN - 1.0);
      for (int i = 0; i < 3; i++) {
        if (float(i) >= uYolkN) break;
        float off = (float(i) - (uYolkN - 1.0) * 0.5) * spacing;
        // 排开方向必须用 z 轴：切开时断面正好落在 x = 0 平面上，
        // 之前拿 x 做偏移，蛋黄在这个平面上永远解不出来，怎么调都不显示。
        // 咸蛋黄是扁球：水平半径 uYolkR，竖直半径约其 45%
        vec3 d = vec3(vLocalPos.z - off, vLocalPos.y / 0.45, vLocalPos.x);
        best = min(best, dot(d, d) / (uYolkR * uYolkR));
      }
      if (best < 1.0) {
        c = mix(uYolk, uYolk * 0.68, smoothstep(0.5, 1.0, best));
      }
      // 饼皮：均匀厚度包住馅，所以外圈靠半径判断、上下靠高度判断
      bool isCrust = (r > ${Y(R)} - uCrustT)
        || (vLocalPos.y < ${Y(-H / 2)} + uCrustT)
        || (vLocalPos.y > ${Y(H / 2)} - uCrustT);
      if (isCrust) c = uCrust;
      diffuseColor.rgb = c;
    }
  }
  // 顶面（ny ≥ 0.55）：保持压花贴图的采样结果不动
}`
      );

    mat.userData.shader = shader;
  };

  let cake = null;

  function rebuild() {
    if (cake) {
      group.remove(cake);
      cake.geometry.dispose();
      cake = null;
    }
    // 咬痕圆几乎与月饼重合（新月）时形状退化成一条线，直接不生成
    if (!state.halfCut && state.cutD < 0.06) return;
    // 不开 bevel：倒角面既会被 shader 误判成顶面（采样到贴图的深色背景，形成一圈黑缝），
    // 又会在圆弧上生成重叠面产生条纹。平顶圆柱反而干净，边缘的利落感更像模具压出来的。
    const geo = new THREE.ExtrudeGeometry(buildShape(state.cutD, state.halfCut), {
      depth: H,
      bevelEnabled: false,
      curveSegments: 48,
    });
    // 形状在 XY 平面、沿 +Z 拉伸 → 转成「形状在 XZ 平面、沿 +Y 拉伸」
    geo.rotateX(Math.PI / 2);
    geo.translate(0, H / 2, 0);
    // ExtrudeGeometry 的侧壁各三角形不共享顶点，法线是逐面算的，
    // 圆的侧壁会显出一圈可见的棱。toCreasedNormals 焊接顶点、只在超过阈值的
    // 折痕处断开法线：侧壁变光滑，顶面/侧壁的交界仍是干净的直角。
    const smooth = toCreasedNormals(geo, Math.PI / 5);
    geo.dispose();
    cake = new THREE.Mesh(smooth, mat);
    cake.rotation.y = state.angle;
    group.add(cake);
  }

  // 接触阴影
  const shadowTex = new THREE.CanvasTexture(makeShadowTexture(256));
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.68 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -H / 2 - 0.05; // 留足间距，否则和月饼底面贴太近会 z-fighting
  scene.add(shadow);

  // 灯光：侧上方暖主光 + 冷补光 + 半球环境
  const key = new THREE.DirectionalLight(0xfff1d2, 1.45);
  key.position.set(2.8, 3.2, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x93a8ff, 0.5);
  rim.position.set(-2.8, 1.0, -2.0);
  scene.add(rim);
  // 环境补光给足：主光太强会在光滑圆柱上切出一条硬边，看着像两半拼的
  scene.add(new THREE.HemisphereLight(0xffe6bb, 0x241d3c, 0.8));

  let disposed = false;
  const t0 = performance.now();

  // 按画框比例自动取景：月饼尽量大又不溢出（宽扁画框也适用）
  function fitCamera() {
    const aspect = camera.aspect || 1;
    const halfTan = Math.tan((camera.fov * Math.PI) / 180 / 2);
    const s = state.scale;
    // 切开后只剩远离镜头的半，画面重心偏后，目标点要跟着移过去
    const targetZ = (state.halfCut ? -0.5 : 0) * s;
    const pitch = state.halfCut ? PITCH_CUT : PITCH;
    // 屏幕竖直方向的投影 = 高度×cos + 纵深×sin。
    // 之前把这两个乘反了（纵深×cos + 高度×sin），所以取景一直偏松，靠经验系数硬补。
    const depthZ = (state.halfCut ? 1.0 : 2.0) * s;
    const projH = H * s * Math.cos(pitch) + depthZ * Math.sin(pitch);
    const projW = 2 * R * s;
    const margin = 0.82;
    const dH = projH / (margin * 2 * halfTan);
    const dW = projW / (margin * 2 * halfTan * aspect);
    const d = Math.max(dH, dW);
    camera.position.set(0, d * Math.sin(pitch), targetZ + d * Math.cos(pitch));
    camera.lookAt(0, 0, targetZ);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  /**
   * @param {object} p
   * @param {number} p.fraction   亮面比例（决定咬掉多少）
   * @param {number} p.angle      咬口朝向（跟月亮亮面朝向一致）
   * @param {boolean} p.cut       是否切开看剖面
   * @param {number} p.weight     单个重量（g）
   * @param {number} p.crustRatio 皮占比
   * @param {boolean} p.yolkOn
   * @param {number} p.yolkPer
   * @param {number} p.yolkWeight 单个蛋黄克重
   * @param {number} p.fillColor  馅料颜色（hex）
   */
  function setParams(p) {
    state.halfCut = !!p.cut;
    if (p.cut) {
      state.cutD = 2; // 切开时不咬，露出完整剖面
      // 让 u 轴对齐世界 +z，于是被切掉的是靠镜头那半，断面正对相机
      state.angle = -Math.PI / 2;
    } else {
      state.cutD = biteD(p.fraction);
      state.angle = p.angle;
    }
    rebuild();

    // 克重 → 大小（重量正比体积 → 立方根）
    state.scale = Math.min(1.32, Math.max(0.74, Math.cbrt((p.weight || 75) / 75)));
    group.scale.setScalar(state.scale);
    shadow.scale.setScalar(state.scale);
    fitCamera();

    // 皮馅比 → 断面皮层厚度
    state.crustT = crustThickness(p.crustRatio ?? 0.3);

    // 蛋黄 → 个数与直径（12g 咸蛋黄直径约为月饼直径的 45%）
    state.yolkN = p.yolkOn ? Math.max(1, Math.min(3, p.yolkPer || 1)) : 0;
    state.yolkR = Math.min(0.42, Math.max(0.18, ((p.yolkWeight || 12) / 12) ** (1 / 3) * 0.3));

    // 馅料 → 断面颜色
    if (p.fillColor != null) state.fill.setHex(p.fillColor);

    const sh = mat.userData.shader;
    if (sh) {
      sh.uniforms.uFill.value.copy(state.fill);
      sh.uniforms.uCrustT.value = state.crustT;
      sh.uniforms.uYolkN.value = state.yolkN;
      sh.uniforms.uYolkR.value = state.yolkR;
    }
  }

  function render() {
    if (disposed) return;
    const t = (performance.now() - t0) / 1000;
    // 轻微浮动与摇摆：有生命感，又不破坏咬口与月相的朝向同步
    group.position.y = Math.sin(t * 0.9) * 0.02;
    group.rotation.z = Math.sin(t * 0.55) * 0.02;
    group.rotation.x = Math.sin(t * 0.4 + 1) * 0.014;
    renderer.render(scene, camera);
  }

  function snapshot() {
    render();
    return renderer.domElement.toDataURL('image/png');
  }

  function dispose() {
    disposed = true;
    renderer.dispose();
  }

  rebuild();
  fitCamera();

  return {
    resize,
    render,
    setParams,
    snapshot,
    dispose,
    usingRealTexture: real,
    // 调试用：可单独隐藏某个部件来定位渲染问题
    parts: {
      body: () => cake,
      shadow: () => shadow,
      group,
      scene,
    },
  };
}
