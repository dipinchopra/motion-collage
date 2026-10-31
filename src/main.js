import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeline, env } from '@huggingface/transformers';
import { Output, MovOutputFormat, BufferTarget, CanvasSource } from 'mediabunny';
import './style.css';

env.allowLocalModels = false;
env.useBrowserCache = true;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const canvas = $('#stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f1f0ed');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.2, 5.6);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 9;
controls.enablePan = false;
const pivot = new THREE.Group();
scene.add(pivot);
scene.add(new THREE.AmbientLight('#fff7e7', 2.2));
const key = new THREE.DirectionalLight('#ffcf91', 3.5); key.position.set(-3, 4, 5); scene.add(key);
const fill = new THREE.DirectionalLight('#75d8d0', 2); fill.position.set(4, -2, 2); scene.add(fill);

const photoCount = () => state.assets.filter((asset) => asset.kind !== 'text').length;
const state = { assets: [], segmenter: null, mode: 'standard', speed: 0.55, direction: 1, depth: 0.7, scale: 1, pivotY: 0, positionX: 0, positionY: 0, canvasColor: '#f1f0ed', backgroundTexture: null, backgroundBitmap: null, exporting: false, frame: 0, turntableAngle: 0, nextLayerOrder: 0, selectedAsset: 0, playing: true };

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  $('.stage-wrap').style.setProperty('--preview-width', `${rect.width}px`);
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function drawTexture(image, mask, inverted = false) {
  const output = document.createElement('canvas'); output.width = image.width; output.height = image.height;
  const ctx = output.getContext('2d'); ctx.drawImage(image, 0, 0);
  const maskCanvas = document.createElement('canvas'); maskCanvas.width = mask.width; maskCanvas.height = mask.height;
  const maskContext = maskCanvas.getContext('2d');
  const maskPixels = maskContext.createImageData(mask.width, mask.height);
  for (let index = 0; index < mask.data.length; index++) {
    const value = mask.data[index] <= 1 ? mask.data[index] * 255 : mask.data[index];
    maskPixels.data[index * 4] = 255;
    maskPixels.data[index * 4 + 1] = 255;
    maskPixels.data[index * 4 + 2] = 255;
    maskPixels.data[index * 4 + 3] = value;
  }
  maskContext.putImageData(maskPixels, 0, 0);
  const scaledMask = document.createElement('canvas'); scaledMask.width = image.width; scaledMask.height = image.height;
  scaledMask.getContext('2d').drawImage(maskCanvas, 0, 0, image.width, image.height);
  const alphaData = scaledMask.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  const pixels = ctx.getImageData(0, 0, output.width, output.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const maskValue = alphaData[i + 3];
    const alpha = inverted ? 255 - maskValue : maskValue;
    pixels.data[i + 3] = alpha;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(output); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

function addLayers() {
  pivot.traverse((object) => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
  pivot.clear();
  state.assets.forEach((asset, assetIndex) => {
    const axis = new THREE.Group();
    // Every image plane passes through the same vertical center line.
    axis.position.set(0, 0, 0);
    pivot.add(axis);
    asset.axis = axis;
    axis.rotation.y = state.turntableAngle + assetIndex * state.depth;
    const aspect = asset.image.width / asset.image.height;
    asset.layers.forEach((layer) => {
      const material = new THREE.MeshBasicMaterial({ map: layer.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(asset.kind === 'text' ? 2.1 : Math.min(aspect, 1.4) * 2.1, asset.kind === 'text' ? 2.1 / aspect : 2.1), material);
      mesh.position.set(0, state.pivotY + layer.height, 0);
      mesh.rotation.y = 0;
      mesh.rotation.z = layer.angle;
      mesh.scale.setScalar(asset.size * state.scale * layer.scale);
      mesh.visible = layer.visible;
      mesh.renderOrder = layer.order;
      axis.add(mesh);
      layer.mesh = mesh;
    });
  });
  updateLayerList();
}

function selectedText() {
  const asset = state.assets[state.selectedAsset];
  return asset?.kind === 'text' ? asset : null;
}

function syncTextControls() {
  const asset = selectedText();
  $('#text-controls').hidden = !asset;
  $('#add-text').disabled = state.assets.filter((entry) => entry.kind === 'text').length >= 10;
  if (!asset) return;
  $('#text-content').value = asset.text;
  $('#text-size').value = asset.layers[0].scale;
  $('#text-height').value = asset.layers[0].height;
  $('#text-color').value = asset.color;
  $('#text-visibility').textContent = asset.layers[0].visible ? 'Hide text' : 'Show text';
  $('#text-visibility').setAttribute('aria-pressed', String(asset.layers[0].visible));
  $$('[data-font]').forEach((button) => { const active = button.dataset.font === asset.font; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
}

async function renderText(asset) {
  const revision = asset.revision = (asset.revision || 0) + 1;
  const weight = asset.font === 'Manrope' ? 800 : 400;
  try {
    await document.fonts.load(`${weight} 100px "${asset.font}"`);
  } catch (error) {
    console.error(error);
    $('#font-status').textContent = 'Font could not load. Try again.';
    return false;
  }
  if (revision !== asset.revision || !state.assets.includes(asset)) return false;
  $('#font-status').textContent = '';
  const surface = document.createElement('canvas');
  const context = surface.getContext('2d');
  context.font = `${weight} 100px "${asset.font}"`;
  const lines = [];
  for (const paragraph of asset.text.split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (context.measureText(line + character).width > 900 && line) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  surface.width = 1024;
  const fontSize = Math.min(100, 1800 / (Math.max(1, lines.length) * 1.4));
  const lineHeight = fontSize * 1.4;
  surface.height = Math.max(180, Math.ceil(lines.length * lineHeight + 100));
  context.font = `${weight} ${fontSize}px "${asset.font}"`;
  context.fillStyle = asset.color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(line, 512, 50 + lineHeight / 2 + index * lineHeight));
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  const layer = asset.layers[0];
  const previous = layer.texture;
  layer.texture = texture;
  asset.image = surface;
  asset.cutoutUrl = surface.toDataURL();
  if (layer.mesh) {
    layer.mesh.material.map = texture;
    layer.mesh.material.needsUpdate = true;
    layer.mesh.geometry.dispose();
    layer.mesh.geometry = new THREE.PlaneGeometry(2.1, 2.1 * surface.height / surface.width);
    layer.mesh.visible = layer.visible;
  }
  previous?.dispose();
  const thumbnail = $(`[data-select-asset="${state.assets.indexOf(asset)}"] img`);
  if (thumbnail) thumbnail.src = asset.cutoutUrl;
  return true;
}

function queueText(asset) {
  asset.pending = renderText(asset);
  return asset.pending;
}

async function addText() {
  if (state.exporting || state.assets.filter((asset) => asset.kind === 'text').length >= 10) return;
  const placeholder = document.createElement('canvas');
  placeholder.width = 1024; placeholder.height = 180;
  const asset = { image: placeholder, cutoutUrl: placeholder.toDataURL(), kind: 'text', text: 'Your text', font: 'Manrope', color: '#171717', size: 1, layers: [{ texture: new THREE.CanvasTexture(placeholder), kind: 'text', visible: true, height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ }] };
  state.assets.push(asset);
  state.selectedAsset = state.assets.length - 1;
  addLayers();
  openSheet('text');
  // Focus during the tap event so mobile browsers can open the keyboard.
  $('#text-content').focus();
  $('#text-content').select();
  const rendered = await queueText(asset);
  if (!rendered && asset.revision === 1 && state.assets.includes(asset)) {
    asset.layers[0].texture.dispose();
    state.assets.splice(state.assets.indexOf(asset), 1);
    addLayers();
  }
}

function allLayers() {
  return state.assets.flatMap((asset, assetIndex) => asset.layers.map((layer) => ({ asset, assetIndex, layer })));
}

function updateLayerList() {
  $('#empty-state').classList.toggle('hidden', state.assets.length > 0);
  const list = $('#layer-list');
  list.innerHTML = state.assets.length ? state.assets.map((asset, index) => `<button class="cutout-tile ${asset.kind === 'text' ? 'text-tile' : ''} ${index === state.selectedAsset ? 'selected' : ''} ${asset.layers.some((layer) => layer.visible) ? '' : 'muted'}" data-select-asset="${index}" aria-label="Edit ${asset.kind === 'text' ? 'text' : 'photo'} ${index + 1}" aria-pressed="${index === state.selectedAsset}"><img src="${asset.cutoutUrl}" alt=""><span>${String(index + 1).padStart(2, '0')}</span></button>`).join('') : '<span class="tray-placeholder">Your cutouts go here</span>';
  const selected = state.assets[state.selectedAsset];
  const asset = selected?.kind === 'text' ? null : selected;
  const editor = $('#cutout-editor');
  $('#selected-caption').textContent = asset ? `Photo ${state.selectedAsset + 1}` : 'Select a photo above';
  editor.innerHTML = asset ? `<div class="layer-options">${asset.layers.map((layer, index) => `<button class="layer-option ${layer.visible ? 'on' : ''}" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="visibility" aria-pressed="${layer.visible}"><img src="${index === 0 ? asset.cutoutUrl : asset.previewUrl}" alt=""><span>${index === 0 ? 'Cutout' : 'Background'}</span><i>${layer.visible ? '✓' : '+'}</i></button>`).join('')}</div>${asset.layers.map((layer, index) => `<div class="layer-detail ${layer.visible ? '' : 'inactive'}"><div class="layer-detail-head"><span>${index === 0 ? 'Cutout' : 'Background'}</span><div><button aria-label="Move ${index === 0 ? 'cutout' : 'background'} backward" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="back">↓</button><button aria-label="Move ${index === 0 ? 'cutout' : 'background'} forward" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="forward">↑</button></div></div><div class="mask-controls">${[['height','Height',-0.8,0.8],['angle','Tilt',-1.2,1.2],['scale','Size',0.4,1.4]].map(([key,label,min,max]) => `<label>${label}<input aria-label="${index === 0 ? 'Cutout' : 'Background'} ${label.toLowerCase()}" type="range" min="${min}" max="${max}" step="0.01" value="${layer[key]}" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="${key}"></label>`).join('')}</div></div>`).join('')}<button class="delete-photo" data-asset-index="${state.selectedAsset}" data-layer-action="delete">Remove photo</button>` : '<p class="no-selection">Add a photo to start editing.</p>';
  list.querySelectorAll('[data-select-asset]').forEach((button) => button.addEventListener('click', () => { state.selectedAsset = Number(button.dataset.selectAsset); updateLayerList(); openSheet(state.assets[state.selectedAsset].kind === 'text' ? 'text' : 'cutouts'); }));
  $('#asset-meta').textContent = `${photoCount()} / 5`;
  $('#upload-trigger').disabled = photoCount() >= 5;
  $('#export-btn').disabled = !state.assets.length;
  editor.querySelectorAll('[data-layer-index]').forEach((input) => input.addEventListener(input.tagName === 'BUTTON' ? 'click' : 'input', (event) => {
    const asset = state.assets[Number(event.currentTarget.dataset.assetIndex)];
    const layer = asset.layers[Number(event.currentTarget.dataset.layerIndex)];
    if (event.currentTarget.dataset.layerAction === 'height') layer.height = Number(event.currentTarget.value);
    if (event.currentTarget.dataset.layerAction === 'angle') layer.angle = Number(event.currentTarget.value);
    if (event.currentTarget.dataset.layerAction === 'scale') layer.scale = Number(event.currentTarget.value);
    if (event.currentTarget.dataset.layerAction === 'visibility') layer.visible = !layer.visible;
    if (event.currentTarget.dataset.layerAction === 'forward' || event.currentTarget.dataset.layerAction === 'back') {
      const direction = event.currentTarget.dataset.layerAction === 'forward' ? 1 : -1;
      const ordered = allLayers().map((entry) => entry.layer).sort((a, b) => a.order - b.order);
      const position = ordered.indexOf(layer);
      const neighbor = ordered[position + direction];
      if (neighbor) [layer.order, neighbor.order] = [neighbor.order, layer.order];
    }
    if (['forward', 'back', 'visibility'].includes(event.currentTarget.dataset.layerAction)) addLayers();
    else if (layer.mesh) {
      layer.mesh.position.y = state.pivotY + layer.height;
      layer.mesh.rotation.z = layer.angle;
      layer.mesh.scale.setScalar(asset.size * state.scale * layer.scale);
    }
  }));
  editor.querySelectorAll('[data-layer-action="delete"]').forEach((button) => button.addEventListener('click', (event) => {
    const index = Number(event.currentTarget.dataset.assetIndex);
    const asset = state.assets[index];
    URL.revokeObjectURL(asset.previewUrl);
    asset.layers.forEach((layer) => layer.texture.dispose());
    asset.image.close();
    state.assets.splice(index, 1);
    state.selectedAsset = Math.max(0, Math.min(state.selectedAsset, state.assets.length - 1));
    $('#asset-meta').textContent = `${photoCount()} / 5`;
    $('#empty-state').classList.toggle('hidden', state.assets.length > 0);
    addLayers();
  }));
  syncTextControls();
}

async function loadModel() {
  $('#model-status').textContent = 'Setting up background removal…';
  $('#model-progress').classList.add('visible');
  state.segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', { device: 'wasm', dtype: 'q8' , progress_callback: (progress) => {
    if (progress.status === 'progress' && progress.total) $('#model-progress-fill').style.width = `${Math.round(progress.progress || 0)}%`;
  }});
  $('#model-progress-fill').style.width = '100%'; $('#model-status').textContent = 'Ready to cut';
}

function isHeic(file) {
  return /\.hei[cf]$/i.test(file.name) || ['image/heic', 'image/heif'].includes(file.type.toLowerCase());
}

function isSupportedImage(file) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|hei[cf])$/i.test(file.name);
}

async function prepareImageFile(file) {
  if (!isHeic(file)) return file;
  $('#model-status').textContent = 'Opening HEIC photo…';
  $('#model-progress').classList.add('visible');
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(result) ? result[0] : result;
  const convertedName = file.name.replace(/\.hei[cf]$/i, '') + '.jpg';
  return new File([blob], convertedName, { type: 'image/jpeg', lastModified: file.lastModified });
}

async function segmentImage(file) {
  $('#model-status').textContent = 'Opening your photo…'; $('#model-progress').classList.add('visible');
  if (!state.segmenter) await loadModel();
  const preparedFile = await prepareImageFile(file);
  const image = await createImageBitmap(preparedFile);
  $('#model-status').textContent = 'Removing background…'; $('#model-progress-fill').style.width = '100%';
  const result = await state.segmenter(preparedFile);
  const mask = result[0]?.mask;
  if (!mask?.data || !mask.width || !mask.height) throw new Error('RMBG returned an invalid mask');
  const maskTexture = drawTexture(image, mask, false);
  const invertedTexture = drawTexture(image, mask, true);
  state.assets.push({ file, image, previewUrl: URL.createObjectURL(preparedFile), cutoutUrl: maskTexture.image.toDataURL(), size: 0.66 + (state.assets.length % 3) * 0.09, layers: [
    { kind: 'mask', label: 'MASK', texture: maskTexture, visible: state.mode !== 'inverted', height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ },
    { kind: 'invert', label: 'INVERT', texture: invertedTexture, visible: state.mode === 'inverted', height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ }
  ] });
  state.selectedAsset = state.assets.length - 1;
  addLayers();
  $('#empty-state').classList.add('hidden'); $('#asset-meta').textContent = `${photoCount()} / 5`;
  $('#model-status').textContent = 'Cutout ready';
  $('#model-progress').classList.remove('visible');
}

function applyModeToAll(mode) { state.mode = mode; state.assets.forEach((asset) => asset.layers.forEach((layer) => { layer.visible = layer.kind === (mode === 'inverted' ? 'invert' : 'mask'); })); addLayers(); }
function syncControls() {
  state.speed = Number($('#speed').value);
  state.depth = Number($('#depth').value);
  state.scale = Number($('#scale').value);
  state.pivotY = Number($('#pivot-y').value);
  state.positionX = Number($('#position-x').value);
  state.positionY = Number($('#position-y').value);
  pivot.position.set(state.positionX, state.positionY, 0);
  state.assets.forEach((asset, index) => {
    asset.axis.rotation.y = state.turntableAngle + index * state.depth;
    asset.layers.forEach((layer) => {
      layer.mesh.position.set(0, state.pivotY + layer.height, 0);
      layer.mesh.scale.setScalar(asset.size * state.scale * layer.scale);
      layer.mesh.rotation.set(0, 0, layer.angle);
    });
  });
  for (const [id, value] of [['speed', state.speed], ['depth', state.depth], ['scale', state.scale], ['pivot-y', state.pivotY], ['position-x', state.positionX], ['position-y', state.positionY]]) {
    $(`#${id}-value`).textContent = `${value.toFixed(2)}${id === 'speed' ? '×' : ''}`;
  }
}

function setCanvasColor(color) {
  state.canvasColor = color;
  if (!state.backgroundTexture) scene.background = new THREE.Color(color);
  $('.stage-wrap').style.setProperty('--canvas-color', color);
}

function clearBackgroundImage() {
  if (state.backgroundTexture) state.backgroundTexture.dispose();
  if (state.backgroundBitmap) state.backgroundBitmap.close();
  state.backgroundTexture = null;
  state.backgroundBitmap = null;
  scene.background = new THREE.Color(state.canvasColor);
  $('#background-image-meta').textContent = '';
  $('#background-image-clear').classList.remove('visible');
  $('#background-image').value = '';
}

async function setBackgroundImage(file) {
  const preparedFile = await prepareImageFile(file);
  // ImageBitmap textures bypass Three.js's texture.flipY handling, so orient
  // the pixels for WebGL while decoding them.
  const bitmap = await createImageBitmap(preparedFile, { imageOrientation: 'flipY' });
  if (state.backgroundTexture) state.backgroundTexture.dispose();
  if (state.backgroundBitmap) state.backgroundBitmap.close();
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  state.backgroundBitmap = bitmap;
  state.backgroundTexture = texture;
  scene.background = texture;
  $('#background-image-meta').textContent = file.name.toUpperCase();
  $('#background-image-clear').classList.add('visible');
}

async function exportLoop() {
  if (!state.assets.length || state.exporting || uploading) return;
  state.exporting = true; $('.bottom-dock').classList.add('recording'); $('#share-trigger').disabled = true; $('#export-btn').disabled = true; $('#export-progress').classList.add('visible'); $('#export-status').textContent = 'EXPORTING LOOP...';
  await Promise.all(state.assets.filter((asset) => asset.kind === 'text').map((asset) => asset.pending));
  const width = 1080, height = 1920, fps = 60, frames = 600;
  const exportCanvas = document.createElement('canvas'); exportCanvas.width = width; exportCanvas.height = height;
  const exportRenderer = new THREE.WebGLRenderer({ canvas: exportCanvas, antialias: true, preserveDrawingBuffer: true }); exportRenderer.setSize(width, height, false); exportRenderer.outputColorSpace = THREE.SRGBColorSpace; exportRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  const previousCameraAspect = camera.aspect;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const target = new BufferTarget();
  const output = new Output({ format: new MovOutputFormat(), target });
  const videoSource = new CanvasSource(exportCanvas, { codec: 'avc', bitrate: 8_000_000, keyFrameInterval: 1 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  try {
  await output.start();
  for (let frame = 0; frame < frames; frame++) {
    state.turntableAngle = (frame / frames) * Math.PI * 2 * state.direction;
    state.assets.forEach((asset, index) => { asset.axis.rotation.y = state.turntableAngle + index * state.depth; });
    exportRenderer.render(scene, camera);
    await videoSource.add(frame / fps, 1 / fps, { keyFrame: frame % 60 === 0 });
    if (frame % 6 === 0) $('#export-progress-fill').style.width = `${Math.round((frame / frames) * 100)}%`;
    await new Promise(requestAnimationFrame);
  }
  await output.finalize();
  const blob = new Blob([target.buffer], { type: 'video/quicktime' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url; link.download = 'motion-loop.mov'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  $('#export-progress-fill').style.width = '100%';
  $('#export-status').textContent = 'Video saved';
  } catch (error) {
    console.error(error);
    $('#export-status').textContent = 'Could not save video. Try again in a browser with video encoding support.';
  } finally {
    exportRenderer.dispose();
    camera.aspect = previousCameraAspect;
    camera.updateProjectionMatrix();
    $('#export-btn').disabled = false;
    $('#share-trigger').disabled = false;
    $('.bottom-dock').classList.remove('recording');
    state.exporting = false;
    resize();
  }
}

let uploading = false;
const handleUpload = async (files) => {
  if (uploading || state.exporting) return;
  uploading = true;
  $('#upload-trigger').setAttribute('aria-busy', 'true');
  $('#upload-trigger').disabled = true;
  $('#empty-upload').disabled = true;
  const incoming = Array.from(files || []).filter(isSupportedImage).slice(0, 5 - photoCount());
  try {
    for (const file of incoming) await segmentImage(file).catch((error) => { console.error(error); $('#model-status').textContent = 'Could not create cutout. Try another photo.'; });
  } finally { uploading = false; $('#upload-trigger').setAttribute('aria-busy', 'false'); $('#upload').value = ''; $('#upload-trigger').disabled = photoCount() >= 5; $('#empty-upload').disabled = false; }
};
$('#upload').addEventListener('change', (event) => handleUpload(event.target.files));
$('#upload-trigger').addEventListener('click', () => $('#upload').click());
$('#upload-trigger').addEventListener('dragover', (event) => { event.preventDefault(); $('#upload-trigger').classList.add('dragging'); });
$('#upload-trigger').addEventListener('dragleave', () => $('#upload-trigger').classList.remove('dragging'));
$('#upload-trigger').addEventListener('drop', (event) => { event.preventDefault(); $('#upload-trigger').classList.remove('dragging'); handleUpload(event.dataTransfer.files); });
$$('#speed, #depth, #scale, #pivot-y, #position-x, #position-y').forEach((input) => input.addEventListener('input', syncControls));
$('#speed').addEventListener('input', () => $$('[data-speed]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.speed) === state.speed)));
$('#canvas-color').addEventListener('input', (event) => setCanvasColor(event.target.value));
$('#background-image-trigger').addEventListener('click', () => $('#background-image').click());
$('#background-image').addEventListener('change', (event) => {
  const file = Array.from(event.target.files || []).find(isSupportedImage);
  if (file) setBackgroundImage(file).catch((error) => { console.error(error); $('#background-image-meta').textContent = 'BACKGROUND ERROR · RETRY'; });
});
$('#background-image-clear').addEventListener('click', clearBackgroundImage);
$('#direction').addEventListener('click', () => { state.direction *= -1; $('#direction').classList.toggle('reverse', state.direction < 0); });
$('#export-btn').addEventListener('click', exportLoop);

function animate() { requestAnimationFrame(animate); if (!state.exporting && state.playing) { state.turntableAngle += 0.0025 * state.speed * state.direction; state.assets.forEach((asset, index) => { asset.axis.rotation.y = state.turntableAngle + index * state.depth; }); } controls.update(); renderer.render(scene, camera); }
let currentSheet = null;
function openSheet(name) {
  currentSheet = name;
  if (name === 'text') {
    if (state.assets[state.selectedAsset]?.kind !== 'text') {
      const index = state.assets.findIndex((asset) => asset.kind === 'text');
      if (index >= 0) { state.selectedAsset = index; updateLayerList(); }
    }
    syncTextControls();
  }
  $$('[data-sheet]').forEach((tab) => { const active = tab.dataset.sheet === name; tab.classList.toggle('active', active); tab.setAttribute('aria-expanded', String(active)); });
  $$('.sheet').forEach((sheet) => sheet.classList.toggle('active', sheet.id === `sheet-${name}`));
}
$$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(currentSheet === button.dataset.sheet ? null : button.dataset.sheet)));
$$('.sheet-close').forEach((button) => button.addEventListener('click', () => openSheet(null)));
$('#share-trigger').addEventListener('click', () => openSheet('share'));
$$('[data-color]').forEach((button) => button.addEventListener('click', () => { clearBackgroundImage(); setCanvasColor(button.dataset.color); $('#canvas-color').value = button.dataset.color; $$('[data-color]').forEach((swatch) => swatch.classList.toggle('selected', swatch === button)); }));
$$('[data-speed]').forEach((button) => button.addEventListener('click', () => { $('#speed').value = button.dataset.speed; syncControls(); $$('[data-speed]').forEach((preset) => preset.classList.toggle('selected', preset === button)); }));
$('#empty-upload').addEventListener('click', () => $('#upload').click());
$('#play-toggle').addEventListener('click', () => { state.playing = !state.playing; $('#play-toggle').textContent = state.playing ? 'Ⅱ' : '▶'; $('#play-toggle').setAttribute('aria-label', state.playing ? 'Pause motion' : 'Play motion'); });
$('#clean-preview').addEventListener('click', () => { const clean = document.body.classList.toggle('clean-mode'); $('#clean-preview').setAttribute('aria-label', clean ? 'Back to editing' : 'Enter clean preview'); $('#clean-preview').innerHTML = clean ? '✕' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>'; resize(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { openSheet(null); document.body.classList.remove('clean-mode'); resize(); } });
$('#add-text').addEventListener('click', addText);
$('#text-content').addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; asset.text = event.currentTarget.value; queueText(asset); });
$$('[data-font]').forEach((button) => button.addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.font = button.dataset.font; syncTextControls(); renderText(asset); }));
$('#text-color').addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; asset.color = event.currentTarget.value; queueText(asset); });
for (const [id, key] of [['text-size', 'scale'], ['text-height', 'height']]) {
  $(`#${id}`).addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; const layer = asset.layers[0]; layer[key] = Number(event.currentTarget.value); layer.mesh.scale.setScalar(asset.size * state.scale * layer.scale); layer.mesh.position.y = state.pivotY + layer.height; });
}
$('#text-visibility').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.layers[0].visible = !asset.layers[0].visible; addLayers(); });
$('#delete-text').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.layers[0].texture.dispose(); state.assets.splice(state.selectedAsset, 1); state.selectedAsset = Math.max(0, Math.min(state.selectedAsset, state.assets.length - 1)); addLayers(); });
function fitViewport() {
  document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
fitViewport();
new ResizeObserver(resize).observe($('.stage-wrap'));
$('#export-btn').disabled = true;
updateLayerList(); resize(); animate();
