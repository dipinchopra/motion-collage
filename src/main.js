import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Output, MovOutputFormat, BufferTarget, CanvasSource } from 'mediabunny';
import './style.css';
import orangeTiles from '../background/ -5.jpg';
import burgundyTiles from '../background/ -6.jpg';
import redTiles from '../background/ -7.jpg';
import bluePlaid from '../background/ -8.jpg';

const mobileDevice = matchMedia('(pointer: coarse)').matches;
const imageLimit = mobileDevice ? 768 : 1280;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const canvas = $('#stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f1f0ed');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.2, 5.6);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobileDevice, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobileDevice ? 1.5 : 2));
canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); $('#render-status').hidden = false; });
canvas.addEventListener('webglcontextrestored', () => { $('#render-status').hidden = true; resize(); });
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
const state = { assets: [], mode: 'standard', speed: 0.55, direction: 1, depth: 0.7, scale: 1, pivotY: 0, positionX: 0, positionY: 0, canvasColor: '#f1f0ed', backgroundTexture: null, backgroundBitmap: null, exporting: false, frame: 0, turntableAngle: 0, nextLayerOrder: 0, selectedAsset: 0, playing: true };

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  $('.stage-wrap').style.setProperty('--preview-width', `${rect.width}px`);
  const size = renderer.getSize(new THREE.Vector2());
  if (Math.round(size.x) !== Math.round(rect.width) || Math.round(size.y) !== Math.round(rect.height)) renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
  camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function textureFromCanvas(surface) {
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function releaseTexture(texture) {
  if (!texture) return;
  texture.dispose();
  if (texture.image instanceof HTMLCanvasElement) texture.image.width = texture.image.height = 1;
}

function thumbnailUrl(image) {
  const surface = document.createElement('canvas');
  const ratio = Math.min(1, 160 / Math.max(image.width, image.height));
  surface.width = Math.max(1, Math.round(image.width * ratio));
  surface.height = Math.max(1, Math.round(image.height * ratio));
  surface.getContext('2d').drawImage(image, 0, 0, surface.width, surface.height);
  const url = surface.toDataURL('image/png');
  surface.width = surface.height = 1;
  return url;
}

async function decodeImage(file, limit = imageLimit, flip = false) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  const surface = document.createElement('canvas');
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not open this image')); image.src = url; });
    const ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    surface.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    surface.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = surface.getContext('2d');
    if (flip) { context.translate(0, surface.height); context.scale(1, -1); }
    context.drawImage(image, 0, 0, surface.width, surface.height);
    return surface;
  } catch (error) { surface.width = surface.height = 1; throw error; }
  finally { image.src = ''; URL.revokeObjectURL(url); }
}

function drawTexture(image, mask, inverted = false) {
  const output = document.createElement('canvas');
  output.width = image.width; output.height = image.height;
  const context = output.getContext('2d');
  context.drawImage(image, 0, 0);
  const surface = document.createElement('canvas'); surface.width = mask.width; surface.height = mask.height;
  const maskContext = surface.getContext('2d');
  const pixels = maskContext.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.width * mask.height; i++) pixels.data[i * 4 + 3] = mask.data[i];
  maskContext.putImageData(pixels, 0, 0);
  context.globalCompositeOperation = inverted ? 'destination-out' : 'destination-in';
  context.drawImage(surface, 0, 0, output.width, output.height);
  context.globalCompositeOperation = 'source-over';
  surface.width = surface.height = 1;
  return textureFromCanvas(output);
}

let segmentationWorker = null;
let segmentationId = 0;
let segmentationJob = null;
function releaseSegmenter() {
  segmentationWorker?.terminate();
  segmentationWorker = null;
  if (segmentationJob) { clearTimeout(segmentationJob.timer); segmentationJob.reject(new Error('Background removal stopped. Try again.')); segmentationJob = null; }
}
function getMask(image) {
  if (!segmentationWorker) {
    segmentationWorker = new Worker(new URL('./segmentation.worker.js', import.meta.url), { type: 'module' });
    segmentationWorker.onmessage = ({ data }) => {
      const job = segmentationJob;
      if (!job || job.id !== data.id) return;
      if (data.type === 'status') $('#model-status').textContent = data.message;
      if (data.type === 'progress') $('#model-progress-fill').style.width = `${Math.round(data.progress)}%`;
      if (data.type === 'result' || data.type === 'error') {
        clearTimeout(job.timer); segmentationJob = null;
        if (data.type === 'result') job.resolve(data.mask);
        else { job.reject(new Error(data.message)); releaseSegmenter(); }
      }
    };
    segmentationWorker.onerror = () => releaseSegmenter();
    segmentationWorker.onmessageerror = () => releaseSegmenter();
  }
  const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  return new Promise((resolve, reject) => {
    const id = ++segmentationId;
    segmentationJob = { id, resolve, reject, timer: setTimeout(releaseSegmenter, 180_000) };
    try { segmentationWorker.postMessage({ id, pixels, width: image.width, height: image.height, mobile: mobileDevice }, [pixels.buffer]); }
    catch (error) { releaseSegmenter(); }
  });
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
  const texture = textureFromCanvas(surface);
  const layer = asset.layers[0];
  const previous = layer.texture;
  layer.texture = texture;
  asset.image = surface;
  asset.cutoutUrl = thumbnailUrl(surface);
  if (layer.mesh) {
    layer.mesh.material.map = texture;
    layer.mesh.material.needsUpdate = true;
    layer.mesh.geometry.dispose();
    layer.mesh.geometry = new THREE.PlaneGeometry(2.1, 2.1 * surface.height / surface.width);
    layer.mesh.visible = layer.visible;
  }
  releaseTexture(previous);
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
    releaseTexture(asset.layers[0].texture);
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
  $('#export-btn').disabled = !state.assets.length || backgroundLoading || state.exporting;
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
    asset.layers.forEach((layer) => releaseTexture(layer.texture));
    asset.image.width = asset.image.height = 1;
    state.assets.splice(index, 1);
    state.selectedAsset = Math.max(0, Math.min(state.selectedAsset, state.assets.length - 1));
    $('#asset-meta').textContent = `${photoCount()} / 5`;
    $('#empty-state').classList.toggle('hidden', state.assets.length > 0);
    addLayers();
  }));
  syncTextControls();
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
  // Safari can decode HEIC natively; avoid loading a second decoder and
  // keeping its full-resolution buffers beside the segmentation model.
  let nativeImage;
  try {
    nativeImage = await decodeImage(file);
    const blob = await new Promise((resolve, reject) => nativeImage.toBlob((value) => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.9));
    return new File([blob], file.name.replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch (error) {
    // Browsers without native HEIC decoding still use the existing converter.
  } finally { if (nativeImage) nativeImage.width = nativeImage.height = 1; }
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(result) ? result[0] : result;
  const convertedName = file.name.replace(/\.hei[cf]$/i, '') + '.jpg';
  return new File([blob], convertedName, { type: 'image/jpeg', lastModified: file.lastModified });
}

async function segmentImage(file) {
  $('#model-status').textContent = 'Opening your photo…'; $('#model-progress').classList.add('visible');
  const preparedFile = await prepareImageFile(file);
  const image = await decodeImage(preparedFile);
  $('#model-status').textContent = 'Preparing background removal…'; $('#model-progress-fill').style.width = '100%';
  let mask;
  try { mask = await getMask(image); } catch (error) { image.width = image.height = 1; throw error; }
  if (!mask?.data || !mask.width || !mask.height) { image.width = image.height = 1; throw new Error('Background removal returned no mask'); }
  const maskTexture = drawTexture(image, mask, false);
  const invertedTexture = drawTexture(image, mask, true);
  const previewUrl = thumbnailUrl(image);
  const dimensions = { width: image.width, height: image.height };
  image.width = image.height = 1;
  state.assets.push({ file, image: dimensions, previewUrl, cutoutUrl: thumbnailUrl(maskTexture.image), size: 0.66 + (state.assets.length % 3) * 0.09, layers: [
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

let backgroundRequest = 0;
let backgroundLoading = false;

function clearBackgroundImage() {
  backgroundRequest++;
  backgroundLoading = false;
  $('#export-btn').disabled = !state.assets.length || state.exporting;
  $$('[data-background]').forEach((button) => { button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); });
  if (state.backgroundTexture) state.backgroundTexture.dispose();
  if (state.backgroundBitmap) state.backgroundBitmap.width = state.backgroundBitmap.height = 1;
  state.backgroundTexture = null;
  state.backgroundBitmap = null;
  scene.background = new THREE.Color(state.canvasColor);
  $('#background-image-meta').textContent = '';
  $('#background-image-clear').classList.remove('visible');
  $('#background-image').value = '';
}

async function setBackgroundImage(file, preset = null, request = ++backgroundRequest) {
  if (state.exporting) return;
  backgroundLoading = true;
  $('#export-btn').disabled = true;
  $('#background-image-meta').textContent = 'Loading background…';
  try {
  const preparedFile = await prepareImageFile(file);
  const bitmap = await decodeImage(preparedFile, imageLimit);
  if (request !== backgroundRequest) { bitmap.width = bitmap.height = 1; return; }
  if (state.backgroundTexture) state.backgroundTexture.dispose();
  if (state.backgroundBitmap) state.backgroundBitmap.width = state.backgroundBitmap.height = 1;
  const texture = textureFromCanvas(bitmap);
  state.backgroundBitmap = bitmap;
  state.backgroundTexture = texture;
  scene.background = texture;
  $('#background-image-meta').textContent = preset?.label || file.name;
  $('#background-image-clear').classList.add('visible');
  $$('[data-background]').forEach((button) => { const active = button.dataset.background === preset?.id; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  $$('[data-color]').forEach((button) => button.classList.remove('selected'));
  } catch (error) {
    if (request === backgroundRequest) $('#background-image-meta').textContent = 'Could not load background. Try again.';
    console.error(error);
  } finally {
    if (request === backgroundRequest) { backgroundLoading = false; $('#export-btn').disabled = !state.assets.length || state.exporting; }
  }
}

async function exportLoop() {
  if (!state.assets.length || state.exporting || uploading || backgroundLoading) return;
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
  } finally { releaseSegmenter(); uploading = false; $('#upload-trigger').setAttribute('aria-busy', 'false'); $('#upload').value = ''; $('#upload-trigger').disabled = photoCount() >= 5; $('#empty-upload').disabled = false; }
};
$('#upload').addEventListener('change', (event) => handleUpload(event.target.files));
$('#upload-trigger').addEventListener('click', () => $('#upload').click());
$('#upload-trigger').addEventListener('dragover', (event) => { event.preventDefault(); $('#upload-trigger').classList.add('dragging'); });
$('#upload-trigger').addEventListener('dragleave', () => $('#upload-trigger').classList.remove('dragging'));
$('#upload-trigger').addEventListener('drop', (event) => { event.preventDefault(); $('#upload-trigger').classList.remove('dragging'); handleUpload(event.dataTransfer.files); });
$$('#speed, #depth, #scale, #pivot-y, #position-x, #position-y').forEach((input) => input.addEventListener('input', syncControls));
$('#speed').addEventListener('input', () => $$('[data-speed]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.speed) === state.speed)));
$('#canvas-color').addEventListener('input', (event) => { clearBackgroundImage(); setCanvasColor(event.target.value); });
const backgroundPresets = [
  { id: 'orange', label: 'Orange mosaic', url: orangeTiles },
  { id: 'burgundy', label: 'Burgundy tiles', url: burgundyTiles },
  { id: 'red', label: 'Red tiles', url: redTiles },
  { id: 'plaid', label: 'Blue plaid', url: bluePlaid },
];
$('#background-presets').innerHTML = backgroundPresets.map((preset) => `<button data-background="${preset.id}" aria-label="${preset.label} background" aria-pressed="false"><img src="${preset.url}" alt="" loading="lazy"><span>${preset.label}</span></button>`).join('');
$$('[data-background]').forEach((button) => button.addEventListener('click', async () => {
  if (state.exporting) return;
  const preset = backgroundPresets.find((item) => item.id === button.dataset.background);
  const request = ++backgroundRequest;
  backgroundLoading = true;
  $('#export-btn').disabled = true;
  $('#background-image-meta').textContent = 'Loading background…';
  try {
    const response = await fetch(preset.url);
    if (!response.ok) throw new Error('Background unavailable');
    const blob = await response.blob();
    if (request !== backgroundRequest) return;
    await setBackgroundImage(new File([blob], `${preset.label}.jpg`, { type: 'image/jpeg' }), preset, request);
  } catch (error) {
    console.error(error);
    if (request === backgroundRequest) { backgroundLoading = false; $('#export-btn').disabled = !state.assets.length; $('#background-image-meta').textContent = 'Could not load background. Try again.'; }
  }
}));
$('#background-image-trigger').addEventListener('click', () => $('#background-image').click());
$('#background-image').addEventListener('change', (event) => {
  const file = Array.from(event.target.files || []).find(isSupportedImage);
  if (file) setBackgroundImage(file).catch((error) => { console.error(error); $('#background-image-meta').textContent = 'BACKGROUND ERROR · RETRY'; });
});
$('#background-image-clear').addEventListener('click', clearBackgroundImage);
$('#direction').addEventListener('click', () => { state.direction *= -1; $('#direction').classList.toggle('reverse', state.direction < 0); });
$('#export-btn').addEventListener('click', exportLoop);

function animate() { requestAnimationFrame(animate); if (!state.exporting && state.playing && !document.hidden) { state.turntableAngle += 0.0025 * state.speed * state.direction; state.assets.forEach((asset, index) => { asset.axis.rotation.y = state.turntableAngle + index * state.depth; }); } if (!state.exporting && !document.hidden && !renderer.getContext().isContextLost()) { controls.update(); renderer.render(scene, camera); } }
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
$$('[data-font]').forEach((button) => button.addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.font = button.dataset.font; syncTextControls(); queueText(asset); }));
$('#text-color').addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; asset.color = event.currentTarget.value; queueText(asset); });
for (const [id, key] of [['text-size', 'scale'], ['text-height', 'height']]) {
  $(`#${id}`).addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; const layer = asset.layers[0]; layer[key] = Number(event.currentTarget.value); layer.mesh.scale.setScalar(asset.size * state.scale * layer.scale); layer.mesh.position.y = state.pivotY + layer.height; });
}
$('#text-visibility').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.layers[0].visible = !asset.layers[0].visible; addLayers(); });
$('#delete-text').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; releaseTexture(asset.layers[0].texture); state.assets.splice(state.selectedAsset, 1); state.selectedAsset = Math.max(0, Math.min(state.selectedAsset, state.assets.length - 1)); addLayers(); });
function fitViewport() {
  document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
fitViewport();
new ResizeObserver(resize).observe($('.stage-wrap'));
$('#export-btn').disabled = true;
updateLayerList(); resize(); animate();
