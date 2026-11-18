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
const lithoHeight           = document.getElementById('lithoHeight');
const lithoHeightVal        = document.getElementById('lithoHeightVal');
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

let lithoFile = null;
let lithoData = null; // { width, height, data: Uint8Array }
let lithoLayers = [];
let selectedLithoLayerId = null;
let nextLithoLayerId = 1;
const lithoCanvasOffscreen = document.createElement('canvas');

const S = {
  brightness:       { el: document.getElementById('brightness'),       vEl: document.getElementById('brightnessVal'),       fmt: v => `${parseFloat(v).toFixed(1)}x` },
  bulbHeight:       { el: document.getElementById('bulbHeight'),       vEl: document.getElementById('bulbHeightVal'),       fmt: v => `${v} mm` },
  diameter:         { el: document.getElementById('diameter'),         vEl: document.getElementById('diameterVal'),         fmt: v => `${v} mm` },
  height:           { el: document.getElementById('height'),           vEl: document.getElementById('heightVal'),           fmt: v => v === '0' ? '0 mm (Stencil)' : `${v} mm` },
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
let profileFile  = null;
let imageData    = null;  // { width, height, data: Uint8Array grayscale }
let profileData  = null;  // Float32Array of radii (normalized 0-1)
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
scene.background = new THREE.Color(0x0a0e1a);

const camera   = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
camera.position.set(0, 180, 250);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 40, 0);

// Lights
const ptLight = new THREE.PointLight(0xfff4e0, 6, 2000, 0.3);
ptLight.castShadow = true;
ptLight.shadow.mapSize.set(4096, 4096);
ptLight.shadow.camera.near = 10;
ptLight.shadow.camera.far = 400;
ptLight.shadow.radius = 1.5;
scene.add(ptLight);
const ambLight = new THREE.AmbientLight(0x334466, 0.4);
scene.add(ambLight);

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
scene.add(wallMesh);

const grid = new THREE.GridHelper(800, 40, 0x1a2440, 0x111827);
scene.add(grid);

function updateLightPos() {
  const H = parseFloat(S.height.el.value);
  const brightness = parseFloat(S.brightness.el.value);
  const bulbH = parseFloat(S.bulbHeight.el.value);
  ptLight.position.set(0, bulbH, 0);
  ptLight.intensity = brightness * 2;
  ptLight.distance = 600 + brightness * 200;
  ambLight.intensity = 0.2 + brightness * 0.08;
  bulb.position.copy(ptLight.position);
  bulb.scale.setScalar(0.5 + brightness * 0.3);
}
updateLightPos();

// ============================================================
// Resize & Loop
// ============================================================
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
resize();
window.addEventListener('resize', resize);

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

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
  const upperH = parseFloat(S.upperShellHeight.el.value) || 50;
  const circ = 2 * Math.PI * R;
  const aspect = circ / Math.max(upperH, 1.0);
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
  offCtx.fillStyle = '#ffffff';
  offCtx.fillRect(0, 0, W, H);

  for (const layer of lithoLayers) {
    drawLayerToContext(offCtx, layer, W, H);
  }

  // 2. Extract grayscale buffer for 3D preview & STL
  if (extractBuffer && lithoLayers.length > 0) {
    const imgData = offCtx.getImageData(0, 0, W, H);
    const px = imgData.data;
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
    }
    lithoData = { width: W, height: H, data: gray };
    if (!imageData) imageData = lithoData;
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
  const src = layer.canvas || layer.img;

  ctx.drawImage(src, lx, ly, lw, lh);
  // Seamless 360 wrap around horizontal seam
  if (lx + lw > W) {
    ctx.drawImage(src, lx - W, ly, lw, lh);
  }
  if (lx < 0) {
    ctx.drawImage(src, lx + W, ly, lw, lh);
  }
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
  if (lx < 0) drawBox(lx + W, ly);
}

function addLithoLayerFromDataUrl(name, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    const aspect = origW / origH;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = origW;
    layerCanvas.height = origH;
    const lctx = layerCanvas.getContext('2d');
    lctx.drawImage(img, 0, 0);

    const imgData = lctx.getImageData(0, 0, origW, origH);
    const px = imgData.data;

    // Check transparency
    let hasAlpha = false;
    let transCount = 0, opaqueCount = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) transCount++;
      if (px[i + 3] > 20) opaqueCount++;
    }
    if (transCount > 20 && opaqueCount > 20) hasAlpha = true;

    if (hasAlpha) {
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        const val = a > 30 ? 0 : 255;
        px[i] = val;
        px[i + 1] = val;
        px[i + 2] = val;
        px[i + 3] = 255;
      }
    } else {
      for (let i = 0; i < px.length; i += 4) {
        const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
        px[i] = g;
        px[i + 1] = g;
        px[i + 2] = g;
        px[i + 3] = 255;
      }
    }
    lctx.putImageData(imgData, 0, 0);

    const R = parseFloat(S.diameter.el.value) / 2;
    const upperH = parseFloat(S.upperShellHeight.el.value) || 50;
    const circ = 2 * Math.PI * R;
    const canvasAspect = circ / Math.max(upperH, 1.0);

    const initH = 0.75;
    let initW = initH * aspect / canvasAspect;
    if (initW > 0.7) initW = 0.7;
    if (initW < 0.08) initW = 0.08;

    let initX = 0.5 - initW / 2;
    if (lithoLayers.length > 0) {
      const last = lithoLayers[lithoLayers.length - 1];
      initX = (last.x + last.w + 0.04) % 1.0;
    }
    let initY = (1.0 - initH) / 2;

    const layerId = nextLithoLayerId++;
    const layer = {
      id: layerId,
      name: name || `图案 ${layerId}`,
      img: img,
      canvas: layerCanvas,
      x: initX,
      y: initY,
      w: initW,
      h: initH,
      origAspect: aspect
    };

    lithoLayers.push(layer);
    selectedLithoLayerId = layerId;

    renderLithoFlatCanvas(true);
    if (lithoStatus) {
      lithoStatus.style.display = 'flex';
      lithoStatus.className = 'custom-shape-status success';
      lithoStatus.textContent = `✓ 已添加图案 (${origW}×${origH})，可直接在平面上拖动/拉伸长宽`;
    }
    downloadBtn.disabled = false;
    scheduleUpdate();
  };
  img.src = dataUrl;
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

    for (let offset of [0, (lx + lw > W ? -W : 0), (lx < 0 ? W : 0)]) {
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
      if (px >= bx && px <= bx + lw && py >= by && py <= by + lh) {
        return { type: 'move', handle: null, layer: selLayer };
      }
    }
  }

  for (let i = lithoLayers.length - 1; i >= 0; i--) {
    const l = lithoLayers[i];
    const lx = l.x * W;
    const ly = l.y * H;
    const lw = l.w * W;
    const lh = l.h * H;
    for (let offset of [0, (lx + lw > W ? -W : 0), (lx < 0 ? W : 0)]) {
      const bx = lx + offset;
      if (px >= bx && px <= bx + lw && py >= ly && py <= ly + lh) {
        return { type: 'select', handle: null, layer: l };
      }
    }
  }

  return { type: 'none', handle: null, layer: null };
}

if (lithoFlatCanvas) {
  lithoFlatCanvas.addEventListener('pointerdown', (e) => {
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

    if (pointerAction.mode === 'move') {
      layer.x = (pointerAction.startLayer.x + dx) % 1.0;
      if (layer.x < 0) layer.x += 1.0;
      layer.y = Math.max(0, Math.min(1.0 - layer.h, pointerAction.startLayer.y + dy));
      renderLithoFlatCanvas(false);
      scheduleUpdate();
    } else if (pointerAction.mode === 'resize') {
      const hnd = pointerAction.handle;
      const s = pointerAction.startLayer;

      if (hnd === 'r') {
        layer.w = Math.max(0.04, Math.min(1.5, s.w + dx));
      } else if (hnd === 'l') {
        const nw = Math.max(0.04, Math.min(1.5, s.w - dx));
        layer.x = (s.x + (s.w - nw)) % 1.0;
        layer.w = nw;
      } else if (hnd === 'b') {
        layer.h = Math.max(0.08, Math.min(1.0 - layer.y, s.h + dy));
      } else if (hnd === 't') {
        const nh = Math.max(0.08, s.h - dy);
        layer.y = Math.max(0, s.y + (s.h - nh));
        layer.h = nh;
      } else if (hnd === 'br') {
        layer.w = Math.max(0.04, Math.min(1.5, s.w + dx));
        layer.h = Math.max(0.08, Math.min(1.0 - layer.y, s.h + dy));
      } else if (hnd === 'tr') {
        layer.w = Math.max(0.04, Math.min(1.5, s.w + dx));
        const nh = Math.max(0.08, s.h - dy);
        layer.y = Math.max(0, s.y + (s.h - nh));
        layer.h = nh;
      } else if (hnd === 'bl') {
        const nw = Math.max(0.04, Math.min(1.5, s.w - dx));
        layer.x = (s.x + (s.w - nw)) % 1.0;
        layer.w = nw;
        layer.h = Math.max(0.08, Math.min(1.0 - layer.y, s.h + dy));
      } else if (hnd === 'tl') {
        const nw = Math.max(0.04, Math.min(1.5, s.w - dx));
        layer.x = (s.x + (s.w - nw)) % 1.0;
        layer.w = nw;
        const nh = Math.max(0.08, s.h - dy);
        layer.y = Math.max(0, s.y + (s.h - nh));
        layer.h = nh;
      }
      renderLithoFlatCanvas(false);
      scheduleUpdate();
    }
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
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      for (const file of e.dataTransfer.files) {
        processFile(file, (f, dataUrl) => {
          lithoFile = f;
          addLithoLayerFromDataUrl(f.name, dataUrl);
        });
      }
    }
  });
}

// Action buttons
if (btnAddMoreLitho && lithoAddMoreInput) {
  btnAddMoreLitho.addEventListener('click', () => lithoAddMoreInput.click());
  lithoAddMoreInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) {
      for (const file of e.target.files) {
        processFile(file, (f, dataUrl) => {
          lithoFile = f;
          addLithoLayerFromDataUrl(f.name, dataUrl);
        });
      }
      lithoAddMoreInput.value = '';
    }
  });
}

if (btnDeleteLithoLayer) {
  btnDeleteLithoLayer.addEventListener('click', () => {
    if (selectedLithoLayerId !== null) {
      lithoLayers = lithoLayers.filter(l => l.id !== selectedLithoLayerId);
      selectedLithoLayerId = lithoLayers.length ? lithoLayers[lithoLayers.length - 1].id : null;
      renderLithoFlatCanvas(true);
      scheduleUpdate();
    }
  });
}

if (btnCenterLithoLayer) {
  btnCenterLithoLayer.addEventListener('click', () => {
    const sel = lithoLayers.find(l => l.id === selectedLithoLayerId);
    if (sel) {
      sel.x = Math.max(0, 0.5 - sel.w / 2);
      renderLithoFlatCanvas(true);
      scheduleUpdate();
    }
  });
}

if (btnFitHeightLithoLayer) {
  btnFitHeightLithoLayer.addEventListener('click', () => {
    const sel = lithoLayers.find(l => l.id === selectedLithoLayerId);
    if (sel) {
      sel.y = 0;
      sel.h = 1.0;
      renderLithoFlatCanvas(true);
      scheduleUpdate();
    }
  });
}

if (btnClearAllLitho) {
  btnClearAllLitho.addEventListener('click', () => {
    lithoLayers = [];
    selectedLithoLayerId = null;
    lithoData = null;
    renderLithoFlatCanvas(true);
    scheduleUpdate();
  });
}

window.addEventListener('keydown', (e) => {
  if (selectedLithoLayerId !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    lithoLayers = lithoLayers.filter(l => l.id !== selectedLithoLayerId);
    selectedLithoLayerId = lithoLayers.length ? lithoLayers[lithoLayers.length - 1].id : null;
    renderLithoFlatCanvas(true);
    scheduleUpdate();
  }
});

// Hook initial upload zone to flat canvas studio
if (lithoZone && lithoInput) {
  setupUpload(lithoZone, lithoInput, (file, dataUrl) => {
    lithoFile = file;
    showThumb(lithoZone, dataUrl);
    addLithoLayerFromDataUrl(file.name, dataUrl);
  });
}

if (lithoHeight) {
  lithoHeight.addEventListener('input', () => {
    if (lithoHeightVal) lithoHeightVal.textContent = lithoHeight.value + ' mm';
    if (S.upperShellHeight.el) S.upperShellHeight.el.value = lithoHeight.value;
    if (S.upperShellHeight.vEl) S.upperShellHeight.vEl.textContent = lithoHeight.value + ' mm';
    renderLithoFlatCanvas(true);
    scheduleUpdate();
  });
}
if (S.upperShellHeight.el) {
  S.upperShellHeight.el.addEventListener('input', () => {
    if (lithoHeight) lithoHeight.value = S.upperShellHeight.el.value;
    if (lithoHeightVal) lithoHeightVal.textContent = S.upperShellHeight.el.value + ' mm';
    renderLithoFlatCanvas(true);
  });
}
if (S.diameter.el) {
  S.diameter.el.addEventListener('input', () => {
    renderLithoFlatCanvas(true);
  });
}

if (lithoMinThick) lithoMinThick.addEventListener('input', () => { lithoMinThickVal.textContent = lithoMinThick.value + ' mm'; scheduleUpdate(); });
if (lithoMaxThick) lithoMaxThick.addEventListener('input', () => { lithoMaxThickVal.textContent = lithoMaxThick.value + ' mm'; scheduleUpdate(); });
if (lithoRepeat)   lithoRepeat.addEventListener('change', scheduleUpdate);
if (lithoInvert)   lithoInvert.addEventListener('change', scheduleUpdate);
if (lithoEnable)   lithoEnable.addEventListener('change', scheduleUpdate);

function logDebug(msg, color='#8ba4d0') {
  console.log('[App]', msg);
  let el = document.getElementById('debugConsole');
  if (!el) {
    el = document.createElement('div');
    el.id = 'debugConsole';
    el.style.cssText = 'position:fixed;bottom:10px;right:10px;max-width:320px;max-height:160px;overflow-y:auto;background:rgba(10,14,26,0.9);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;font-size:11px;font-family:monospace;z-index:99999;color:#fff;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
    document.body.appendChild(el);
  }
  el.innerHTML += `<div style="color:${color};margin-top:2px;">• ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

window.addEventListener('error', e => {
  logDebug(`[Error] ${e.message} at ${e.filename || 'app.js'}:${e.lineno || 0}`, '#ff6b6b');
});

// Silhouette Controls
const silThreshold    = document.getElementById('silThreshold');
const silThresholdVal = document.getElementById('silThresholdVal');
const invertSilhouette = document.getElementById('invertSilhouette');
let uploadedDataUrl   = null;

if (silThreshold) {
  silThreshold.addEventListener('input', () => {
    if (silThresholdVal) silThresholdVal.textContent = silThreshold.value;
    if (uploadedDataUrl) reprocessSilhouette();
  });
}
if (invertSilhouette) {
  invertSilhouette.addEventListener('change', () => {
    if (uploadedDataUrl) reprocessSilhouette();
  });
}

function reprocessSilhouette() {
  if (!uploadedDataUrl) return;
  loadSmartSilhouette(uploadedDataUrl, (w, h, gray, binarizedDataUrl) => {
    imageData = { width: w, height: h, data: gray };
    if (binarizedDataUrl) {
      showThumb(uploadZone, binarizedDataUrl);
    }
    extractPatternRadialProfile();
    scheduleUpdate();
  });
}

// ============================================================
// Image Upload
// ============================================================
setupUpload(uploadZone, fileInput, (file, dataUrl) => {
  uploadedFile = file;
  uploadedDataUrl = dataUrl;
  logDebug(`File loaded: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, '#74c0fc');
  loadSmartSilhouette(dataUrl, (w, h, gray, binarizedDataUrl) => {
    imageData = { width: w, height: h, data: gray };
    downloadBtn.disabled = false;
    showThumb(uploadZone, binarizedDataUrl || dataUrl);
    setStatus('ready', `Silhouette loaded: ${w}×${h}`);
    logDebug(`Contour silhouette generated: ${w}×${h}`, '#51cf66');
    extractPatternRadialProfile();
    scheduleUpdate();
  });
});

setupUpload(profileZone, profileInput, (file, dataUrl) => {
  profileFile = file;
  showThumb(profileZone, dataUrl);
  loadGrayscale(dataUrl, (w, h, gray) => {
    profileData = extractProfile(w, h, gray);
    setStatus('ready', 'Custom profile loaded');
    scheduleUpdate();
  });
});

function setupUpload(zone, input, cb) {
  if (!zone || !input) return;
  zone.style.cursor = 'pointer';
  zone.addEventListener('click', (e) => {
    if (e.target !== input) {
      input.click();
    }
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      logDebug(`Dropped: ${e.dataTransfer.files[0].name}`, '#fcc419');
      processFile(e.dataTransfer.files[0], cb);
    }
  });
  input.addEventListener('change', (e) => {
    if (e.target && e.target.files && e.target.files.length) {
      logDebug(`Selected: ${e.target.files[0].name}`, '#fcc419');
      processFile(e.target.files[0], cb);
    }
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

function loadSmartSilhouette(dataUrl, cb) {
  const img = new Image();
  img.onload = () => {
    try {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const px = imgData.data;
      const gray = new Uint8Array(w * h);

      const thresh = silThreshold ? parseInt(silThreshold.value) : 128;
      const isInvert = invertSilhouette ? invertSilhouette.checked : false;

      // 1. Check transparency (Alpha channel)
      let alphaTransCount = 0;
      let alphaOpaqueCount = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) alphaTransCount++;
        if (px[i + 3] > 20) alphaOpaqueCount++;
      }
      const hasAlpha = alphaTransCount > 20 && alphaOpaqueCount > 20;

      if (hasAlpha) {
        // Transparent PNG (去背图): 直接提取整个图案的外部轮廓为纯黑剪影，不辨别内部黑白色
        for (let i = 0; i < w * h; i++) {
          const a = px[i * 4 + 3];
          let isSolid = a > 30;
          if (isInvert) isSolid = !isSolid;
          gray[i] = isSolid ? 0 : 255;
        }
      } else {
        // 2. Colored RGB image: sample 4 borders to determine background color
        let rSum = 0, gSum = 0, bSum = 0, borderCount = 0;
        for (let x = 0; x < w; x++) {
          const idxTop = (0 * w + x) * 4;
          const idxBot = ((h - 1) * w + x) * 4;
          rSum += px[idxTop] + px[idxBot];
          gSum += px[idxTop + 1] + px[idxBot + 1];
          bSum += px[idxTop + 2] + px[idxBot + 2];
          borderCount += 2;
        }
        for (let y = 1; y < h - 1; y++) {
          const idxL = (y * w + 0) * 4;
          const idxR = (y * w + (w - 1)) * 4;
          rSum += px[idxL] + px[idxR];
          gSum += px[idxL + 1] + px[idxR + 1];
          bSum += px[idxL + 2] + px[idxR + 2];
          borderCount += 2;
        }
        const bgR = rSum / borderCount;
        const bgG = gSum / borderCount;
        const bgB = bSum / borderCount;

        // Compute color distances from detected border background
        let maxDist = 0;
        const dists = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const dr = px[i * 4] - bgR;
          const dg = px[i * 4 + 1] - bgG;
          const db = px[i * 4 + 2] - bgB;
          const d = Math.sqrt(dr * dr + dg * dg + db * db);
          dists[i] = d;
          if (d > maxDist) maxDist = d;
        }

        if (maxDist > 30.0) {
          // Color contrast detected: distance thresholding
          const cutoff = Math.max(20.0, Math.min(140.0, maxDist * (thresh / 255.0)));
          for (let i = 0; i < w * h; i++) {
            let isSolid = dists[i] >= cutoff;
            if (isInvert) isSolid = !isSolid;
            gray[i] = isSolid ? 0 : 255;
          }
        } else {
          // Standard grayscale luminance thresholding
          for (let i = 0; i < w * h; i++) {
            const lum = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
            let isSolid = lum < thresh;
            if (isInvert) isSolid = !isSolid;
            gray[i] = isSolid ? 0 : 255;
          }
        }
      }

      // Generate black-on-white silhouette preview thumbnail
      const outImgData = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const val = gray[i];
        outImgData.data[i * 4 + 0] = val;
        outImgData.data[i * 4 + 1] = val;
        outImgData.data[i * 4 + 2] = val;
        outImgData.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(outImgData, 0, 0);
      const binarizedDataUrl = c.toDataURL('image/png');

      cb(w, h, gray, binarizedDataUrl);
    } catch (e) {
      logDebug(`Silhouette error: ${e.message}`, '#ff6b6b');
      console.error("Silhouette error:", e);
    }
  };
  img.onerror = () => {
    logDebug('Image decode failed', '#ff6b6b');
  };
  img.src = dataUrl;
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
setupUpload(customShapeZone, customShapeInput, (file, dataUrl) => {
  customShapeImageData = dataUrl;
  showThumb(customShapeZone, dataUrl);
  reprocessCustomShape();
});

async function reprocessCustomShape() {
  if (!customShapeImageData) return;
  const threshold = parseInt(customThresholdEl.value);
  const smooth = parseInt(customSmoothEl.value);
  const result = await extractCustomShapeContour(customShapeImageData, threshold, smooth);
  if (result) {
    customShapeRadii = result.radii;
    showCustomShapeStatus('success', `✓ Shape extracted — ${result.pointCount} contour points`);
    setStatus('ready', 'Custom shape loaded');
    scheduleUpdate();
  } else {
    customShapeRadii = null;
    showCustomShapeStatus('error', '✗ No valid contour found — try adjusting threshold');
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

  // 1. Determine image polarity from border pixels
  //    If borders are mostly dark → figure is light → invert
  let borderDark = 0, borderTotal = 0;
  for (let x = 0; x < w; x++) {
    if (gray[0 * w + x] < threshold) borderDark++;          // top row
    if (gray[(h - 1) * w + x] < threshold) borderDark++;    // bottom row
    borderTotal += 2;
  }
  for (let y = 1; y < h - 1; y++) {
    if (gray[y * w + 0] < threshold) borderDark++;           // left col
    if (gray[y * w + (w - 1)] < threshold) borderDark++;     // right col
    borderTotal += 2;
  }
  const invert = (borderDark / borderTotal) > 0.5;

  // 2. Build binary and find centroid of figure pixels
  let cx = 0, cy = 0, figCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isFigure = invert ? (gray[y * w + x] >= threshold) : (gray[y * w + x] < threshold);
      if (isFigure) {
        cx += x;
        cy += y;
        figCount++;
      }
    }
  }
  if (figCount < 10) {
    patternShapeRadii = null;
    if (matchPatternStatus) {
      matchPatternStatus.style.display = 'flex';
      matchPatternStatus.className = 'custom-shape-status error';
      matchPatternStatus.textContent = '✗ No pattern shape detected';
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
      const isFigure = invert ? (gray[py * w + px] >= threshold) : (gray[py * w + px] < threshold);
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
      const isFig = invert ? (gray[row * w + x] >= threshold) : (gray[row * w + x] < threshold);
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
    matchPatternStatus.textContent = `✓ Pattern shape extracted (${invert ? 'light-on-dark' : 'dark-on-light'})`;
  }
  // Always re-render to pick up the new radii
  scheduleUpdate();
}



// ============================================================
// Client-side preview (cylinder/custom shell)
// ============================================================
function buildPreview() {
  if (!imageData && !lithoData) return null;

  const R      = parseFloat(S.diameter.el.value) / 2;
  const H_lower = parseFloat(S.height.el.value);
  const H_base = H_lower === 0 ? 0.1 : H_lower;
  const shadow = parseFloat(S.shadowSize.el.value);
  const hLight = parseFloat(S.bulbHeight.el.value);
  const res    = parseInt(S.resolution.el.value);
  const nZ     = res;
  const nPhi   = res;
  const isLantern = shapeLantern && shapeLantern.checked;
  const keepUpperShell = document.getElementById('upperShell').value === 'solid';
  const hasUpperHood = isLantern || keepUpperShell;
  const upperShellHeight = parseFloat(S.upperShellHeight.el.value);
  const supportCount = parseInt(document.getElementById('supportCount').value);
  const supportWidth = parseFloat(S.supportWidth.el.value);

  const projMode = document.querySelector('input[name="projMode"]:checked').value;
  // Total height of lamp: lower body (H_base) + upper hood (upperShellHeight)
  const H = H_base + (hasUpperHood ? upperShellHeight : 0);
  const solidTopZ = H;
  const hLimit = H;

  const baseShape = document.getElementById('baseShape').value;
  const isCustomShape = baseShape === 'custom' && customShapeRadii;
  const isMatchPattern = baseShape === 'match_pattern' && patternShapeRadii;
  let nSides = 0;
  if (!isCustomShape && !isMatchPattern) {
    if (baseShape === 'triangle') nSides = 3;
    else if (baseShape === 'square') nSides = 4;
    else if (baseShape === 'pentagon') nSides = 5;
    else if (baseShape === 'hexagon') nSides = 6;
  }

  // Determine active shape radii (custom upload or auto-extracted from pattern)
  const activeShapeRadii = isCustomShape ? customShapeRadii : (isMatchPattern ? patternShapeRadii : null);

  const imgRef = imageData || lithoData;
  if (!imgRef) return null;
  const { width: W, height: IH, data: gray } = imgRef;
  const shadowW = shadow, shadowH = shadow * IH / W;

  // Profile radii at each z node (nZ+1)
  const rProfile = new Float32Array(nZ + 1);
  const activeProfile = (shapeCustom.checked && profileData) ? profileData
                      : (shapeMatchPattern.checked && patternProfileData) ? patternProfileData
                      : null;
  if (activeProfile) {
    for (let i = 0; i <= nZ; i++) {
      const t = i / nZ * (activeProfile.length - 1);
      const lo = Math.floor(t), hi = Math.min(lo + 1, activeProfile.length - 1);
      rProfile[i] = R * Math.max(0.02, activeProfile[lo] + (activeProfile[hi] - activeProfile[lo]) * (t - lo));
    }
  } else {
    rProfile.fill(R);
  }


  const hasBottom = document.getElementById('bottomStyle').value === 'closed';
  const bottomHoleDiam = parseFloat(S.bottomHoleDiam.el.value);
  const numBottomVerts = hasBottom ? nPhi * 4 : 0;

  const dzStep = H / nZ;
  const dPhi   = (2 * Math.PI) / nPhi;

  // Vertex grid (nZ+1) * nPhi + bottom plate
  // Helper: compute scale factor for a given phi angle
  function getShapeScale(phi) {
    if (activeShapeRadii) {
      // Interpolate shape radii at this angle
      let angleDeg = ((phi * 180 / Math.PI) % 360 + 360) % 360;
      const idx0 = Math.floor(angleDeg) % 360;
      const idx1 = (idx0 + 1) % 360;
      const frac = angleDeg - Math.floor(angleDeg);
      return activeShapeRadii[idx0] * (1 - frac) + activeShapeRadii[idx1] * frac;
    } else if (nSides >= 3) {
      const segment = (2 * Math.PI) / nSides;
      const theta = (((phi + segment / 2.0) % segment) + segment) % segment - (segment / 2.0);
      return 1.0 / Math.cos(theta);
    }
    return 1.0;
  }

  const isLitho = isLantern && lithoEnable && lithoEnable.checked && lithoData;
  const tMin = lithoMinThick ? parseFloat(lithoMinThick.value) : 1.2;
  const tMax = lithoMaxThick ? parseFloat(lithoMaxThick.value) : 3.0;
  const repeat = lithoRepeat ? parseInt(lithoRepeat.value) : 1;
  const inv = lithoInvert ? lithoInvert.checked : false;

  const hasTopRoof = keepUpperShell || isLantern;
  const numRoofVerts = hasTopRoof ? 1 : 0;
  const totalVertCount = (nZ + 1) * nPhi + numBottomVerts + numRoofVerts;
  const verts = new Float32Array(totalVertCount * 3);
  const colors = new Float32Array(totalVertCount * 3);

  // Modern matte slate base color for lower shadow lamp body
  const baseColor = [0.42, 0.48, 0.58];
  const lanternWhiteColor = [0.94, 0.94, 0.96];

  for (let i = 0; i <= nZ; i++) {
    const y = i * dzStep;  // Y-up in Three.js
    const r_base = rProfile[i];
    const isUpper = y >= H_base - 1e-4;

    for (let j = 0; j < nPhi; j++) {
      const phi = j * dPhi;
      const scale = getShapeScale(phi);
      let r = r_base * scale;

      let rCol = baseColor[0], gCol = baseColor[1], bCol = baseColor[2];

      if (isUpper && (isLantern || keepUpperShell)) {
        if (isLitho && upperShellHeight > 0 && lithoData) {
          // Direct 360° unwrapped plane mapping:
          // phi in [0, 2*PI] maps directly to horizontal u in [0, 1]
          const phiNorm = ((phi / (2 * Math.PI)) % 1.0 + 1.0) % 1.0;
          const u = phiNorm * (lithoData.width - 1);

          // y in [H_base, H_base + upperShellHeight] maps to vertical v in [0, 1]
          const yNorm = Math.min(1.0, Math.max(0.0, (y - H_base) / upperShellHeight));
          const v = (1.0 - yNorm) * (lithoData.height - 1);

          let g = bilinearSample(lithoData.data, lithoData.width, lithoData.height, u, v);
          if (inv) g = 255 - g;
          const reliefThick = tMin + (1.0 - g / 255.0) * (tMax - tMin);
          r += reliefThick;

          // Warm translucent PLA lithophane backlighting:
          const factor = 1.0 - g / 255.0; // 0 (brightest, thinnest) -> 1 (darkest, thickest)
          rCol = 1.00 - factor * 0.58;
          gCol = 0.97 - factor * 0.64;
          bCol = 0.91 - factor * 0.69;
        } else {
          // White translucent lantern hood
          rCol = lanternWhiteColor[0];
          gCol = lanternWhiteColor[1];
          bCol = lanternWhiteColor[2];
        }
      }

      const idx = (i * nPhi + j) * 3;
      verts[idx]     = r * Math.cos(phi);
      verts[idx + 1] = y;
      verts[idx + 2] = r * Math.sin(phi);

      colors[idx]     = rCol;
      colors[idx + 1] = gCol;
      colors[idx + 2] = bCol;
    }
  }

  // Bottom disc vertices colors
  if (numBottomVerts > 0) {
    const vOffset = (nZ + 1) * nPhi;
    for (let k = 0; k < numBottomVerts; k++) {
      const idx = (vOffset + k) * 3;
      colors[idx]     = baseColor[0];
      colors[idx + 1] = baseColor[1];
      colors[idx + 2] = baseColor[2];
    }
  }

  let yApex = solidTopZ;
  if (hasTopRoof) {
    yApex = solidTopZ + (isLantern ? 10 : 5);
    const apexIdx = (nZ + 1) * nPhi + numBottomVerts;
    verts[apexIdx * 3 + 0] = 0;
    verts[apexIdx * 3 + 1] = yApex;
    verts[apexIdx * 3 + 2] = 0;

    colors[apexIdx * 3 + 0] = isLantern ? 0.96 : baseColor[0];
    colors[apexIdx * 3 + 1] = isLantern ? 0.94 : baseColor[1];
    colors[apexIdx * 3 + 2] = isLantern ? 0.90 : baseColor[2];
  }

  if (projMode === 'wall') {
    floorMesh.visible = false;
    wallMesh.visible = true;
  } else {
    floorMesh.visible = true;
    wallMesh.visible = false;
  }
  const indices = [];
  let solidN = 0, totalN = 0;

  // --- Pass 1: compute per-column solid state below hLight ---
  // solidGrid[i][j] = true if cell (i,j) is solid from ray-trace
  const solidGrid = [];
  for (let i = 0; i < nZ; i++) {
    solidGrid[i] = new Uint8Array(nPhi);
    const zC = (i + 0.5) * dzStep;
    const rC = (rProfile[i] + rProfile[i + 1]) / 2;
    for (let j = 0; j < nPhi; j++) {
      const phiC = (j + 0.5) * dPhi;
      let solid = false;

      if (projMode === 'wall') {
        const uF = (j / nPhi) * W;
        const vF = (1 - (i / nZ)) * IH;
        solid = bilinearSample(gray, W, IH, uF, vF) < 128;
      } else if (zC < hLight - 1e-6) {
        const t = hLight / (hLight - zC);
        const scale = getShapeScale(phiC);
        const rC_poly = rC * scale;
        const xF = rC_poly * Math.cos(phiC) * t;
        const zF = rC_poly * Math.sin(phiC) * t;
        const uF = (xF / shadowW + 0.5) * W;
        const vF = (zF / shadowH + 0.5) * IH;
        if (uF >= 0 && uF < W && vF >= 0 && vF < IH) {
          solid = bilinearSample(gray, W, IH, uF, vF) < 128;
        }
      }

      // Support columns
      if (supportCount > 0) {
        const angleStep = (2 * Math.PI) / supportCount;
        for (let k = 0; k < supportCount; k++) {
          let diff = Math.abs(phiC - k * angleStep);
          diff = Math.min(diff, 2 * Math.PI - diff);
          if (diff < (supportWidth / 2.0) / rC) { solid = true; break; }
        }
      }

      if (i === 0) solid = true;
      solidGrid[i][j] = solid ? 1 : 0;
    }
  }

  // --- Per-column top limit (solid upper shell hood vs hollow cutouts) ---
  const colLimit = new Float32Array(nPhi);
  if (projMode !== 'wall') {
    if (hasUpperHood) {
      colLimit.fill(solidTopZ);
    } else {
      for (let j = 0; j < nPhi; j++) {
        let topZ = 0;
        for (let i = 0; i < nZ; i++) {
          const zC = (i + 0.5) * dzStep;
          if (zC < hLight && solidGrid[i][j]) topZ = zC;
        }
        colLimit[j] = topZ;
      }
    }
  } else {
    colLimit.fill(H);
  }

  // --- Pass 2: build final solid state and index buffer ---
  for (let i = 0; i < nZ; i++) {
    const zC = (i + 0.5) * dzStep;
    const rC = (rProfile[i] + rProfile[i + 1]) / 2;
    for (let j = 0; j < nPhi; j++) {
      const phiC = (j + 0.5) * dPhi;
      totalN++;
      let solid;
      if (zC < hLight - 1e-6) {
        // Lower shadow lamp body: strictly follow shadow stencils / ray-tracing
        solid = !!solidGrid[i][j];
      } else {
        // Upper shell: solid lantern hood (with relief if uploaded)
        solid = hasUpperHood ? (zC < solidTopZ) : (zC < colLimit[j]);
      }

      // Ensure support columns extend all the way up to the lantern roof/cap
      if (supportCount > 0) {
        const angleStep = (2 * Math.PI) / supportCount;
        for (let k = 0; k < supportCount; k++) {
          let diff = Math.abs(phiC - k * angleStep);
          diff = Math.min(diff, 2 * Math.PI - diff);
          if (diff < (supportWidth / 2.0) / rC) {
            solid = true;
            break;
          }
        }
      }

      if (solid) {
        solidN++;
        const v00 = i * nPhi + j;
        const v01 = i * nPhi + (j + 1) % nPhi;
        const v10 = (i + 1) * nPhi + j;
        const v11 = (i + 1) * nPhi + (j + 1) % nPhi;
        indices.push(v00, v01, v11, v00, v11, v10);
      }
    }
  }

  if (hasBottom) {
    const rHoleDiam = Math.min(bottomHoleDiam / 2.0, R - 5.0);
    const tPlate = parseFloat(S.thickness.el.value);
    
    const startIdx = (nZ + 1) * nPhi * 3;
    for (let j = 0; j < nPhi; j++) {
      const phi = j * dPhi;
      const scale = getShapeScale(phi);
      
      const rInner0 = rProfile[0] * scale;
      const tRatio = tPlate / H;
      const tNode = tRatio * nZ;
      const lo = Math.floor(tNode), hi = Math.min(lo + 1, nZ);
      const rInnerT = (rProfile[lo] + (rProfile[hi] - rProfile[lo]) * (tNode - lo)) * scale;

      const idxIb0 = startIdx + (0 * nPhi + j) * 3;
      const idxIbt = startIdx + (1 * nPhi + j) * 3;
      const idxHb0 = startIdx + (2 * nPhi + j) * 3;
      const idxHbt = startIdx + (3 * nPhi + j) * 3;

      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      verts[idxIb0]     = rInner0 * cosP;
      verts[idxIb0 + 1] = 0;
      verts[idxIb0 + 2] = rInner0 * sinP;

      verts[idxIbt]     = rInnerT * cosP;
      verts[idxIbt + 1] = tPlate;
      verts[idxIbt + 2] = rInnerT * sinP;

      verts[idxHb0]     = rHoleDiam * cosP;
      verts[idxHb0 + 1] = 0;
      verts[idxHb0 + 2] = rHoleDiam * sinP;

      verts[idxHbt]     = rHoleDiam * cosP;
      verts[idxHbt + 1] = tPlate;
      verts[idxHbt + 2] = rHoleDiam * sinP;
    }

    const vOffset = (nZ + 1) * nPhi;
    for (let j = 0; j < nPhi; j++) {
      const jp1 = (j + 1) % nPhi;

      const ib0 = vOffset + 0 * nPhi + j;
      const ibt = vOffset + 1 * nPhi + j;
      const hb0 = vOffset + 2 * nPhi + j;
      const hbt = vOffset + 3 * nPhi + j;

      const ib0_jp1 = vOffset + 0 * nPhi + jp1;
      const ibt_jp1 = vOffset + 1 * nPhi + jp1;
      const hb0_jp1 = vOffset + 2 * nPhi + jp1;
      const hbt_jp1 = vOffset + 3 * nPhi + jp1;

      indices.push(ib0, hb0_jp1, hb0);
      indices.push(ib0, ib0_jp1, hb0_jp1);

      indices.push(ibt, ibt_jp1, hbt_jp1);
      indices.push(ibt, hbt_jp1, hbt);

      indices.push(hb0, hbt, hbt_jp1);
      indices.push(hb0, hbt_jp1, hb0_jp1);
    }
  }

  // Top roof cap facets connecting top active ring to apex
  if (hasTopRoof) {
    const apexIdx = (nZ + 1) * nPhi + numBottomVerts;
    const topI = nZ;
    for (let j = 0; j < nPhi; j++) {
      const jp1 = (j + 1) % nPhi;
      indices.push(apexIdx, topI * nPhi + j, topI * nPhi + jp1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, solidN, totalN, yApex };
}

function updatePreview() {
  try {
    if (previewMesh) {
      scene.remove(previewMesh);
      previewMesh.geometry.dispose();
      previewMesh.material.dispose();
      previewMesh = null;
    }
    const r = buildPreview();
    if (!r) return;

    previewMesh = new THREE.Mesh(r.geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.45,
      side: THREE.DoubleSide
    }));
    previewMesh.castShadow = true;
    previewMesh.receiveShadow = true;
    scene.add(previewMesh);

    // Hanging Hook (顶部挂钩)
    if (hookMesh) {
      scene.remove(hookMesh);
      hookMesh.children.forEach(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      hookMesh = null;
    }
    const isLantern = shapeLantern && shapeLantern.checked;
    const showHook = (topHookToggle && topHookToggle.checked) || isLantern;
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

    triCount.textContent = `Faces: ${r.solidN * 2} | Holes: ${r.totalN - r.solidN}`;
    updateLightPos();
    logDebug(`3D Mesh generated: ${r.solidN * 2} faces`, '#74c0fc');
  } catch (err) {
    console.error("Preview render error:", err);
    setStatus('error', `Preview error: ${err.message}`);
    logDebug(`Preview render error: ${err.message}`, '#ff6b6b');
  }
}

function scheduleUpdate() {
  clearTimeout(debounce);
  debounce = setTimeout(updatePreview, 80);
}

// ============================================================
// Slider events
// ============================================================
for (const [key, s] of Object.entries(S)) {
  s.el.addEventListener('input', () => {
    s.vEl.textContent = s.fmt(s.el.value);
    if (key === 'height') {
      // Sync bulb height with lower shell height
      S.bulbHeight.el.value = s.el.value;
      S.bulbHeight.vEl.textContent = s.el.value + ' mm';
    }
    if (key === 'upperShellHeight' && lithoHeight) {
      lithoHeight.value = s.el.value;
      if (lithoHeightVal) lithoHeightVal.textContent = s.el.value + ' mm';
    }
    if (key === 'brightness' || key === 'bulbHeight' || key === 'height') {
      updateLightPos();
    }
    if (key !== 'brightness') {
      scheduleUpdate();
    }
  });
}

function updateVisibility() {
  const upperShell = document.getElementById('upperShell').value;
  const projMode = document.querySelector('input[name="projMode"]:checked').value;
  const upperShellHeightRow = document.getElementById('upperShellHeightRow');
  if (upperShell === 'solid' && projMode === 'floor') {
    upperShellHeightRow.style.display = '';
  } else {
    upperShellHeightRow.style.display = 'none';
  }

  if (lanternLithoSection) {
    lanternLithoSection.style.display = (shapeLantern && shapeLantern.checked) ? '' : 'none';
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
document.getElementById('supportCount').addEventListener('change', scheduleUpdate);

// ============================================================
// Download STL
// ============================================================
downloadBtn.addEventListener('click', async () => {
  if (!uploadedFile) return;
  showLoading('Generating STL — please wait…');
  downloadBtn.disabled = true;

  const fd = new FormData();
  fd.append('image', uploadedFile);
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
  fd.append('keep_upper_shell', document.getElementById('upperShell').value === 'solid' ? 'true' : 'false');
  fd.append('upper_shell_height', S.upperShellHeight.el.value);
  fd.append('support_count', document.getElementById('supportCount').value);
  fd.append('support_width', S.supportWidth.el.value);
  fd.append('with_bottom', document.getElementById('bottomStyle').value === 'closed' ? 'true' : 'false');
  fd.append('bottom_hole_diam', S.bottomHoleDiam.el.value);
  fd.append('bottom_thickness', S.bottomThickness.el.value);
  const projMode = document.querySelector('input[name="projMode"]:checked').value;
  fd.append('proj_mode', projMode);
  const isLanternVal = shapeLantern && shapeLantern.checked;
  const isLithoActive = isLanternVal && lithoEnable && lithoEnable.checked && (lithoLayers.length > 0 || lithoFile);
  fd.append('shell_shape', isLanternVal ? 'lantern' : shapeCustom.checked ? 'custom' : shapeMatchPattern.checked ? 'match_pattern' : 'cylinder');
  fd.append('with_top_hook', ((topHookToggle && topHookToggle.checked) || isLanternVal) ? 'true' : 'false');
  if (isLithoActive) {
    if (lithoLayers.length > 0) {
      const compBlob = await getLithoCompositeBlob();
      if (compBlob) {
        fd.append('litho_image', compBlob, 'litho_composite.png');
      } else if (lithoFile) {
        fd.append('litho_image', lithoFile);
      }
    } else if (lithoFile) {
      fd.append('litho_image', lithoFile);
    }
    fd.append('litho_min_thick', lithoMinThick.value);
    fd.append('litho_max_thick', lithoMaxThick.value);
    fd.append('litho_repeat', '1');
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

  try {
    const resp = await fetch('/api/generate', { method: 'POST', body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || 'Generation failed');
    }
    const data = await resp.json();
    
    setStatus('ready', 'Downloading...');
    window.location.href = data.url;
    setStatus('ready', 'STL downloaded ✓');
  } catch (e) {
    setStatus('error', `Error: ${e.message}`);
  } finally {
    hideLoading();
    downloadBtn.disabled = false;
  }
});

// ============================================================
// Reset
// ============================================================
resetBtn.addEventListener('click', () => {
  uploadedFile = profileFile = imageData = profileData = null;
  customShapeImageData = null;
  customShapeRadii = null;
  patternShapeRadii = null;
  patternProfileData = null;
  downloadBtn.disabled = true;
  fileInput.value = '';
  profileInput.value = '';
  customShapeInput.value = '';

  [uploadZone, profileZone, customShapeZone].forEach((z, idx) => {
    const labels = [
      ['🌗', 'Drop silhouette image here', 'PNG / JPG — black & white'],
      ['🏺', 'Drop profile side-view', 'Black silhouette on white'],
      ['✂️', 'Drop shape image here', 'PNG / JPG — black silhouette on white'],
    ][idx];
    z.innerHTML = `<div class="icon">${labels[0]}</div><div class="label">${labels[1]}</div><div class="sublabel">${labels[2]}</div>`;
    z.classList.remove('has-image');
  });

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
  triCount.textContent = 'Faces: —';
  setStatus('', 'No image loaded');
});

// Demo Button
const demoBtn = document.getElementById('demoBtn');
if (demoBtn) {
  demoBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      setStatus('loading', 'Loading demo pattern...');
      const response = await fetch('/test_star.png');
      if (!response.ok) throw new Error('Failed to fetch demo image');
      const blob = await response.blob();
      const file = new File([blob], 'test_star.png', { type: 'image/png' });
      uploadedFile = file;
      uploadedDataUrl = dataUrl;
      loadSmartSilhouette(dataUrl, (w, h, gray, binarizedDataUrl) => {
        imageData = { width: w, height: h, data: gray };
        downloadBtn.disabled = false;
        showThumb(uploadZone, binarizedDataUrl || dataUrl);
        setStatus('ready', `Demo loaded: ${w}×${h}`);
        extractPatternRadialProfile();
        scheduleUpdate();
      });
    } catch (err) {
      setStatus('error', 'Failed to load demo: ' + err.message);
    }
  });
}

// ============================================================
// Helpers
// ============================================================
function setStatus(state, text) { statusDot.className = 'status-dot ' + state; statusText.textContent = text; }
function showLoading(t) { loadingTextEl.textContent = t; loadingOverlay.classList.add('visible'); }
function hideLoading() { loadingOverlay.classList.remove('visible'); }

logDebug('App initialized successfully (v27)', '#51cf66');
