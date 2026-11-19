// Standalone Three.js and OrbitControls
const OrbitControls = THREE.OrbitControls;

// ============================================================
// DOM
// ============================================================
const viewport    = document.getElementById('viewport');
const uploadZone  = document.getElementById('uploadZone');
const fileInput   = document.getElementById('fileInput');
const profileZone = document.getElementById('profileZone');
const profileInput= document.getElementById('profileInput');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn    = document.getElementById('resetBtn');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const triCount    = document.getElementById('triCount');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTextEl  = document.getElementById('loadingText');
const shapeCylinder  = document.getElementById('shapeCylinder');
const shapeLantern   = document.getElementById('shapeLantern');
const shapeCustom    = document.getElementById('shapeCustom');
const shapeMatchPattern = document.getElementById('shapeMatchPattern');
const topHookToggle  = document.getElementById('topHookToggle');
let hookMesh         = null;

// Custom shape DOM
const customShapeSection = document.getElementById('customShapeSection');
const customShapeZone    = document.getElementById('customShapeZone');
const customShapeInput   = document.getElementById('customShapeInput');
const customShapeStatus  = document.getElementById('customShapeStatus');
const customThresholdEl  = document.getElementById('customThreshold');
const customThresholdVal = document.getElementById('customThresholdVal');
const customSmoothEl     = document.getElementById('customSmooth');
const customSmoothVal    = document.getElementById('customSmoothVal');

// Lithophane Relief DOM
const lanternLithoSection   = document.getElementById('lanternLithoSection');
const lithoEnable           = document.getElementById('lithoEnable');
const lithoZone             = document.getElementById('lithoZone');
const lithoInput            = document.getElementById('lithoInput');
const lithoStatus           = document.getElementById('lithoStatus');
const reliefSpan            = document.getElementById('reliefSpan');
const lithoFlatCanvas       = document.getElementById('lithoFlatCanvas');
const canvasPlaceholder     = document.getElementById('canvasPlaceholder');
const btnAddMoreLitho       = document.getElementById('btnAddMoreLitho');
const btnDeleteLithoLayer   = document.getElementById('btnDeleteLithoLayer');
const btnCenterLithoLayer   = document.getElementById('btnCenterLithoLayer');
const btnFitHeightLithoLayer= document.getElementById('btnFitHeightLithoLayer');
const btnClearAllLitho      = document.getElementById('btnClearAllLitho');
const lithoAddMoreInput     = document.getElementById('lithoAddMoreInput');
const lithoLayerInfo        = document.getElementById('lithoLayerInfo');
const layerNameText         = document.getElementById('layerNameText');
const layerDimText          = document.getElementById('layerDimText');
const layerPosText          = document.getElementById('layerPosText');
const lithoMinThick         = document.getElementById('lithoMinThick');
const lithoMinThickVal      = document.getElementById('lithoMinThickVal');
const lithoMaxThick         = document.getElementById('lithoMaxThick');
const lithoMaxThickVal      = document.getElementById('lithoMaxThickVal');
const lithoRepeat           = document.getElementById('lithoRepeat');
const lithoInvert           = document.getElementById('lithoInvert');

let activeExport = null;
let layerGeneration = 0;
let layerUploadQueue = Promise.resolve();
let lithoData = null; // { width, height, data: Uint8Array }
let lithoLayers = [];
let selectedLithoLayerId = null;
let nextLithoLayerId = 1;
const lithoCanvasOffscreen = document.createElement('canvas');

const S = {
  brightness:       { el: document.getElementById('brightness'),       vEl: document.getElementById('brightnessVal'),       fmt: v => `${parseFloat(v).toFixed(1)}x` },
  bulbHeight:       { el: document.getElementById('bulbHeight'),       vEl: document.getElementById('bulbHeightVal'),       fmt: v => `${v} mm` },
  diameter:         { el: document.getElementById('diameter'),         vEl: document.getElementById('diameterVal'),         fmt: v => `${v} mm` },
  height:           { el: document.getElementById('height'),           vEl: document.getElementById('heightVal'),           fmt: v => v === '0' ? '0 mm（模板）' : `${v} mm` },
  thickness:        { el: document.getElementById('thickness'),        vEl: document.getElementById('thicknessVal'),        fmt: v => `${parseFloat(v).toFixed(1)} mm` },
  shadowSize:       { el: document.getElementById('shadowSize'),       vEl: document.getElementById('shadowSizeVal'),       fmt: v => `${v} mm` },
  resolution:       { el: document.getElementById('resolution'),       vEl: document.getElementById('resolutionVal'),       fmt: v => v },
  upperShellHeight: { el: document.getElementById('upperShellHeight'), vEl: document.getElementById('upperShellHeightVal'), fmt: v => `${v} mm` },
  supportWidth:     { el: document.getElementById('supportWidth'),     vEl: document.getElementById('supportWidthVal'),     fmt: v => `${parseFloat(v).toFixed(1)} mm` },
  bottomHoleDiam:   { el: document.getElementById('bottomHoleDiam'),   vEl: document.getElementById('bottomHoleDiamVal'),   fmt: v => `${v} mm` },
  bottomThickness:  { el: document.getElementById('bottomThickness'),  vEl: document.getElementById('bottomThicknessVal'),  fmt: v => `${parseFloat(v).toFixed(1)} mm` },
};

// ============================================================
// State
// ============================================================
let uploadedFile = null;
let silhouetteMaskBlob = null;
let uploadEpoch = 0;
let profileFile  = null;
let imageData    = null;  // { width, height, data: Uint8Array grayscale }
let profileData  = null;  // Float32Array of radii (normalized 0-1)
let needsCameraFit = true;
let previewMesh  = null;
let debounce     = null;

// Custom shape state
let customShapeImageData = null; // raw dataUrl of uploaded shape for re-processing
let customShapeRadii     = null; // Float32Array(360) — normalized per-angle radius

// Match pattern state
let patternShapeRadii    = null; // Float32Array(360) — auto-extracted from shadow pattern
let patternProfileData   = null; // Float32Array — auto-extracted vertical profile from shadow pattern

// Match pattern DOM
const matchPatternSection = document.getElementById('matchPatternSection');
const matchPatternStatus  = document.getElementById('matchPatternStatus');

// ============================================================
// Three.js Scene
// ============================================================
const scene    = new THREE.Scene();
scene.background = new THREE.Color(0xd9e0d7);

const camera   = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
camera.position.set(0, 180, 250);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 40, 0);

let renderPending = false;
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    controls.update();
    renderer.render(scene, camera);
  });
}
controls.addEventListener('change', requestRender);

// Lights
const ptLight = new THREE.PointLight(0xfff4e0, 6, 2000, 0.3);
ptLight.castShadow = true;
const shadowSize = Math.min(2048, Math.floor(renderer.capabilities.maxTextureSize / 4));
ptLight.shadow.mapSize.set(shadowSize, shadowSize);
ptLight.shadow.bias = -0.00004;
ptLight.shadow.normalBias = 0.035;
ptLight.shadow.camera.near = 10;
ptLight.shadow.camera.far = 400;
ptLight.shadow.radius = 1.5;
scene.add(ptLight);
const ambLight = new THREE.AmbientLight(0x334466, 0.4);
scene.add(ambLight);
const studioLight = new THREE.DirectionalLight(0xfff2da, 0.74);
studioLight.position.set(-120, 180, 160);
scene.add(studioLight);

// Bulb indicator
const bulb = new THREE.Mesh(
  new THREE.SphereGeometry(2, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0xfff4e0 })
);
scene.add(bulb);

// Floor
const floorMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 });
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

// Wall (for wall projection)
const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.1, side: THREE.BackSide });
const wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(300, 300, 400, 64), wallMat);
wallMesh.position.y = 100;
wallMesh.receiveShadow = true;
wallMesh.visible = false;
scene.add(wallMesh);

const grid = new THREE.GridHelper(800, 40, 0x1a2440, 0x111827);
grid.material.transparent = true;
grid.material.opacity = 0.22;
grid.material.depthWrite = false;
scene.add(grid);

function updateLightPos() {
  const brightness = parseFloat(S.brightness.el.value);
  const bulbH = parseFloat(S.bulbHeight.el.value);
  ptLight.position.set(0, bulbH, 0);
  ptLight.intensity = brightness * 2;
  ptLight.distance = 600 + brightness * 200;
  ambLight.intensity = 0.2 + brightness * 0.08;
  renderer.shadowMap.needsUpdate = true;
  requestRender();
  bulb.position.copy(ptLight.position);
  bulb.scale.setScalar(0.5 + brightness * 0.3);
}
updateLightPos();

// ============================================================
// Resize & Loop
// ============================================================
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  requestRender();
}
resize();
new ResizeObserver(resize).observe(viewport);


// ============================================================
// Shell shape toggle
// ============================================================
shapeCylinder.addEventListener('change', () => { profileZone.style.display = 'none'; updateVisibility(); scheduleUpdate(); });
if (shapeLantern) shapeLantern.addEventListener('change', () => { profileZone.style.display = 'none'; updateVisibility(); scheduleUpdate(); });
shapeCustom.addEventListener('change',  () => { profileZone.style.display = ''; updateVisibility(); scheduleUpdate(); });
shapeMatchPattern.addEventListener('change', () => { profileZone.style.display = 'none'; updateVisibility(); scheduleUpdate(); });
if (topHookToggle) topHookToggle.addEventListener('change', scheduleUpdate);

// ============================================================
// 360° Unwrapped Lithophane Flat Canvas Studio
// ============================================================
function lanternReliefHeight() {
  const upperHeight = Number(S.upperShellHeight.el.value);
  if (!document.getElementById('projFloor').checked) return upperHeight;
  const lowerHeight = Math.max(0.1, Number(S.height.el.value));
  const bulbHeight = Number(S.bulbHeight.el.value);
  return upperHeight + Math.max(0, lowerHeight - bulbHeight);
}

function updateLayerInfoBadge(layer, circ, upperH) {
  if (!lithoLayerInfo) return;
  if (!layer) {
    lithoLayerInfo.style.display = 'none';
    return;
  }
  lithoLayerInfo.style.display = 'flex';
  if (layerNameText) layerNameText.textContent = layer.name;
  const wMm = (layer.w * circ).toFixed(1);
  const hMm = (layer.h * upperH).toFixed(1);
  const angleDeg = Math.round(((layer.x % 1 + 1) % 1) * 360);
  if (layerDimText) layerDimText.textContent = `宽: ${wMm}mm | 高: ${hMm}mm`;
  if (layerPosText) layerPosText.textContent = `位置: ${angleDeg}°`;
}

function renderLithoFlatCanvas(extractBuffer = true) {
  if (!lithoFlatCanvas) return;

  const R = parseFloat(S.diameter.el.value) / 2;
  const upperH = lanternReliefHeight();
  if (reliefSpan) reliefSpan.textContent = Number(upperH.toFixed(1)) + ' mm';
  const circ = 2 * Math.PI * R;
  const aspect = circ / Math.max(upperH, 1);
  const W = 1024;
  const H = Math.round(Math.max(160, Math.min(384, W / aspect)));

  if (lithoFlatCanvas.width !== W || lithoFlatCanvas.height !== H) {
    lithoFlatCanvas.width = W;
    lithoFlatCanvas.height = H;
  }
  if (lithoCanvasOffscreen.width !== W || lithoCanvasOffscreen.height !== H) {
    lithoCanvasOffscreen.width = W;
    lithoCanvasOffscreen.height = H;
  }

  // 1. Offscreen PURE composite (pure white base + all layers)
  const offCtx = lithoCanvasOffscreen.getContext('2d');
  offCtx.imageSmoothingQuality = 'high';
  offCtx.fillStyle = '#ffffff';
  offCtx.fillRect(0, 0, W, H);

  for (const layer of lithoLayers) {
    drawLayerToContext(offCtx, layer, W, H);
  }

  // 2. Extract grayscale buffer for 3D preview & STL
  if (extractBuffer && lithoLayers.length > 0) {
    const pixels = offCtx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < gray.length; i++) gray[i] = pixels[i * 4];
    lithoData = { width: W, height: H, data: gray };
  } else if (!lithoLayers.length) {
    lithoData = null;
  }

  // 3. Visible canvas rendering
  const ctx = lithoFlatCanvas.getContext('2d');
  ctx.drawImage(lithoCanvasOffscreen, 0, 0);

  // Subtle 360° guide lines (0°, 90°, 180°, 270°, 360°)
  ctx.save();
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let frac of [0.25, 0.50, 0.75]) {
    const gx = Math.round(frac * W);
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, H);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, Math.round(H / 2));
  ctx.lineTo(W, Math.round(H / 2));
  ctx.stroke();
  ctx.restore();

  // Draw selection box & 8 handles around selected layer
  const selLayer = lithoLayers.find(l => l.id === selectedLithoLayerId);
  if (selLayer) {
    drawLayerSelection(ctx, selLayer, W, H);
  }

  // Update UI controls state
  if (canvasPlaceholder) {
    canvasPlaceholder.style.display = lithoLayers.length > 0 ? 'none' : 'flex';
  }
  if (btnDeleteLithoLayer) btnDeleteLithoLayer.disabled = !selLayer;
  if (btnCenterLithoLayer) btnCenterLithoLayer.disabled = !selLayer;
  if (btnFitHeightLithoLayer) btnFitHeightLithoLayer.disabled = !selLayer;
  updateLayerInfoBadge(selLayer, circ, upperH);
}

function drawLayerToContext(ctx, layer, W, H) {
  const lx = layer.x * W;
  const ly = layer.y * H;
  const lw = layer.w * W;
  const lh = layer.h * H;
  ctx.drawImage(layer.canvas, lx, ly, lw, lh);
  if (lx + lw > W) ctx.drawImage(layer.canvas, lx - W, ly, lw, lh);
}

function drawLayerSelection(ctx, layer, W, H) {
  const lx = layer.x * W;
  const ly = layer.y * H;
  const lw = layer.w * W;
  const lh = layer.h * H;

  function drawBox(bx, by) {
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(bx, by, lw, lh);
    ctx.setLineDash([]);

    const hs = 10;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;

    const points = [
      { x: bx, y: by },               // tl
      { x: bx + lw / 2, y: by },      // t
      { x: bx + lw, y: by },          // tr
      { x: bx + lw, y: by + lh / 2 }, // r
      { x: bx + lw, y: by + lh },     // br
      { x: bx + lw / 2, y: by + lh }, // b
      { x: bx, y: by + lh },          // bl
      { x: bx, y: by + lh / 2 }       // l
    ];

    for (const p of points) {
      ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  drawBox(lx, ly);
  if (lx + lw > W) drawBox(lx - W, ly);
}

function addLithoFiles(files) {
  const generation = layerGeneration;
  const picked = Array.from(files);
  layerUploadQueue = layerUploadQueue.then(async () => {
    for (const file of picked) {
      if (generation !== layerGeneration) return;
      try {
        await addLithoLayer(file, generation);
      } catch (error) {
        if (generation !== layerGeneration) return;
        lithoStatus.style.display = 'flex';
        lithoStatus.className = 'custom-shape-status error';
        lithoStatus.textContent = '无法读取图案 ' + file.name;
        console.warn('Relief image could not be loaded:', error);
      }
    }
  });
}

async function addLithoLayer(file, generation) {
  const image = await createImageBitmap(file);
  try {
    if (generation !== layerGeneration) return;
    const aspect = image.width / image.height;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const raster = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = raster.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
    }
    context.putImageData(raster, 0, 0);

    const last = lithoLayers.at(-1);
    const layerId = nextLithoLayerId++;
    const layer = { id: layerId, name: file.name, canvas, x: 0, y: 0, w: 1, h: 1 };
    if (last) {
      const circumference = Math.PI * Number(S.diameter.el.value);
      layer.h = 0.75;
      layer.w = Math.max(0.08, Math.min(0.7, layer.h * aspect * lanternReliefHeight() / circumference));
      layer.x = (last.x + last.w + 0.04) % 1;
      layer.y = (1 - layer.h) / 2;
    }
    lithoLayers.push(layer);
    selectedLithoLayerId = layerId;

    renderLithoFlatCanvas();
    lithoStatus.style.display = 'flex';
    lithoStatus.className = 'custom-shape-status success';
    lithoStatus.textContent = last ? '已添加图层。拖动图层或边框调整位置及大小。' : '已铺满 360° 浮雕区域。';
    scheduleUpdate();
  } finally {
    image.close();
  }
}

function getLithoCompositeBlob() {
  return new Promise((resolve) => {
    if (lithoLayers.length === 0) {
      resolve(null);
      return;
    }
    renderLithoFlatCanvas(true);
    lithoCanvasOffscreen.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
}

// Pointer event handlers for lithoFlatCanvas
let pointerAction = {
  mode: 'none',
  handle: null,
  startMouse: { x: 0, y: 0 },
  startLayer: { x: 0, y: 0, w: 0, h: 0 },
  targetLayerId: null
};

function getCanvasPointerPos(e) {
  const rect = lithoFlatCanvas.getBoundingClientRect();
  const scaleX = lithoFlatCanvas.width / rect.width;
  const scaleY = lithoFlatCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function hitTestLithoCanvas(px, py) {
  const W = lithoFlatCanvas.width;
  const H = lithoFlatCanvas.height;
  const hs = 14;

  const selLayer = lithoLayers.find(l => l.id === selectedLithoLayerId);
  if (selLayer) {
    const lx = selLayer.x * W;
    const ly = selLayer.y * H;
    const lw = selLayer.w * W;
    const lh = selLayer.h * H;

    for (const offset of lx + lw > W ? [0, -W] : [0]) {
      const bx = lx + offset;
      const by = ly;
      const handles = {
        tl: { x: bx, y: by },
        t:  { x: bx + lw / 2, y: by },
        tr: { x: bx + lw, y: by },
        r:  { x: bx + lw, y: by + lh / 2 },
        br: { x: bx + lw, y: by + lh },
        b:  { x: bx + lw / 2, y: by + lh },
        bl: { x: bx, y: by + lh },
        l:  { x: bx, y: by + lh / 2 }
      };
      for (const [hName, p] of Object.entries(handles)) {
        if (Math.abs(px - p.x) <= hs && Math.abs(py - p.y) <= hs) {
          return { type: 'resize', handle: hName, layer: selLayer };
        }
      }
    }
  }

  for (let i = lithoLayers.length - 1; i >= 0; i--) {
    const l = lithoLayers[i];
    const lx = l.x * W;
    const ly = l.y * H;
    const lw = l.w * W;
    const lh = l.h * H;
    for (const offset of lx + lw > W ? [0, -W] : [0]) {
      const bx = lx + offset;
      if (px >= bx && px <= bx + lw && py >= ly && py <= ly + lh) {
        return { type: l.id === selectedLithoLayerId ? 'move' : 'select', handle: null, layer: l };
      }
    }
  }

  return { type: 'none', handle: null, layer: null };
}

if (lithoFlatCanvas) {
  lithoFlatCanvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    const pos = getCanvasPointerPos(e);
    const hit = hitTestLithoCanvas(pos.x, pos.y);

    if (hit.type === 'resize') {
      pointerAction = {
        mode: 'resize',
        handle: hit.handle,
        startMouse: pos,
        startLayer: { x: hit.layer.x, y: hit.layer.y, w: hit.layer.w, h: hit.layer.h },
        targetLayerId: hit.layer.id
      };
      try { lithoFlatCanvas.setPointerCapture(e.pointerId); } catch (_) {}
    } else if (hit.type === 'move' || hit.type === 'select') {
      selectedLithoLayerId = hit.layer.id;
      pointerAction = {
        mode: 'move',
        handle: null,
        startMouse: pos,
        startLayer: { x: hit.layer.x, y: hit.layer.y, w: hit.layer.w, h: hit.layer.h },
        targetLayerId: hit.layer.id
      };
      try { lithoFlatCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      renderLithoFlatCanvas(false);
    } else {
      selectedLithoLayerId = null;
      renderLithoFlatCanvas(false);
    }
  });

  lithoFlatCanvas.addEventListener('pointermove', (e) => {
    const pos = getCanvasPointerPos(e);
    const W = lithoFlatCanvas.width;
    const H = lithoFlatCanvas.height;

    if (pointerAction.mode === 'none') {
      const hit = hitTestLithoCanvas(pos.x, pos.y);
      if (hit.type === 'resize') {
        const cMap = {
          tl: 'nwse-resize', br: 'nwse-resize',
          tr: 'nesw-resize', bl: 'nesw-resize',
          l: 'ew-resize', r: 'ew-resize',
          t: 'ns-resize', b: 'ns-resize'
        };
        lithoFlatCanvas.style.cursor = cMap[hit.handle] || 'default';
      } else if (hit.type === 'move' || hit.type === 'select') {
        lithoFlatCanvas.style.cursor = 'move';
      } else {
        lithoFlatCanvas.style.cursor = 'default';
      }
      return;
    }

    const layer = lithoLayers.find(l => l.id === pointerAction.targetLayerId);
    if (!layer) return;

    const dx = (pos.x - pointerAction.startMouse.x) / W;
    const dy = (pos.y - pointerAction.startMouse.y) / H;

    const start = pointerAction.startLayer;
    if (pointerAction.mode === 'move') {
      layer.x = ((start.x + dx) % 1 + 1) % 1;
      layer.y = Math.max(0, Math.min(1 - layer.h, start.y + dy));
    } else {
      const handle = pointerAction.handle;
      if (handle.includes('l')) {
        layer.w = Math.max(0.04, Math.min(1, start.w - dx));
        layer.x = ((start.x + start.w - layer.w) % 1 + 1) % 1;
      } else if (handle.includes('r')) {
        layer.w = Math.max(0.04, Math.min(1, start.w + dx));
      }
      if (handle.includes('t')) {
        const bottom = start.y + start.h;
        layer.y = Math.max(0, Math.min(bottom - 0.08, start.y + dy));
        layer.h = bottom - layer.y;
      } else if (handle.includes('b')) {
        layer.h = Math.max(0.08, Math.min(1 - start.y, start.h + dy));
      }
    }
    renderLithoFlatCanvas(false);
  });

  const endDrag = (e) => {
    if (pointerAction.mode !== 'none') {
      try { lithoFlatCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      pointerAction.mode = 'none';
      renderLithoFlatCanvas(true);
      scheduleUpdate();
    }
  };
  lithoFlatCanvas.addEventListener('pointerup', endDrag);
  lithoFlatCanvas.addEventListener('pointercancel', endDrag);

  lithoFlatCanvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    lithoFlatCanvas.style.outline = '2px dashed var(--accent)';
  });
  lithoFlatCanvas.addEventListener('dragleave', () => {
    lithoFlatCanvas.style.outline = '';
  });
  lithoFlatCanvas.addEventListener('drop', (e) => {
    e.preventDefault();
    lithoFlatCanvas.style.outline = '';
    if (e.dataTransfer?.files.length) addLithoFiles(e.dataTransfer.files);
  });
}

// Action buttons
function removeSelectedLithoLayer() {
  if (selectedLithoLayerId === null) return;
  lithoLayers = lithoLayers.filter(layer => layer.id !== selectedLithoLayerId);
  selectedLithoLayerId = lithoLayers.at(-1)?.id ?? null;
  if (!lithoLayers.length) {
    lithoInput.value = '';
    lithoStatus.style.display = 'none';
  }
  renderLithoFlatCanvas();
  scheduleUpdate();
}

function clearLithoLayers() {
  layerGeneration++;
  layerUploadQueue = Promise.resolve();
  lithoLayers = [];
  selectedLithoLayerId = null;
  pointerAction.mode = 'none';
  lithoAddMoreInput.value = lithoInput.value = '';
  lithoStatus.style.display = 'none';
  renderLithoFlatCanvas();
}

btnAddMoreLitho.addEventListener('click', () => lithoAddMoreInput.click());
lithoAddMoreInput.addEventListener('change', () => {
  if (lithoAddMoreInput.files.length) {
    addLithoFiles(lithoAddMoreInput.files);
    lithoAddMoreInput.value = '';
  }
});

btnDeleteLithoLayer.addEventListener('click', removeSelectedLithoLayer);

btnCenterLithoLayer.addEventListener('click', () => {
  const layer = lithoLayers.find(item => item.id === selectedLithoLayerId);
  if (!layer) return;
  layer.x = (1 - layer.w) / 2;
  renderLithoFlatCanvas();
  scheduleUpdate();
});

btnFitHeightLithoLayer.addEventListener('click', () => {
  const layer = lithoLayers.find(item => item.id === selectedLithoLayerId);
  if (!layer) return;
  Object.assign(layer, { x: 0, y: 0, w: 1, h: 1 });
  renderLithoFlatCanvas();
  scheduleUpdate();
});

btnClearAllLitho.addEventListener('click', () => {
  clearLithoLayers();
  scheduleUpdate();
});

window.addEventListener('keydown', event => {
  if (selectedLithoLayerId === null || !(event.key === 'Delete' || event.key === 'Backspace')) return;
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (!shapeLantern.checked) return;
  event.preventDefault();
  removeSelectedLithoLayer();
});

setupUpload(lithoZone, lithoInput, file => {
  addLithoFiles([file]);
  lithoInput.value = '';
}, { raw: true });

for (const control of [S.upperShellHeight.el, S.diameter.el, S.height.el, S.bulbHeight.el]) {
  control.addEventListener('input', () => renderLithoFlatCanvas());
}
for (const control of document.querySelectorAll('input[name="projMode"]')) {
  control.addEventListener('change', () => renderLithoFlatCanvas());
}

for (const control of [lithoMinThick, lithoMaxThick]) {
  control.addEventListener('input', () => {
    if (Number(lithoMinThick.value) > Number(lithoMaxThick.value)) {
      const other = control === lithoMinThick ? lithoMaxThick : lithoMinThick;
      other.value = control.value;
    }
    lithoMinThickVal.textContent = lithoMinThick.value + ' mm';
    lithoMaxThickVal.textContent = lithoMaxThick.value + ' mm';
    scheduleUpdate();
  });
}
lithoRepeat.addEventListener('change', scheduleUpdate);
lithoInvert.addEventListener('change', scheduleUpdate);
lithoEnable.addEventListener('change', scheduleUpdate);
renderLithoFlatCanvas();

function logDebug(message) {
  console.debug('[Shadow Lamp]', message);
}

// Silhouette Controls
const silThreshold    = document.getElementById('silThreshold');
const silThresholdVal = document.getElementById('silThresholdVal');
const invertSilhouette = document.getElementById('invertSilhouette');
let silhouetteSource = null;
let loadingPattern = false;
let silhouetteUploadRevision = 0;
let silhouetteMaskRevision = 0;
let silhouetteTimer = null;
let silhouetteThumbUrl = null;

silThreshold.addEventListener('input', () => {
  silThresholdVal.textContent = silThreshold.value;
  reprocessSilhouette();
});
invertSilhouette.addEventListener('change', reprocessSilhouette);

function resetSilhouetteUpload() {
  loadingPattern = false;
  silhouetteUploadRevision++;
  silhouetteMaskRevision++;
  clearTimeout(silhouetteTimer);
  silhouetteSource = null;
  silhouetteMaskBlob = null;
  uploadedFile = null;
  imageData = null;
  patternShapeRadii = patternProfileData = null;
  if (silhouetteThumbUrl) URL.revokeObjectURL(silhouetteThumbUrl);
  silhouetteThumbUrl = null;
  downloadBtn.disabled = true;
}

function beginSilhouetteUpload(label) {
  resetSilhouetteUpload();
  loadingPattern = true;
  uploadZone.querySelector('img')?.remove();
  uploadZone.classList.remove('has-image');
  for (const label of uploadZone.querySelectorAll('.icon, .label, .sublabel')) label.style.display = '';
  matchPatternStatus.style.display = 'none';
  scheduleUpdate();
  if (!activeExport) setStatus('busy', '正在读取图案…');
  return silhouetteUploadRevision;
}

async function loadSilhouetteUpload(file, revision, label = '剪影') {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      if (revision !== silhouetteUploadRevision) return;
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0, width, height);
      const rgba = context.getImageData(0, 0, width, height).data;
      silhouetteSource = { file, width, height, rgba, label };
    } finally {
      bitmap.close();
    }
    await renderSilhouetteMask(++silhouetteMaskRevision);
  } catch (error) {
    if (revision === silhouetteUploadRevision && !activeExport) {
      setStatus('error', '读取图片失败：' + error.message);
    }
  } finally {
    if (revision === silhouetteUploadRevision) {
      loadingPattern = false;
      syncExportButton();
    }
  }
}

function reprocessSilhouette() {
  if (!silhouetteSource) return;
  const revision = ++silhouetteMaskRevision;
  silhouetteMaskBlob = null;
  downloadBtn.disabled = true;
  clearTimeout(silhouetteTimer);
  silhouetteTimer = setTimeout(() => renderSilhouetteMask(revision), 45);
}

async function renderSilhouetteMask(revision) {
  if (revision !== silhouetteMaskRevision || !silhouetteSource) return;
  const { file, width, height, rgba, label } = silhouetteSource;
  try {
    const gray = globalThis.ShadowLampSilhouette.mask(rgba, width, height, silThreshold.value, invertSilhouette.checked);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const bitmap = context.createImageData(width, height);
    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4;
      bitmap.data[offset] = bitmap.data[offset + 1] = bitmap.data[offset + 2] = gray[i];
      bitmap.data[offset + 3] = 255;
    }
    context.putImageData(bitmap, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (revision !== silhouetteMaskRevision) return;
    if (!blob) throw new Error('Could not encode the processed mask.');

    uploadedFile = file;
    silhouetteMaskBlob = blob;
    imageData = { width, height, data: gray };
    if (silhouetteThumbUrl) URL.revokeObjectURL(silhouetteThumbUrl);
    silhouetteThumbUrl = URL.createObjectURL(blob);
    showThumb(uploadZone, silhouetteThumbUrl);
    patternShapeRadii = patternProfileData = null;
    extractPatternRadialProfile();
    if (!activeExport) setStatus('ready', label + '已就绪 · ' + width + ' × ' + height);
    downloadBtn.disabled = activeExport !== null;
    scheduleUpdate();
  } catch (error) {
    if (revision === silhouetteMaskRevision && !activeExport) {
      setStatus('error', '剪影处理失败：' + error.message);
    }
  }
}

// ============================================================
// Image Upload
// ============================================================
setupUpload(uploadZone, fileInput, file => {
  loadSilhouetteUpload(file, beginSilhouetteUpload('silhouette'));
}, { raw: true });

setupUpload(profileZone, profileInput, (file, dataUrl, isCurrent) => {
  loadGrayscale(dataUrl, (w, h, gray) => {
    if (!isCurrent()) return;
    profileFile = file;
    profileData = extractProfile(w, h, gray);
    showThumb(profileZone, dataUrl);
    setStatus('ready', '已载入侧面轮廓');
    scheduleUpdate();
  });
}, { latest: true });

function setupUpload(zone, input, cb, { raw = false, latest = false } = {}) {
  if (!zone || !input) return;
  let selection = 0;
  const select = file => {
    const current = ++selection;
    const epoch = uploadEpoch;
    const isCurrent = () => epoch === uploadEpoch && (!latest || current === selection);
    if (raw) {
      cb(file);
    } else {
      processFile(file, (selectedFile, dataUrl) => {
        if (isCurrent()) cb(selectedFile, dataUrl, isCurrent);
      });
    }
  };
  zone.style.cursor = 'pointer';
  zone.addEventListener('click', e => {
    if (e.target !== input) input.click();
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) select(file);
  });
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) select(file);
  });
}

function processFile(file, cb) {
  if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    if (e.target && e.target.result) {
      cb(file, e.target.result);
    }
  };
  r.onerror = err => {
    logDebug(`FileReader error: ${err}`, '#ff6b6b');
    console.error("FileReader error:", err);
  };
  r.readAsDataURL(file);
}

function showThumb(zone, src) {
  if (!zone) return;
  let img = zone.querySelector('img');
  for (const child of Array.from(zone.children)) {
    if (child.tagName !== 'INPUT' && child.tagName !== 'IMG') {
      child.style.display = 'none';
    }
  }
  if (!img) {
    img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '160px';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    img.style.pointerEvents = 'none';
    zone.appendChild(img);
  }
  img.src = src;
  img.style.display = 'block';
  zone.classList.add('has-image');
}

function loadGrayscale(dataUrl, cb) {
  const img = new Image();
  img.onload = () => {
    try {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++)
        gray[i] = Math.round(0.299 * px[i*4] + 0.587 * px[i*4+1] + 0.114 * px[i*4+2]);
      cb(w, h, gray);
    } catch (e) {
      logDebug(`Grayscale error: ${e.message}`, '#ff6b6b');
      console.error("Grayscale error:", e);
    }
  };
  img.onerror = () => {
    logDebug(`Image decode failed`, '#ff6b6b');
  };
  img.src = dataUrl;
}

// Bilinear interpolation for sub-pixel shadow sampling
function bilinearSample(gray, W, H, u, v) {
  const uc = Math.max(0, Math.min(u, W - 1.001));
  const vc = Math.max(0, Math.min(v, H - 1.001));
  const u0 = Math.floor(uc), v0 = Math.floor(vc);
  const u1 = Math.min(u0 + 1, W - 1), v1 = Math.min(v0 + 1, H - 1);
  const fu = uc - u0, fv = vc - v0;
  const val00 = gray[v0 * W + u0];
  const val01 = gray[v0 * W + u1];
  const val10 = gray[v1 * W + u0];
  const val11 = gray[v1 * W + u1];
  return val00 * (1 - fu) * (1 - fv) +
         val01 * fu * (1 - fv) +
         val10 * (1 - fu) * fv +
         val11 * fu * fv;
}

function extractProfile(w, h, gray) {
  const cx = w >> 1;
  const radii = new Float32Array(h);
  for (let row = 0; row < h; row++) {
    let maxR = 0;
    for (let col = 0; col < w; col++) {
      if (gray[row * w + col] < 128) maxR = Math.max(maxR, Math.abs(col - cx));
    }
    radii[row] = maxR;
  }
  // Normalize
  let mx = 0;
  for (let i = 0; i < h; i++) mx = Math.max(mx, radii[i]);
  if (mx > 0) for (let i = 0; i < h; i++) radii[i] /= mx;
  // Flip Y (image top=0 → z bottom)
  radii.reverse();
  return radii;
}

// ============================================================
// Custom Shape — Marching Squares Contour Extraction
// ============================================================

/**
 * Marching squares contour tracing on a binary grid.
 * Returns an array of contour loops, each loop is an array of {x, y} points.
 */
function marchingSquaresContours(binary, w, h) {
  // binary[row * w + col] — true means solid
  const visited = new Set();
  const contours = [];

  // Direction lookup for marching squares (4-bit case → dx, dy move)
  // We trace iso-contour at the boundary between solid and empty cells
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];

  function sample(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    return binary[cy * w + cx];
  }

  // Walk edges between cells using a simple boundary-following approach
  // For each edge pixel, trace the outer boundary
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!binary[y * w + x]) continue;
      // Check if this is a boundary pixel (has at least one empty neighbor)
      const isBoundary = (x === 0 || !binary[y * w + (x - 1)]) ||
                          (x === w - 1 || !binary[y * w + (x + 1)]) ||
                          (y === 0 || !binary[(y - 1) * w + x]) ||
                          (y === h - 1 || !binary[(y + 1) * w + x]);
      if (!isBoundary) continue;

      const key = y * w + x;
      if (visited.has(key)) continue;

      // Trace boundary using Moore neighborhood tracing
      const contour = [];
      const startX = x, startY = y;
      let cx = x, cy = y;
      let dir = 0; // start direction: right
      let steps = 0;
      const maxSteps = w * h * 2;

      do {
        if (!visited.has(cy * w + cx)) {
          contour.push({ x: cx + 0.5, y: cy + 0.5 });
          visited.add(cy * w + cx);
        }

        // Try turning left first (counter-clockwise), then straight, then right
        let found = false;
        for (let turn = -1; turn <= 2; turn++) {
          const nd = (dir + turn + 4) % 4;
          const nx = cx + dx[nd];
          const ny = cy + dy[nd];
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && binary[ny * w + nx]) {
            // Check it's still a boundary pixel
            const nb = (nx === 0 || !binary[ny * w + (nx - 1)]) ||
                       (nx === w - 1 || !binary[ny * w + (nx + 1)]) ||
                       (ny === 0 || !binary[(ny - 1) * w + nx]) ||
                       (ny === h - 1 || !binary[(ny + 1) * w + nx]);
            if (nb) {
              dir = nd;
              cx = nx;
              cy = ny;
              found = true;
              break;
            }
          }
        }
        if (!found) break;
        steps++;
      } while ((cx !== startX || cy !== startY) && steps < maxSteps);

      if (contour.length >= 8) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

/**
 * Extract custom shape from an uploaded image.
 * Returns a Float32Array(360) of normalized radii (0-1), one per degree.
 * Returns null if extraction fails.
 */
function extractCustomShapeContour(dataUrl, threshold, smoothAmount) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Scale down large images
      const maxDim = 512;
      const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * sc), h = Math.round(img.height * sc);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;

      // Binarize: dark pixels = solid
      const binary = new Uint8Array(w * h);
      for (let i = 0; i < binary.length; i++) {
        const gray = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        binary[i] = gray < threshold ? 1 : 0;
      }

      // Extract contours
      const contours = marchingSquaresContours(binary, w, h);
      if (contours.length === 0) {
        resolve(null);
        return;
      }

      // Pick the largest contour
      let largest = contours[0];
      for (let i = 1; i < contours.length; i++) {
        if (contours[i].length > largest.length) largest = contours[i];
      }

      // Compute centroid
      let cx = 0, cy = 0;
      for (const p of largest) { cx += p.x; cy += p.y; }
      cx /= largest.length;
      cy /= largest.length;

      // Convert to polar: for each contour point, compute angle and radius
      const polarPoints = largest.map(p => ({
        angle: Math.atan2(p.y - cy, p.x - cx),
        radius: Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
      }));

      // Sample at 360 angles (1° resolution)
      const N_ANGLES = 360;
      const radii = new Float32Array(N_ANGLES);
      const counts = new Float32Array(N_ANGLES);

      for (const p of polarPoints) {
        // Normalize angle to [0, 2π)
        let angleDeg = ((p.angle * 180 / Math.PI) % 360 + 360) % 360;
        const idx = Math.floor(angleDeg) % N_ANGLES;
        // Use max radius at each angle bucket
        if (p.radius > radii[idx]) radii[idx] = p.radius;
        counts[idx]++;
      }

      // Fill gaps using nearest non-zero neighbors
      const filled = new Float32Array(radii);
      for (let i = 0; i < N_ANGLES; i++) {
        if (counts[i] === 0) {
          // Search outward for nearest filled bucket
          for (let d = 1; d < N_ANGLES / 2; d++) {
            const lo = ((i - d) + N_ANGLES) % N_ANGLES;
            const hi = (i + d) % N_ANGLES;
            if (counts[lo] > 0 && counts[hi] > 0) {
              filled[i] = (radii[lo] + radii[hi]) / 2;
              break;
            } else if (counts[lo] > 0) {
              filled[i] = radii[lo];
              break;
            } else if (counts[hi] > 0) {
              filled[i] = radii[hi];
              break;
            }
          }
        }
      }

      // Smooth (circular moving average)
      const smoothed = new Float32Array(N_ANGLES);
      const halfWin = smoothAmount;
      for (let i = 0; i < N_ANGLES; i++) {
        let sum = 0, cnt = 0;
        for (let d = -halfWin; d <= halfWin; d++) {
          const idx = ((i + d) + N_ANGLES) % N_ANGLES;
          sum += filled[idx];
          cnt++;
        }
        smoothed[i] = sum / cnt;
      }

      // Normalize: max = 1.0
      let maxR = 0;
      for (let i = 0; i < N_ANGLES; i++) maxR = Math.max(maxR, smoothed[i]);
      if (maxR > 0) {
        for (let i = 0; i < N_ANGLES; i++) smoothed[i] /= maxR;
      }

      // Ensure minimum radius
      for (let i = 0; i < N_ANGLES; i++) {
        smoothed[i] = Math.max(smoothed[i], 0.05);
      }

      resolve({ radii: smoothed, pointCount: largest.length });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function showCustomShapeStatus(type, message) {
  customShapeStatus.style.display = 'flex';
  customShapeStatus.className = 'custom-shape-status ' + type;
  customShapeStatus.textContent = message;
}

// ============================================================
// Custom Shape Upload
// ============================================================
let customShapeUploadCurrent = null;
let customShapeMaskRevision = 0;
setupUpload(customShapeZone, customShapeInput, (file, dataUrl, isCurrent) => {
  customShapeImageData = dataUrl;
  customShapeUploadCurrent = isCurrent;
  showThumb(customShapeZone, dataUrl);
  reprocessCustomShape();
}, { latest: true });

async function reprocessCustomShape() {
  if (!customShapeImageData || !customShapeUploadCurrent?.()) return;
  const revision = ++customShapeMaskRevision;
  const isCurrent = customShapeUploadCurrent;
  const threshold = parseInt(customThresholdEl.value);
  const smooth = parseInt(customSmoothEl.value);
  const result = await extractCustomShapeContour(customShapeImageData, threshold, smooth);
  if (revision !== customShapeMaskRevision || !isCurrent()) return;
  if (result) {
    customShapeRadii = result.radii;
    showCustomShapeStatus('success', `已提取截面 · ${result.pointCount} 个轮廓点`);
    setStatus('ready', '已载入截面轮廓');
    scheduleUpdate();
  } else {
    customShapeRadii = null;
    showCustomShapeStatus('error', '未找到轮廓，请调整阈值。');
    scheduleUpdate();
  }
}

customThresholdEl.addEventListener('input', () => {
  customThresholdVal.textContent = customThresholdEl.value;
  reprocessCustomShape();
});

customSmoothEl.addEventListener('input', () => {
  customSmoothVal.textContent = customSmoothEl.value;
  reprocessCustomShape();
});

// ============================================================
// Auto-extract Pattern Shape (for Match Pattern mode)
// Uses radial scanning from the figure's centroid — much more
// robust than contour tracing for complex shadow images.
// ============================================================
function extractPatternRadialProfile() {
  if (!imageData) return;
  const { width: w, height: h, data: gray } = imageData;
  const threshold = 128;

  let cx = 0, cy = 0, figCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isFigure = gray[y * w + x] < threshold;
      if (isFigure) {
        cx += x;
        cy += y;
        figCount++;
      }
    }
  }
  if (figCount < 10) {
    patternShapeRadii = patternProfileData = null;
    if (matchPatternStatus) {
      matchPatternStatus.style.display = 'flex';
      matchPatternStatus.className = 'custom-shape-status error';
      matchPatternStatus.textContent = '未找到可用的图案轮廓。';
    }
    return;
  }
  cx /= figCount;
  cy /= figCount;

  // 3. Radial scan: at each angle, find the outermost figure pixel
  const N_ANGLES = 360;
  const maxR = Math.sqrt(w * w + h * h) / 2;
  const radii = new Float32Array(N_ANGLES);

  for (let i = 0; i < N_ANGLES; i++) {
    const angle = i * Math.PI / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let lastFigR = 0;

    for (let r = 1; r < maxR; r++) {
      const px = Math.round(cx + r * dx);
      const py = Math.round(cy + r * dy);
      if (px < 0 || py < 0 || px >= w || py >= h) break;
      const isFigure = gray[py * w + px] < threshold;
      if (isFigure) lastFigR = r;
    }
    radii[i] = lastFigR;
  }

  // 4. Smooth (circular moving average, window = 5)
  const smoothWin = 5;
  const smoothed = new Float32Array(N_ANGLES);
  for (let i = 0; i < N_ANGLES; i++) {
    let sum = 0, cnt = 0;
    for (let d = -smoothWin; d <= smoothWin; d++) {
      sum += radii[((i + d) + N_ANGLES) % N_ANGLES];
      cnt++;
    }
    smoothed[i] = sum / cnt;
  }

  // 5. Normalize: max = 1.0
  let maxVal = 0;
  for (let i = 0; i < N_ANGLES; i++) maxVal = Math.max(maxVal, smoothed[i]);
  if (maxVal > 0) {
    for (let i = 0; i < N_ANGLES; i++) smoothed[i] /= maxVal;
  }
  // Clamp minimum
  for (let i = 0; i < N_ANGLES; i++) smoothed[i] = Math.max(smoothed[i], 0.05);

  patternShapeRadii = smoothed;

  // Also extract vertical profile (side silhouette) from the same image
  // For each row, find the max horizontal extent of figure pixels from center
  const profileRadii = new Float32Array(h);
  const imgCx = w / 2;
  for (let row = 0; row < h; row++) {
    let maxExtent = 0;
    for (let x = 0; x < w; x++) {
      const isFig = gray[row * w + x] < threshold;
      if (isFig) maxExtent = Math.max(maxExtent, Math.abs(x - imgCx));
    }
    profileRadii[row] = maxExtent;
  }
  // Normalize
  let profMax = 0;
  for (let i = 0; i < h; i++) profMax = Math.max(profMax, profileRadii[i]);
  if (profMax > 0) for (let i = 0; i < h; i++) profileRadii[i] /= profMax;
  // Flip Y (image top=0 → z bottom)
  profileRadii.reverse();
  patternProfileData = profileRadii;

  if (matchPatternStatus) {
    matchPatternStatus.style.display = 'flex';
    matchPatternStatus.className = 'custom-shape-status success';
    matchPatternStatus.textContent = '已从投影图案提取截面';
  }
  // Always re-render to pick up the new radii
  scheduleUpdate();
}



// ============================================================
// Client-side preview (cylinder/custom shell)
// ============================================================
function samplePreviewImage(data, width, height, u, v, wrap) {
  const x = wrap ? u : Math.max(0, Math.min(width - 1, u));
  const y = Math.max(0, Math.min(height - 1, v));
  const left = Math.floor(x);
  const top = Math.floor(y);
  const next = Math.min(top + 1, height - 1);
  const a = wrap ? (left + width) % width : left;
  const b = wrap ? (a + 1) % width : Math.min(a + 1, width - 1);
  const dx = x - left;
  const dy = y - top;
  const upper = data[top * width + a] * (1 - dx) + data[top * width + b] * dx;
  const lower = data[next * width + a] * (1 - dx) + data[next * width + b] * dx;
  return upper * (1 - dy) + lower * dy;
}

function contourPreviewGeometry(field, rows, columns, gridPositions, gridColors, caps) {
  const nodeCount = field.length;
  const cells = new Uint8Array(rows * columns);
  const facesForCase = [0, 1, 1, 2, 1, 4, 2, 3, 1, 2, 4, 3, 2, 3, 3, 2];
  let indexCount = caps.length;
  let solidN = 0;
  for (let row = 0; row < rows; row++) {
    const offset = row * columns;
    for (let col = 0; col < columns; col++) {
      const topLeft = offset + col;
      const topRight = offset + (col + 1) % columns;
      const a = field[topLeft], b = field[topRight];
      const c = field[topRight + columns], d = field[topLeft + columns];
      const solid = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (!solid) continue;

      // Resolve checkerboard cells from the signed saddle, rather than joining two tips.
      const saddle = a * c - b * d;
      const separate = (solid === 5 && saddle <= 0) || (solid === 10 && saddle >= 0);
      cells[topLeft] = solid | (separate ? 16 : 0);
      indexCount += 3 * (separate ? 2 : facesForCase[solid]);
      solidN++;
    }
  }

  const indices = new Uint32Array(indexCount);
  indices.set(caps);
  let cursor = caps.length;
  const edgeVertices = new Int32Array(nodeCount * 2).fill(-1);
  const vertexOffset = gridPositions.length / 3;
  let extraPositions = new Float32Array(columns * 12);
  let extraColors = new Float32Array(extraPositions.length);
  let extraCount = 0;

  function crossing(key, a, b) {
    if (edgeVertices[key] >= 0) return edgeVertices[key];
    if (extraCount === extraPositions.length) {
      const positions = new Float32Array(extraCount * 2);
      const colors = new Float32Array(positions.length);
      positions.set(extraPositions);
      colors.set(extraColors);
      extraPositions = positions;
      extraColors = colors;
    }
    const id = vertexOffset + extraCount / 3;
    const t = field[a] / (field[a] - field[b]);
    for (let axis = 0; axis < 3; axis++, extraCount++) {
      const p = a * 3 + axis, q = b * 3 + axis;
      extraPositions[extraCount] = gridPositions[p] + (gridPositions[q] - gridPositions[p]) * t;
      extraColors[extraCount] = gridColors[p] + (gridColors[q] - gridColors[p]) * t;
    }
    edgeVertices[key] = id;
    return id;
  }

  const corners = new Int32Array(4);
  const polygon = new Int32Array(6);
  for (let row = 0; row < rows; row++) {
    const offset = row * columns;
    for (let col = 0; col < columns; col++) {
      const a = offset + col;
      const code = cells[a];
      if (!code) continue;
      const b = offset + (col + 1) % columns;
      const c = b + columns, d = a + columns;
      if (code === 15) {
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = b;
        indices[cursor++] = a;
        indices[cursor++] = d;
        indices[cursor++] = c;
        continue;
      }

      const solid = code & 15;
      corners[0] = a;
      corners[1] = b;
      corners[2] = c;
      corners[3] = d;
      const edgeKeys = [a, nodeCount + b, d, nodeCount + a];
      if (code & 16) {
        for (let corner = solid === 5 ? 0 : 1; corner < 4; corner += 2) {
          const previous = (corner + 3) % 4;
          const next = (corner + 1) % 4;
          indices[cursor++] = corners[corner];
          indices[cursor++] = crossing(edgeKeys[previous], corners[previous], corners[corner]);
          indices[cursor++] = crossing(edgeKeys[corner], corners[corner], corners[next]);
        }
        continue;
      }

      let count = 0;
      for (let corner = 0; corner < 4; corner++) {
        const next = (corner + 1) % 4;
        const inside = !!(solid & (1 << corner));
        if (inside) polygon[count++] = corners[corner];
        if (inside !== !!(solid & (1 << next))) {
          polygon[count++] = crossing(edgeKeys[corner], corners[corner], corners[next]);
        }
      }
      for (let i = 2; i < count; i++) {
        indices[cursor++] = polygon[0];
        indices[cursor++] = polygon[i];
        indices[cursor++] = polygon[i - 1];
      }
    }
  }

  const positions = new Float32Array(gridPositions.length + extraCount);
  const colors = new Float32Array(positions.length);
  positions.set(gridPositions);
  positions.set(extraPositions.subarray(0, extraCount), gridPositions.length);
  colors.set(gridColors);
  colors.set(extraColors.subarray(0, extraCount), gridColors.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return { geo: geometry, solidN, totalN: cells.length };
}

function reliefSuppliesProjection() {
  return !imageData && !silhouetteSource && !loadingPattern &&
    shapeLantern.checked && lithoEnable.checked && !!lithoData;
}

function syncExportButton() {
  const reuseRelief = reliefSuppliesProjection();
  downloadBtn.disabled = !!activeExport || !(silhouetteMaskBlob || reuseRelief);
  document.getElementById('projectionFallback').hidden = !reuseRelief;
}

function buildPreview() {
  const image = imageData || (reliefSuppliesProjection() ? lithoData : null);
  if (!image) return null;

  const radius = Number(S.diameter.el.value) / 2;
  const lowerHeight = Number(S.height.el.value) || 0.1;
  const lightHeight = Number(S.bulbHeight.el.value);
  const wallThickness = Number(S.thickness.el.value);
  const rows = Number(S.resolution.el.value);
  const lantern = shapeLantern && shapeLantern.checked;
  const hasHood = hasUpperHood();
  const upperHeight = hasHood ? Number(S.upperShellHeight.el.value) : 0;
  const height = lowerHeight + upperHeight;
  const rowHeight = height / rows;
  const wall = document.querySelector('input[name="projMode"]:checked').value === 'wall';
  const hoodStart = wall ? lowerHeight : Math.min(lightHeight, lowerHeight);
  const hoodHeight = height - hoodStart;
  const supportCount = Number(document.getElementById('supportCount').value);
  const supportHalfWidth = Number(S.supportWidth.el.value) / 2;
  const plateThickness = document.getElementById('bottomStyle').value === 'closed'
    ? Number(S.bottomThickness.el.value) : 0;
  const turn = 2 * Math.PI;
  const baseShape = document.getElementById('baseShape').value;
  const shapeRadii = baseShape === 'custom' ? customShapeRadii
    : baseShape === 'match_pattern' ? patternShapeRadii : null;
  const sides = { triangle: 3, square: 4, pentagon: 5, hexagon: 6 }[baseShape] || 0;
  // Keep explicitly selected polygon corners on lattice columns.
  const columns = sides ? Math.ceil(rows / (2 * sides)) * 2 * sides : rows;
  const angleStep = turn / columns;
  const sideAngle = sides ? turn / sides : turn;
  const supportAngle = supportCount ? turn / supportCount : turn;

  const cosines = new Float64Array(columns);
  const sines = new Float64Array(columns);
  const scales = new Float64Array(columns);
  const supportAngles = new Float64Array(columns);
  let minimumScale = Infinity;
  for (let col = 0; col < columns; col++) {
    const phi = col * angleStep;
    cosines[col] = Math.cos(phi);
    sines[col] = Math.sin(phi);
    supportAngles[col] = Math.abs(phi - Math.round(phi / supportAngle) * supportAngle);
    let scale = 1;
    if (shapeRadii?.length) {
      const index = col / columns * shapeRadii.length;
      const i = Math.floor(index), fraction = index - i;
      scale = shapeRadii[i] * (1 - fraction) + shapeRadii[(i + 1) % shapeRadii.length] * fraction;
    } else if (sides) {
      scale = 1 / Math.cos(phi - Math.round(phi / sideAngle) * sideAngle);
    }
    scales[col] = scale;
    minimumScale = Math.min(minimumScale, scale);
  }

  const profile = shapeCustom.checked && profileData ? profileData
    : shapeMatchPattern.checked && patternProfileData ? patternProfileData : null;
  const radii = new Float32Array(rows + 1).fill(radius);
  if (profile?.length) {
    for (let row = 0; row <= rows; row++) {
      const sample = row / rows * (profile.length - 1);
      const lo = Math.floor(sample), hi = Math.min(lo + 1, profile.length - 1);
      radii[row] = radius * Math.max(0.02, profile[lo] + (profile[hi] - profile[lo]) * (sample - lo));
    }
  }

  const shadowWidth = Number(S.shadowSize.el.value);
  const { width, height: imageHeight, data } = image;
  const shadowHeight = shadowWidth * imageHeight / width;
  const nodeCount = (rows + 1) * columns;
  const field = new Float32Array(nodeCount);
  const horizontal = new Float32Array(nodeCount);
  const wallMaskHeight = hasHood ? lowerHeight : height;
  for (let row = 0; row <= rows; row++) {
    const y = row * rowHeight;
    const floorProjection = y < lightHeight
      ? radii[row] * (lightHeight + plateThickness) / (lightHeight - y)
      : 0;
    const offset = row * columns;
    for (let col = 0; col < columns; col++) {
      let mask = -1;
      if (wall) {
        const u = col / columns * width - 0.5;
        const v = (1 - y / wallMaskHeight) * imageHeight - 0.5;
        mask = (128 - samplePreviewImage(data, width, imageHeight, u, v, true)) / 128;
      } else if (floorProjection) {
        const r = floorProjection * scales[col];
        const u = (r * cosines[col] / shadowWidth + 0.5) * width;
        const v = (r * sines[col] / shadowHeight + 0.5) * imageHeight;
        const margin = Math.min(u, width - u, v, imageHeight - v);
        if (margin >= 0) {
          mask = Math.min(margin, (128 - samplePreviewImage(data, width, imageHeight, u - 0.5, v - 0.5, false)) / 128);
        }
      }
      field[offset + col] = mask;
    }

    // Separate, periodic blur passes round contour samples without a seam.
    for (let col = 0; col < columns; col++) {
      const left = (col + columns - 1) % columns;
      const right = (col + 1) % columns;
      horizontal[offset + col] = (field[offset + left] + 2 * field[offset + col] + field[offset + right]) / 4;
    }
  }
  for (let row = 0; row <= rows; row++) {
    const offset = row * columns;
    const below = Math.max(0, row - 1) * columns;
    const above = Math.min(rows, row + 1) * columns;
    const y = row * rowHeight;
    for (let col = 0; col < columns; col++) {
      let mask = (horizontal[below + col] + 2 * horizontal[offset + col] + horizontal[above + col]) / 4;
      if (!wall && y >= lightHeight) mask = -1;
      if (hasHood && y >= hoodStart) mask = 1;
      if (supportCount) {
        const support = (supportHalfWidth - supportAngles[col] * radii[row]) / (angleStep * radii[row]);
        mask = Math.max(mask, Math.min(1, support));
      }
      if (row <= 1) mask = 1;
      field[offset + col] = mask > 0 ? Math.max(0.001, mask) : Math.min(-0.001, mask);
    }
  }

  const yApex = height + (hasHood ? lantern ? 10 : 5 : 0);
  const plateVertices = plateThickness ? 5 * columns + 2 : 0;
  const vertexCount = nodeCount + plateVertices + (hasHood ? 1 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(positions.length);
  const caps = [];
  const litho = lantern && lithoEnable?.checked && lithoData;
  const minLitho = Number(lithoMinThick?.value ?? 1.2);
  const maxLitho = Number(lithoMaxThick?.value ?? 3);
  const invertLitho = lithoInvert?.checked;
  const repeatLitho = Number(lithoRepeat?.value) || 1;
  const baseColor = [0.42, 0.48, 0.58];
  const hoodColor = [0.94, 0.94, 0.96];

  for (let row = 0; row <= rows; row++) {
    const y = row * rowHeight;
    const upper = hasHood && y >= hoodStart - 1e-4;
    const reliefRow = upper && litho && hoodHeight > 0;
    const lithoY = reliefRow
      ? (1 - Math.max(0, Math.min(1, (y - hoodStart) / hoodHeight))) * (litho.height - 1)
      : 0;
    for (let col = 0; col < columns; col++) {
      const index = (row * columns + col) * 3;
      let thickness = wallThickness;
      let [red, green, blue] = upper ? hoodColor : baseColor;
      if (reliefRow) {
        const u = col / columns * repeatLitho * litho.width - 0.5;
        const gray = samplePreviewImage(litho.data, litho.width, litho.height, u, lithoY, true) / 255;
        const darkness = invertLitho ? gray : 1 - gray;
        thickness = minLitho + darkness * (maxLitho - minLitho);
        red = 1 - darkness * 0.58;
        green = 0.97 - darkness * 0.64;
        blue = 0.91 - darkness * 0.69;
      }
      const r = (radii[row] + thickness) * scales[col];
      positions[index] = r * cosines[col];
      positions[index + 1] = y;
      positions[index + 2] = r * sines[col];
      colors[index] = red;
      colors[index + 1] = green;
      colors[index + 2] = blue;
    }
  }

  if (plateThickness) {
    const holeRadius = Math.max(0, Math.min(Number(S.bottomHoleDiam.el.value) / 2, radii[0] * minimumScale - 0.1));
    function plateVertex(id, r, y, col) {
      positions[id * 3] = r * cosines[col];
      positions[id * 3 + 1] = y;
      positions[id * 3 + 2] = r * sines[col];
      colors.set(baseColor, id * 3);
    }

    const bottom = nodeCount;
    const outerTop = bottom + columns;
    const plateTop = outerTop + columns;
    const holeBottom = plateTop + columns;
    const holeTop = holeBottom + columns;
    const topCenter = holeTop + columns;
    const bottomCenter = topCenter + 1;
    plateVertex(topCenter, 0, 0, 0);
    plateVertex(bottomCenter, 0, -plateThickness, 0);
    for (let col = 0; col < columns; col++) {
      const next = (col + 1) % columns;
      const outer = (radii[0] + wallThickness) * scales[col];
      plateVertex(bottom + col, outer, -plateThickness, col);
      plateVertex(outerTop + col, outer, 0, col);
      plateVertex(plateTop + col, outer, 0, col);
      caps.push(outerTop + col, outerTop + next, bottom + next, outerTop + col, bottom + next, bottom + col);
      if (holeRadius) {
        plateVertex(holeBottom + col, holeRadius, -plateThickness, col);
        plateVertex(holeTop + col, holeRadius, 0, col);
        caps.push(
          plateTop + col, holeTop + col, holeTop + next, plateTop + col, holeTop + next, plateTop + next,
          bottom + col, bottom + next, holeBottom + next, bottom + col, holeBottom + next, holeBottom + col,
          holeTop + col, holeBottom + col, holeBottom + next, holeTop + col, holeBottom + next, holeTop + next,
        );
      } else {
        caps.push(plateTop + col, topCenter, plateTop + next, bottom + col, bottom + next, bottomCenter);
      }
    }
  }

  if (hasHood) {
    const apex = vertexCount - 1;
    positions[apex * 3 + 1] = yApex;
    colors.set(lantern ? hoodColor : baseColor, apex * 3);
    const top = rows * columns;
    for (let col = 0; col < columns; col++) {
      caps.push(apex, top + (col + 1) % columns, top + col);
    }
  }

  floorMesh.visible = !wall;
  floorMesh.position.y = -plateThickness - 0.01;
  wallMesh.visible = wall;
  return { ...contourPreviewGeometry(field, rows, columns, positions, colors, caps), yApex };
}

function updatePreview() {
  try {
    if (previewMesh) {
      scene.remove(previewMesh);
      previewMesh.geometry.dispose();
      previewMesh.material.dispose();
      previewMesh = null;
    }
    // Hanging Hook (顶部挂钩)
    if (hookMesh) {
      scene.remove(hookMesh);
      hookMesh.children.forEach(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      hookMesh = null;
    }
    const r = buildPreview();
    if (!r) {
      document.getElementById('emptyStage').hidden = false;
      triCount.textContent = '—';
      needsCameraFit = true;
      requestRender();
      return;
    }

    previewMesh = new THREE.Mesh(r.geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.45,
      side: THREE.DoubleSide
    }));
    previewMesh.castShadow = true;
    previewMesh.receiveShadow = true;
    scene.add(previewMesh);
    document.getElementById('emptyStage').hidden = true;

    grid.visible = floorMesh.visible;
    const showHook = hasUpperHood() && topHookToggle.checked;
    if (showHook && r) {
      const hookY = r.yApex || parseFloat(S.height.el.value) || 100;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd4a34b, // golden bronze hook
        metalness: 0.7,
        roughness: 0.3
      });

      const torusGeo = new THREE.TorusGeometry(5.0, 1.3, 16, 32);
      torusGeo.rotateY(Math.PI / 2);
      torusGeo.translate(0, hookY + 6.0, 0);

      const baseGeo = new THREE.CylinderGeometry(3.5, 4.5, 3.0, 16);
      baseGeo.translate(0, hookY + 1.5, 0);

      const m1 = new THREE.Mesh(torusGeo, mat);
      const m2 = new THREE.Mesh(baseGeo, mat);
      m1.castShadow = true;
      m1.receiveShadow = true;
      m2.castShadow = true;
      m2.receiveShadow = true;
      group.add(m1);
      group.add(m2);

      hookMesh = group;
      scene.add(hookMesh);
    }

    const triangleCount = (r.geo.index || r.geo.attributes.position).count / 3;
    triCount.textContent = triangleCount.toLocaleString() + ' 个三角面';
    if (needsCameraFit) {
      setCameraView('perspective');
      needsCameraFit = false;
    }
    updateLightPos();
  } catch (err) {
    console.error("Preview render error:", err);
    setStatus('error', `预览失败：${err.message}`);
    logDebug(`Preview render error: ${err.message}`, '#ff6b6b');
  }
}

function scheduleUpdate() {
  syncExportButton();
  clearTimeout(debounce);
  debounce = setTimeout(updatePreview, 80);
}

// ============================================================
// Slider events
// ============================================================
for (const [key, s] of Object.entries(S)) {
  s.el.addEventListener('input', () => {
    s.vEl.textContent = s.fmt(s.el.value);
    if (key === 'brightness' || key === 'bulbHeight' || key === 'height') {
      updateLightPos();
    }
    if (key !== 'brightness') {
      scheduleUpdate();
    }
  });
}

function hasUpperHood() {
  return shapeLantern.checked || (document.getElementById('projFloor').checked &&
    document.getElementById('upperShell').value === 'solid');
}

function updateVisibility() {
  document.getElementById('supportWidthRow').hidden = +document.getElementById('supportCount').value === 0;
  document.getElementById('topHookRow').hidden = !hasUpperHood();
  document.getElementById('upperShell').disabled = shapeLantern.checked || document.getElementById('projWall').checked;
  const upperShellHeightRow = document.getElementById('upperShellHeightRow');
  if (hasUpperHood()) {
    upperShellHeightRow.style.display = '';
  } else {
    upperShellHeightRow.style.display = 'none';
  }

  document.getElementById('upperShell').closest('label').hidden = shapeLantern.checked;
  if (lanternLithoSection) {
    lanternLithoSection.style.display = shapeLantern.checked ? '' : 'none';
    document.getElementById('reliefEditor').hidden = !lithoEnable.checked;
  }

  const bottomStyle = document.getElementById('bottomStyle').value;
  const bottomHoleRow = document.getElementById('bottomHoleRow');
  const bottomThicknessRow = document.getElementById('bottomThicknessRow');
  if (bottomStyle === 'closed') {
    bottomHoleRow.style.display = '';
    bottomThicknessRow.style.display = '';
  } else {
    bottomHoleRow.style.display = 'none';
    bottomThicknessRow.style.display = 'none';
  }
}
updateVisibility();

for (const radio of document.querySelectorAll('input[name="projMode"]')) {
  radio.addEventListener('change', () => { updateVisibility(); scheduleUpdate(); });
}
document.getElementById('baseShape').addEventListener('change', () => {
  const val = document.getElementById('baseShape').value;
  customShapeSection.style.display = val === 'custom' ? '' : 'none';
  matchPatternSection.style.display = val === 'match_pattern' ? '' : 'none';
  scheduleUpdate();
});
document.getElementById('upperShell').addEventListener('change', () => { updateVisibility(); scheduleUpdate(); });
document.getElementById('bottomStyle').addEventListener('change', () => { updateVisibility(); scheduleUpdate(); });
document.getElementById('supportCount').addEventListener('change', () => { updateVisibility(); scheduleUpdate(); });

// ============================================================
// Download STL
// ============================================================
downloadBtn.addEventListener('click', async () => {
  if (activeExport || (!silhouetteMaskBlob && !reliefSuppliesProjection())) return;
  const request = new AbortController();
  activeExport = request;
  showLoading('正在生成 STL…');
  downloadBtn.disabled = true;

  try {
    const fd = new FormData();
    const isLanternVal = shapeLantern.checked;
    const isLithoActive = isLanternVal && lithoEnable.checked && lithoLayers.length > 0;
    const mask = silhouetteMaskBlob;
    const original = uploadedFile;
    const compBlob = isLithoActive ? await getLithoCompositeBlob() : null;
    if (isLithoActive && !compBlob) throw new Error('无法读取浮雕图案。');
    if (request.signal.aborted) return;
    fd.append('image', original || compBlob, original?.name || 'relief.png');
    fd.append('silhouette_mask', mask || compBlob, 'silhouette-mask.png');
    fd.append('threshold', silThreshold ? silThreshold.value : '128');
    fd.append('invert', invertSilhouette && invertSilhouette.checked ? 'true' : 'false');
    fd.append('radius', parseFloat(S.diameter.el.value) / 2);
    fd.append('height', S.height.el.value);
    fd.append('thickness', S.thickness.el.value);
    fd.append('shadow_size', S.shadowSize.el.value);
    fd.append('resolution', S.resolution.el.value);
    fd.append('bulb_height', S.bulbHeight.el.value);
    const baseShapeVal = document.getElementById('baseShape').value;
    fd.append('base_shape', baseShapeVal);
    fd.append('keep_upper_shell', hasUpperHood() ? 'true' : 'false');
    fd.append('upper_shell_height', S.upperShellHeight.el.value);
    fd.append('support_count', document.getElementById('supportCount').value);
    fd.append('support_width', S.supportWidth.el.value);
    fd.append('with_bottom', document.getElementById('bottomStyle').value === 'closed' ? 'true' : 'false');
    fd.append('bottom_hole_diam', S.bottomHoleDiam.el.value);
    fd.append('bottom_thickness', S.bottomThickness.el.value);
    const projMode = document.querySelector('input[name="projMode"]:checked').value;
    fd.append('proj_mode', projMode);
    fd.append('shell_shape', isLanternVal ? 'lantern' : shapeCustom.checked ? 'custom' : shapeMatchPattern.checked ? 'match_pattern' : 'cylinder');
    fd.append('with_top_hook', (hasUpperHood() && topHookToggle.checked) ? 'true' : 'false');
    if (isLithoActive) {
      fd.append('litho_image', compBlob, 'litho_composite.png');
      fd.append('litho_min_thick', lithoMinThick.value);
      fd.append('litho_max_thick', lithoMaxThick.value);
      fd.append('litho_repeat', lithoRepeat.value);
      fd.append('litho_invert', lithoInvert.checked ? 'true' : 'false');
      fd.append('litho_width_scale', '100');
      fd.append('litho_height_scale', '100');
      fd.append('litho_offset', '0');
    }
    if (shapeCustom.checked && profileFile) fd.append('profile', profileFile);
    if (shapeMatchPattern.checked && patternProfileData) {
      fd.append('pattern_profile', JSON.stringify(Array.from(patternProfileData)));
    }
    if (baseShapeVal === 'custom' && customShapeRadii) {
      fd.append('custom_shape_radii', JSON.stringify(Array.from(customShapeRadii)));
    }
    if (baseShapeVal === 'match_pattern' && patternShapeRadii) {
      fd.append('custom_shape_radii', JSON.stringify(Array.from(patternShapeRadii)));
    }

    const resp = await fetch('/api/generate', { method: 'POST', body: fd, signal: request.signal });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || 'Generation failed');
    }
    const data = await resp.json();
    
    setStatus('ready', '正在下载…');
    const result = await fetch(data.url, {signal: request.signal});
    if (!result.ok) throw new Error('Could not download the generated STL.');
    const blobUrl = URL.createObjectURL(await result.blob());
    if (!request.signal.aborted) {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'shadow_lamp.stl';
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    if (request.signal.aborted) return;
    setStatus('ready', 'STL 已下载');
  } catch (e) {
    if (!request.signal.aborted) setStatus('error', '导出失败：' + e.message);
  } finally {
    if (activeExport === request) {
      activeExport = null;
      hideLoading();
      syncExportButton();
    }
  }
});

// ============================================================
// Reset
// ============================================================
resetBtn.addEventListener('click', () => {
  uploadEpoch++;
  resetSilhouetteUpload();
  profileFile = profileData = null;
  customShapeImageData = customShapeUploadCurrent = null;
  customShapeRadii = null;
  downloadBtn.disabled = true;
  fileInput.value = '';
  profileInput.value = '';
  customShapeInput.value = '';

  activeExport?.abort();
  activeExport = null;
  hideLoading();
  clearTimeout(debounce);
  clearLithoLayers();
  for (const zone of [uploadZone, profileZone, customShapeZone, lithoZone]) {
    zone.querySelector('img')?.remove();
    zone.classList.remove('has-image');
    for (const label of zone.querySelectorAll('.icon, .label, .sublabel')) label.style.display = '';
  }
  renderer.shadowMap.needsUpdate = true;
  requestRender();
  customShapeStatus.style.display = 'none';
  customShapeSection.style.display = 'none';
  matchPatternSection.style.display = 'none';
  matchPatternStatus.style.display = 'none';
  document.getElementById('baseShape').value = 'circle';

  if (hookMesh) {
    scene.remove(hookMesh);
    hookMesh.children.forEach(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    hookMesh = null;
  }
  if (previewMesh) { scene.remove(previewMesh); previewMesh.geometry.dispose(); previewMesh.material.dispose(); previewMesh = null; }
  needsCameraFit = true;
  document.getElementById('emptyStage').hidden = false;
  triCount.textContent = '—';
  syncExportButton();
  setStatus('', '等待上传图案');
});

// Demo Button
const demoBtn = document.getElementById('demoBtn');
if (demoBtn) {
  demoBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const revision = beginSilhouetteUpload('demo pattern');
    try {
      const response = await fetch('/test_star.png');
      if (!response.ok) throw new Error('Failed to fetch demo image.');
      const blob = await response.blob();
      if (revision !== silhouetteUploadRevision) return;
      const file = new File([blob], 'test_star.png', { type: 'image/png' });
      await loadSilhouetteUpload(file, revision, '示例');
    } catch (error) {
      if (revision === silhouetteUploadRevision && !activeExport) {
        setStatus('error', '示例加载失败：' + error.message);
      }
    }
  });
}

// ============================================================
// Helpers
// ============================================================
function setStatus(state, text) { statusDot.className = 'status-dot ' + state; statusText.textContent = text; }
function showLoading(t) { loadingTextEl.textContent = t; loadingOverlay.classList.add('visible'); }
function hideLoading() { loadingOverlay.classList.remove('visible'); }

// Inspector navigation and camera presets
const paneButtons = document.querySelectorAll('button[data-pane]');
for (const button of paneButtons) {
  button.addEventListener('click', () => {
    for (const item of paneButtons) {
      const selected = item === button;
      item.setAttribute('aria-pressed', String(selected));
      document.getElementById(item.dataset.pane).hidden = !selected;
    }
    document.querySelector('.scroll-panel').scrollTop = 0;
  });
}
for (const zone of document.querySelectorAll('.upload-zone')) {
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      zone.querySelector('input[type=file]').click();
    }
  });
}
lithoEnable.addEventListener('change', updateVisibility);
for (const radio of document.querySelectorAll('input[name=shellShape]')) {
  radio.addEventListener('change', () => { needsCameraFit = true; });
}

function setCameraView(view) {
  const center = new THREE.Vector3(0, 35, 0);
  const span = new THREE.Vector3(110, 110, 110);
  if (previewMesh) {
    const bounds = new THREE.Box3().setFromObject(previewMesh);
    if (hookMesh) bounds.expandByObject(hookMesh);
    bounds.getCenter(center);
    bounds.getSize(span);
  }
  const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const width = view === 'top' ? Math.max(span.x, +S.shadowSize.el.value) : Math.max(span.x, span.z);
  const height = view === 'top' ? width : span.y;
  const distance = (Math.max(height, width / camera.aspect) / (2 * Math.tan(halfFov)) +
    Math.max(span.x, span.z) * 0.52) * 1.25;
  if (view === 'top') center.y = 0;
  const direction = view === 'top' ? new THREE.Vector3(0, 1, 0.0001) :
    view === 'side' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(.8, .55, 1.25).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.update();
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  requestRender();
}
for (const button of document.querySelectorAll('button[data-view]')) {
  button.addEventListener('click', () => setCameraView(button.dataset.view));
}
controls.addEventListener('start', () => {
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', 'false');
});
document.getElementById('choosePattern').addEventListener('click', () => fileInput.click());
document.getElementById('previewDemo').addEventListener('click', () => demoBtn.click());
