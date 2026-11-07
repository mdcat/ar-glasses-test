import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ─────────────────────────────────────────────────────────────
// 설정값: 착용 위치가 어색하면 여기 숫자만 조정하면 됩니다.
// 모델 단위는 미터(m). 원점 = 브릿지(코받침 위) 중앙, 렌즈 면.
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  modelUrl: './models/sunglasses.glb',
  wasmBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  faceModel: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  eyeCornerDistM: 0.095,          // 평균 양쪽 눈꼬리 거리(m). 키우면 안경이 작아짐
  offset: [0, -0.004, 0.006],     // 미간(랜드마크 168) 기준 안경 위치 보정 (x, y, z) m
  tiltDeg: 0,                     // 앞으로 살짝 숙인 각도(실제 안경처럼)
  smoothing: 0.45,                // 0~1, 낮을수록 부드럽고 높을수록 즉각적
  // 안경다리가 머리 뒤로 숨도록 하는 보이지 않는 머리 모양(타원체)
  occluder: { center: [0, -0.012, -0.1], radius: [0.08, 0.11, 0.098] },
  debug: new URLSearchParams(location.search).has('debug'),
};

// 같은 glb 모델에 색상만 바꾼 스타일. 다른 glb를 쓰고 싶으면 url 항목을 추가하세요.
const STYLES = [
  { id: 'brown', name: '다크 브라운', frame: { color: 0x2b1a12, roughness: 0.28 }, lens: { color: 0x2a2018, opacity: 0.55 } },
  { id: 'black', name: '매트 블랙', frame: { color: 0x121212, roughness: 0.65 }, lens: { color: 0x1a1d22, opacity: 0.62 } },
  { id: 'crystal', name: '크리스탈 그레이', frame: { color: 0x8d939b, roughness: 0.15, opacity: 0.6 }, lens: { color: 0x30363d, opacity: 0.45 } },
  { id: 'amber', name: '앰버', frame: { color: 0x6e3f17, roughness: 0.22, opacity: 0.9 }, lens: { color: 0x5a3a12, opacity: 0.45 } },
];

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('gl'), statusEl = $('status'), hintEl = $('hint');

function setStatus(text, kind = '') { statusEl.textContent = text; statusEl.className = 'pill ' + kind; }
function showError(text) { const e = $('err'); e.textContent = text; e.hidden = false; $('start').disabled = false; $('start').textContent = '다시 시도'; }

// ── Three.js 장면 ───────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(0.3, 1, 1); scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

// 화면 픽셀 좌표계 그대로 쓰는 직교 카메라 (x 오른쪽, y 위, z 카메라 쪽)
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 40000);
camera.position.z = 20000;

const anchor = new THREE.Group();     // 얼굴 위치/회전/크기를 받는 그룹
const fit = new THREE.Group();        // 모델 미세 보정(오프셋, 기울기)
anchor.add(fit); scene.add(anchor);
anchor.visible = false;
fit.position.fromArray(CONFIG.offset);
fit.rotation.x = THREE.MathUtils.degToRad(CONFIG.tiltDeg);

// 머리 가림막: 색은 그리지 않고 깊이만 기록 → 뒤쪽 안경다리가 자연스럽게 가려짐
const occluder = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 24),
  CONFIG.debug ? new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true })
               : new THREE.MeshBasicMaterial({ colorWrite: false })
);
occluder.position.fromArray(CONFIG.occluder.center);
occluder.scale.fromArray(CONFIG.occluder.radius);
occluder.renderOrder = -1;
anchor.add(occluder);

let frameMats = [], lensMats = [];
async function loadGlasses() {
  const gltf = await new GLTFLoader().loadAsync(CONFIG.modelUrl);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.name === 'TintedLens') { lensMats.push(o.material); o.renderOrder = 2; }
    else { frameMats.push(o.material); o.renderOrder = 1; }
  });
  fit.add(gltf.scene);
}

function applyStyle(style) {
  for (const m of frameMats) {
    m.color.setHex(style.frame.color); m.roughness = style.frame.roughness;
    const op = style.frame.opacity ?? 1; m.transparent = op < 1; m.opacity = op; m.needsUpdate = true;
  }
  for (const m of lensMats) { m.color.setHex(style.lens.color); m.opacity = style.lens.opacity; m.transparent = true; m.needsUpdate = true; }
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === style.id)));
}

function buildChips() {
  const wrap = $('chips');
  for (const s of STYLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.id = s.id; b.setAttribute('aria-pressed', 'false');
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    b.innerHTML = `<span class="sw" style="background:${hex(s.frame.color)}"><i style="background:${hex(s.lens.color)};opacity:${0.4 + s.lens.opacity * 0.6}"></i></span><span></span>`;
    b.lastChild.textContent = s.name;
    b.addEventListener('click', () => applyStyle(s));
    wrap.appendChild(b);
  }
}

// ── 얼굴 추적 ───────────────────────────────────────────────
let landmarker;
async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(CONFIG.wasmBase);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: CONFIG.faceModel, delegate },
    runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true,
  });
  try { return { lm: await FaceLandmarker.createFromOptions(fileset, opts('GPU')), mode: 'GPU' }; }
  catch (e) { console.warn('GPU 모드 실패, CPU로 전환', e); return { lm: await FaceLandmarker.createFromOptions(fileset, opts('CPU')), mode: 'CPU' }; }
}

async function startCamera() {
  if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('nomedia'), { name: 'NoMedia' });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
}

function resize() {
  const w = video.videoWidth, h = video.videoHeight;
  renderer.setSize(w, h, false);
  camera.left = 0; camera.right = w; camera.top = 0; camera.bottom = -h;
  camera.updateProjectionMatrix();
}

// ── 매 프레임 ───────────────────────────────────────────────
const M = new THREE.Matrix4(), qT = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const posT = new THREE.Vector3();
let lastVideoTime = -1, hasPose = false, lostFrames = 0;
let fpsT = performance.now(), fpsN = 0, mode = '';

function lmPx(lm, i, w, h) { return new THREE.Vector3(lm[i].x * w, -lm[i].y * h, -lm[i].z * w); }

function tick() {
  requestAnimationFrame(tick);
  if (video.readyState < 2) return;
  if (video.videoWidth !== renderer.domElement.width / renderer.getPixelRatio()) resize();

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    const w = video.videoWidth, h = video.videoHeight;
    if (res.faceLandmarks?.length && res.facialTransformationMatrixes?.length) {
      const lm = res.faceLandmarks[0];
      const L = lmPx(lm, 33, w, h), R = lmPx(lm, 263, w, h), mid = lmPx(lm, 168, w, h);
      const scale = L.distanceTo(R) / CONFIG.eyeCornerDistM;    // 픽셀/미터
      M.fromArray(res.facialTransformationMatrixes[0].data);
      M.decompose(_p, qT, _s);
      posT.copy(mid);

      if (!hasPose) { anchor.position.copy(posT); anchor.quaternion.copy(qT); anchor.scale.setScalar(scale); hasPose = true; }
      else {
        // 크게 움직이면 즉시 따라가고, 작은 떨림은 걸러냄
        const move = anchor.position.distanceTo(posT) / scale;  // m 단위 이동량
        const a = Math.min(1, CONFIG.smoothing + move * 25);
        anchor.position.lerp(posT, a);
        anchor.quaternion.slerp(qT, a);
        anchor.scale.setScalar(THREE.MathUtils.lerp(anchor.scale.x, scale, a));
      }
      anchor.visible = true; lostFrames = 0; hintEl.hidden = true;
    } else if (++lostFrames > 5) {
      anchor.visible = false; hasPose = false; hintEl.hidden = false;
    }
    fpsN++;
  }
  renderer.render(scene, camera);

  const now = performance.now();
  if (now - fpsT > 1000) {
    const fps = Math.round((fpsN * 1000) / (now - fpsT)); fpsN = 0; fpsT = now;
    setStatus(anchor.visible ? `인식 중 · ${fps}fps · ${mode}` : `얼굴 찾는 중 · ${fps}fps`, anchor.visible ? 'ok' : 'warn');
  }
}

// ── 시작 ───────────────────────────────────────────────────
buildChips();
$('start').addEventListener('click', async () => {
  const btn = $('start'); btn.disabled = true; $('err').hidden = true;
  try {
    btn.textContent = '카메라 여는 중…';
    await startCamera();
    btn.textContent = '얼굴 인식 엔진 불러오는 중…';
    const [{ lm, mode: m }] = await Promise.all([createLandmarker(), frameMats.length ? null : loadGlasses()]);
    landmarker = lm; mode = m;
    applyStyle(STYLES[0]);
    resize();
    $('gate').hidden = true; $('bar').hidden = false;
    setStatus('얼굴 찾는 중', 'warn');
    tick();
  } catch (e) {
    console.error(e);
    const msg = {
      NotAllowedError: '카메라 권한이 거부되었습니다. 주소창의 권한 설정에서 카메라를 허용한 뒤 다시 시도해 주세요.',
      NotFoundError: '사용할 수 있는 카메라를 찾지 못했습니다.',
      NotReadableError: '다른 앱이 카메라를 사용 중입니다. 다른 앱을 닫고 다시 시도해 주세요.',
      InsecureContext: '카메라는 HTTPS 또는 localhost 주소에서만 열 수 있습니다.',
      NoMedia: '이 브라우저는 카메라 기능을 지원하지 않습니다.',
    }[e.name] || `시작하지 못했습니다: ${e.message || e}`;
    showError(msg);
  }
});

// 디버그용 노출 (콘솔에서 window.__ar 로 확인)
window.__ar = { anchor, CONFIG, get visible() { return anchor.visible; } };
