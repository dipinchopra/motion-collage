import * as THREE from 'three';
import { editorLayout, portraitSize } from './viewport-layout.js';
import { TOOLS, toolTransform } from './tool-layout.js';
import { MODEL_SIZE } from './segmentation-data.js';
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
const state = { assets: [], tool: 'motion', mode: 'standard', speed: 1, direction: 1, depth: 0.7, scale: 1, pivotY: 0, positionX: 0, positionY: 0, canvasColor: '#f1f0ed', backgroundTexture: null, backgroundBitmap: null, exporting: false, frame: 0, turntableAngle: 0, nextLayerOrder: 0, selectedAsset: 0, playing: true };

function resize() {
  const wrap = $('.stage-wrap');
  const rect = wrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const { width, height } = portraitSize(rect.width, rect.height);
  wrap.style.setProperty('--canvas-css-width', `${width}px`);
  wrap.style.setProperty('--canvas-css-height', `${height}px`);
  wrap.style.setProperty('--preview-width', `${width}px`);
  wrap.style.setProperty('--preview-controls-width', `${Math.min(rect.width, Math.max(128, width))}px`);
  const size = renderer.getSize(new THREE.Vector2());
  if (Math.round(size.x) !== Math.round(width) || Math.round(size.y) !== Math.round(height)) renderer.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), false);
  camera.aspect = 9 / 16; camera.updateProjectionMatrix();
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

function inversePanel(cutout, color = '#171717') {
  const surface = document.createElement('canvas');
  surface.width = cutout.width; surface.height = cutout.height;
  const context = surface.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, surface.width, surface.height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(cutout, 0, 0);
  context.globalCompositeOperation = 'source-over';
  return textureFromCanvas(surface);
}

let segmentationWorker = null;
let segmentationId = 0;
let segmentationJob = null;
function releaseSegmenter(reason = 'Background removal stopped. Try again.') {
  segmentationWorker?.terminate();
  segmentationWorker = null;
  if (segmentationJob) { clearTimeout(segmentationJob.timer); segmentationJob.reject(new Error(reason)); segmentationJob = null; }
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
    segmentationWorker.onerror = (event) => { event.preventDefault(); releaseSegmenter(event.message || 'The background-removal worker could not start'); };
    segmentationWorker.onmessageerror = () => releaseSegmenter('The cutout response could not be read');
  }
  // Resize with the page's canvas API; Safari workers need no OffscreenCanvas.
  const input = document.createElement('canvas');
  input.width = input.height = MODEL_SIZE;
  const context = input.getContext('2d');
  context.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const pixels = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  input.width = input.height = 1;
  return new Promise((resolve, reject) => {
    const id = ++segmentationId;
    segmentationJob = { id, resolve, reject, timer: setTimeout(releaseSegmenter, 180_000) };
    try { segmentationWorker.postMessage({ id, pixels, width: MODEL_SIZE, height: MODEL_SIZE }, [pixels.buffer]); }
    catch (error) { releaseSegmenter(error.message || 'Could not start background removal'); }
  });
}

const toolOptions = { orbit: { radius: 0.5, tilt: 0.6, speed: 1 }, echo: { copies: 4, spacing: 0.13, speed: 1 } };
function motionCycles() { return state.tool === 'motion' ? state.speed : toolOptions[state.tool].speed; }
function addLayers() {
  const geometries = new Set();
  const materials = new Set();
  pivot.traverse((object) => { if (object.isMesh) { geometries.add(object.geometry); materials.add(object.material); } });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  pivot.clear();
  state.assets.forEach((asset) => {
    const axis = new THREE.Group();
    pivot.add(axis);
    asset.axis = axis;
    const aspect = asset.image.width / asset.image.height;
    asset.layers.forEach((layer) => {
      const geometry = new THREE.PlaneGeometry(asset.kind === 'text' ? 2.1 : Math.min(aspect, 1.4) * 2.1, asset.kind === 'text' ? 2.1 / aspect : 2.1);
      const copies = state.tool === 'echo' && asset.kind !== 'text' ? toolOptions.echo.copies : 1;
      layer.instances = [];
      for (let copy = 0; copy < copies; copy++) {
        const material = new THREE.MeshBasicMaterial({ map: layer.texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: state.tool === 'echo' && copy < copies - 1 ? '#ed8c98' : '#ffffff' });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = state.tool === 'orbit' ? 0 : layer.order * 6 + copy;
        axis.add(mesh);
        layer.instances.push(mesh);
      }
      layer.mesh = layer.instances.at(-1);
    });
  });
  updateComposition();
  updateLayerList();
}

function updateComposition(phase = state.turntableAngle) {
  pivot.position.set(state.tool === 'motion' ? state.positionX : 0, state.tool === 'motion' ? state.positionY : 0, 0);
  state.assets.forEach((asset, assetIndex) => {
    const text = asset.kind === 'text';
    const index = assetIndex;
    const count = state.assets.length;
    asset.axis.position.set(0, 0, 0);
    asset.axis.rotation.set(0, 0, 0);
    asset.layers.forEach((layer) => {
      layer.instances.forEach((mesh, copy) => {
        const transform = toolTransform(state.tool, { index, count, text, phase, depth: state.depth, ...toolOptions.orbit, ...toolOptions.echo, copy, copies: layer.instances.length });
        if (state.tool === 'motion') asset.axis.rotation.y = transform.ry;
        mesh.position.set(transform.x, transform.y + layer.height + (state.tool === 'motion' ? state.pivotY : 0), transform.z);
        mesh.rotation.set(0, state.tool === 'motion' ? 0 : transform.ry, transform.rz + layer.angle);
        mesh.scale.setScalar(asset.size * layer.scale * transform.scale * (state.tool === 'motion' ? state.scale : 1));
        mesh.material.opacity = transform.opacity;
        mesh.visible = layer.visible;
      });
    });
  });
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
  updateComposition();
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
  const asset = { image: placeholder, cutoutUrl: placeholder.toDataURL(), kind: 'text', text: 'Your text', font: TOOLS[state.tool].font, color: '#171717', size: 1, layers: [{ texture: new THREE.CanvasTexture(placeholder), kind: 'text', visible: true, height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ }] };
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

function layerName(layer) {
  return { mask: 'Cutout', invert: 'Background', inverse: 'Inverse' }[layer.kind] || layer.label;
}
function layerThumbnail(layer) {
  return layer.previewUrl ||= thumbnailUrl(layer.texture.image);
}

function updateLayerList() {
  $('#empty-state').classList.toggle('hidden', state.assets.length > 0);
  const list = $('#layer-list');
  list.innerHTML = state.assets.length ? state.assets.map((asset, index) => `<button class="cutout-tile ${asset.kind === 'text' ? 'text-tile' : ''} ${index === state.selectedAsset ? 'selected' : ''} ${asset.layers.some((layer) => layer.visible) ? '' : 'muted'}" data-select-asset="${index}" aria-label="Edit ${asset.kind === 'text' ? 'text' : 'photo'} ${index + 1}" aria-pressed="${index === state.selectedAsset}"><img src="${asset.cutoutUrl}" alt=""><span>${String(index + 1).padStart(2, '0')}</span></button>`).join('') : '<span class="tray-placeholder">Your cutouts go here</span>';
  const selected = state.assets[state.selectedAsset];
  const asset = selected?.kind === 'text' ? null : selected;
  const editor = $('#cutout-editor');
  const optionScroll = editor.querySelector('.layer-options')?.scrollLeft || 0;
  const focused = editor.contains(document.activeElement) ? { index: document.activeElement.dataset.layerIndex, action: document.activeElement.dataset.layerAction } : null;
  $('#selected-caption').textContent = asset ? `Photo ${state.selectedAsset + 1}` : 'Select a photo above';
  editor.innerHTML = asset ? `<div class="layer-options" role="group" aria-label="Image layers">${asset.layers.map((layer, index) => `<button class="layer-option ${layer.visible ? 'on' : ''}" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="visibility" aria-pressed="${layer.visible}"><img src="${layerThumbnail(layer)}" alt=""><span>${layerName(layer)}</span><i>${layer.visible ? '✓' : '+'}</i></button>`).join('')}</div>${asset.layers.map((layer, index) => `<div class="layer-detail ${layer.visible ? '' : 'inactive'}"><div class="layer-detail-head"><span>${layerName(layer)}</span><div><button aria-label="Move ${layerName(layer).toLowerCase()} backward" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="back">↓</button><button aria-label="Move ${layerName(layer).toLowerCase()} forward" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="forward">↑</button></div></div><div class="mask-controls">${[['height','Height',-0.8,0.8],['angle','Tilt',-1.2,1.2],['scale','Size',0.4,1.4]].map(([key,label,min,max]) => `<label>${label}<input aria-label="${layerName(layer)} ${label.toLowerCase()}" type="range" min="${min}" max="${max}" step="0.01" value="${layer[key]}" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="${key}"></label>`).join('')}</div>${layer.kind === 'inverse' ? `<label class="panel-color">Panel color<input type="color" value="${layer.color}" data-asset-index="${state.selectedAsset}" data-layer-index="${index}" data-layer-action="color"></label>` : ''}</div>`).join('')}<button class="delete-photo" data-asset-index="${state.selectedAsset}" data-layer-action="delete">Remove photo</button>` : '<p class="no-selection">Add a photo to start editing.</p>';
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
    if (event.currentTarget.dataset.layerAction === 'visibility') {
      const visible = !layer.visible;
      if (visible) asset.layers.forEach((other) => { if (layer.kind === 'inverse' || other.kind === 'inverse') other.visible = false; });
      layer.visible = visible;
    }
    if (event.currentTarget.dataset.layerAction === 'color') {
      layer.color = event.currentTarget.value;
      const context = layer.texture.image.getContext('2d');
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = layer.color;
      context.fillRect(0, 0, layer.texture.image.width, layer.texture.image.height);
      context.globalCompositeOperation = 'source-over';
      layer.texture.needsUpdate = true;
      layer.previewUrl = thumbnailUrl(layer.texture.image);
      editor.querySelector(`[data-layer-index="${event.currentTarget.dataset.layerIndex}"] img`).src = layer.previewUrl;
    }
    if (event.currentTarget.dataset.layerAction === 'forward' || event.currentTarget.dataset.layerAction === 'back') {
      const direction = event.currentTarget.dataset.layerAction === 'forward' ? 1 : -1;
      const ordered = allLayers().map((entry) => entry.layer).sort((a, b) => a.order - b.order);
      const position = ordered.indexOf(layer);
      const neighbor = ordered[position + direction];
      if (neighbor) [layer.order, neighbor.order] = [neighbor.order, layer.order];
    }
    if (['forward', 'back', 'visibility'].includes(event.currentTarget.dataset.layerAction)) addLayers();
    else updateComposition();
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
  const options = editor.querySelector('.layer-options');
  if (options) options.scrollLeft = optionScroll;
  if (focused?.index && focused.action) editor.querySelector(`[data-layer-index="${focused.index}"][data-layer-action="${focused.action}"]`)?.focus({ preventScroll: true });
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
  const inverseTexture = inversePanel(maskTexture.image);
  const previewUrl = thumbnailUrl(image);
  const dimensions = { width: image.width, height: image.height };
  image.width = image.height = 1;
  state.assets.push({ file, image: dimensions, previewUrl, cutoutUrl: thumbnailUrl(maskTexture.image), size: 0.66 + (state.assets.length % 3) * 0.09, layers: [
    { kind: 'mask', label: 'MASK', texture: maskTexture, visible: state.mode !== 'inverted', height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ },
    { kind: 'invert', label: 'Background', texture: invertedTexture, visible: state.mode === 'inverted', height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ },
    { kind: 'inverse', label: 'Inverse', texture: inverseTexture, color: '#171717', visible: false, height: 0, angle: 0, scale: 1, order: state.nextLayerOrder++ }
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
  updateComposition();
  for (const [id, value] of [['speed', state.speed], ['depth', state.depth], ['scale', state.scale], ['pivot-y', state.pivotY], ['position-x', state.positionX], ['position-y', state.positionY]]) {
    $(`#${id}-value`).textContent = `${value.toFixed(2)}${id === 'speed' ? '×' : ''}`;
  }
}

function setCanvasColor(color) {
  state.canvasColor = color;
  toolBackdrops[state.tool] = { color };
  if (!state.backgroundTexture) scene.background = new THREE.Color(color);
  $('.stage-wrap').style.setProperty('--canvas-color', color);
}

const toolBackdrops = { motion: { color: '#f1f0ed' }, orbit: { preset: 'plaid' }, echo: { color: '#ffc9dd' } };
let backgroundRequest = 0;
let backgroundLoading = false;

function clearBackgroundImage() {
  backgroundRequest++;
  backgroundLoading = false;
  toolBackdrops[state.tool] = { color: state.canvasColor };
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
  toolBackdrops[state.tool] = preset ? { preset: preset.id } : { file };
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
  state.exporting = true; $('#tool-trigger').disabled = true; $('.bottom-dock').classList.add('recording'); $('#share-trigger').disabled = true; $('#export-btn').disabled = true; $('#export-progress').classList.add('visible'); $('#export-status').textContent = 'EXPORTING LOOP...';
  await Promise.all(state.assets.filter((asset) => asset.kind === 'text').map((asset) => asset.pending));
  const width = 1080, height = 1920, fps = mobileDevice ? 30 : 60, frames = fps * 10;
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
    state.turntableAngle = (frame / frames) * Math.PI * 2 * motionCycles() * state.direction;
    updateComposition();
    exportRenderer.render(scene, camera);
    await videoSource.add(frame / fps, 1 / fps, { keyFrame: frame % 60 === 0 });
    if (frame % 6 === 0) $('#export-progress-fill').style.width = `${Math.round((frame / frames) * 100)}%`;
    await new Promise(requestAnimationFrame);
  }
  await output.finalize();
  const blob = new Blob([target.buffer], { type: 'video/quicktime' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url; link.download = `${state.tool}-loop.mov`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  $('#export-progress-fill').style.width = '100%';
  $('#export-status').textContent = 'Video saved';
  } catch (error) {
    console.error(error);
    $('#export-status').textContent = 'Could not save video. Try again in a browser with video encoding support.';
  } finally {
    exportRenderer.dispose();
    exportRenderer.forceContextLoss();
    exportCanvas.width = exportCanvas.height = 1;
    camera.aspect = previousCameraAspect;
    camera.updateProjectionMatrix();
    $('#export-btn').disabled = false;
    $('#share-trigger').disabled = false;
    $('#tool-trigger').disabled = false;
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
    for (const file of incoming) await segmentImage(file).catch((error) => { console.error(error); $('#model-status').textContent = `Cutout failed: ${(error.message || String(error)).slice(0, 240)}`; $('#model-progress').classList.add('visible'); });
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

let previousFrameTime = performance.now();
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const elapsed = Math.min(0.05, Math.max(0, (now - previousFrameTime) / 1000));
  previousFrameTime = now;
  if (!state.exporting && state.playing && !document.hidden) {
    state.turntableAngle += elapsed * Math.PI * 2 / 10 * motionCycles() * state.direction;
    updateComposition();
  }
  if (!state.exporting && !document.hidden && !renderer.getContext().isContextLost()) { controls.update(); renderer.render(scene, camera); }
}
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
  scheduleViewport();
  const activeTab = $('.sheet-tabs button.active');
  if (activeTab) {
    const tabs = $('.sheet-tabs');
    const left = tabs.scrollLeft + activeTab.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - activeTab.clientWidth) / 2;
    tabs.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
$$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(currentSheet === button.dataset.sheet ? null : button.dataset.sheet)));
$$('.sheet-close').forEach((button) => button.addEventListener('click', () => openSheet(null)));
$('#share-trigger').addEventListener('click', () => openSheet('share'));
$$('[data-color]').forEach((button) => button.addEventListener('click', () => { clearBackgroundImage(); setCanvasColor(button.dataset.color); $('#canvas-color').value = button.dataset.color; $$('[data-color]').forEach((swatch) => swatch.classList.toggle('selected', swatch === button)); }));
$$('[data-speed]').forEach((button) => button.addEventListener('click', () => { $('#speed').value = button.dataset.speed; syncControls(); $$('[data-speed]').forEach((preset) => preset.classList.toggle('selected', preset === button)); }));
$('#empty-upload').addEventListener('click', () => $('#upload').click());
$('#play-toggle').addEventListener('click', () => { state.playing = !state.playing; $('#play-toggle').textContent = state.playing ? 'Ⅱ' : '▶'; $('#play-toggle').setAttribute('aria-label', state.playing ? 'Pause motion' : 'Play motion'); });
$('#clean-preview').addEventListener('click', () => { const clean = document.body.classList.toggle('clean-mode'); $('#clean-preview').setAttribute('aria-label', clean ? 'Exit fullscreen' : 'Fullscreen'); $('#clean-preview').innerHTML = clean ? '✕' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>'; resize(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { openSheet(null); document.body.classList.remove('clean-mode'); resize(); } });
$('#add-text').addEventListener('click', addText);
$('#text-content').addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; asset.text = event.currentTarget.value; queueText(asset); });
$$('[data-font]').forEach((button) => button.addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.font = button.dataset.font; syncTextControls(); queueText(asset); }));
$('#text-color').addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; asset.color = event.currentTarget.value; queueText(asset); });
for (const [id, key] of [['text-size', 'scale'], ['text-height', 'height']]) {
  $(`#${id}`).addEventListener('input', (event) => { const asset = selectedText(); if (!asset || state.exporting) return; const layer = asset.layers[0]; layer[key] = Number(event.currentTarget.value); updateComposition(); });
}
$('#text-visibility').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; asset.layers[0].visible = !asset.layers[0].visible; addLayers(); });
$('#delete-text').addEventListener('click', () => { const asset = selectedText(); if (!asset || state.exporting) return; releaseTexture(asset.layers[0].texture); state.assets.splice(state.selectedAsset, 1); state.selectedAsset = Math.max(0, Math.min(state.selectedAsset, state.assets.length - 1)); addLayers(); });
function setToolMenu(open, focus = false) {
  $('#tool-menu').hidden = !open;
  $('#tool-trigger').setAttribute('aria-expanded', String(open));
  if (focus) (open ? $('[data-tool][aria-checked="true"]') : $('#tool-trigger')).focus();
}
async function selectTool(name) {
  if (!TOOLS[name] || state.exporting || uploading) return;
  if (state.tool === name) { setToolMenu(false, true); return; }
  const backdrop = { ...toolBackdrops[name] };
  state.tool = name;
  setToolMenu(false, true);
  document.body.dataset.tool = name;
  document.documentElement.style.setProperty('--accent', TOOLS[name].accent);
  $('#tool-name').textContent = TOOLS[name].label;
  $('#tool-symbol').textContent = TOOLS[name].label[0];
  document.title = `${TOOLS[name].label} — Cutout editor`;
  $$('[data-tool]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.tool === name)));
  for (const tool of Object.keys(TOOLS)) $(`#${tool}-tunings`).hidden = tool !== name;
  $('[data-sheet="motion"] span').textContent = TOOLS[name].tuning;
  $('#sheet-text .sheet-heading p').textContent = 'Moves with your collage';
  $('#sheet-share .sheet-heading h2').textContent = 'Save loop';
  $('#sheet-share .sheet-heading p').textContent = `10-second video · 1080 × 1920 · ${mobileDevice ? 30 : 60} fps`;
  $('#export-kind').textContent = 'Portrait video';
  $('#export-format').firstChild.textContent = 'MOV ';
  $('#export-btn').firstChild.textContent = 'Save video ';
  controls.reset();
  controls.enabled = name === 'motion';
  camera.position.set(0, name === 'motion' ? 0.2 : 0, 5.6);
  camera.lookAt(0, 0, 0);
  clearBackgroundImage();
  if (backdrop.color) { setCanvasColor(backdrop.color); $('#canvas-color').value = backdrop.color; }
  else if (backdrop.preset) $(`[data-background="${backdrop.preset}"]`).click();
  else if (backdrop.file) setBackgroundImage(backdrop.file);
  openSheet(null);
  addLayers();
}
$('#tool-trigger').addEventListener('click', () => setToolMenu($('#tool-menu').hidden));
$('#tool-trigger').addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setToolMenu(true, true); } });
$$('[data-tool]').forEach((button) => button.addEventListener('click', () => selectTool(button.dataset.tool)));
$('#tool-menu').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.stopPropagation(); setToolMenu(false, true); }
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const items = [...$$('[data-tool]')]; const index = items.indexOf(document.activeElement); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
});
document.addEventListener('pointerdown', (event) => { if (!$('.tool-switcher').contains(event.target)) setToolMenu(false); });
for (const [tool, keys] of [['orbit', ['radius', 'tilt', 'speed']], ['echo', ['copies', 'spacing', 'speed']]]) {
  for (const key of keys) $(`#${tool}-${key}`).addEventListener('input', (event) => { if (state.exporting) return; toolOptions[tool][key] = Number(event.currentTarget.value); if (key === 'copies') addLayers(); else updateComposition(); });
}
let viewportFrame = 0;
function fitViewport() {
  const viewport = window.visualViewport;
  const height = Math.max(1, viewport?.height || window.innerHeight);
  const active = document.activeElement;
  const typing = active?.tagName === 'TEXTAREA' || (active?.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'number'].includes(active.type));
  const keyboard = typing && window.innerHeight - height > 100;
  const header = $('.topbar').getBoundingClientRect().height;
  const inset = parseFloat(getComputedStyle($('.app')).paddingTop) || 0;
  const layout = editorLayout({ height, header, insetTop: inset, keyboard, sheetOpen: Boolean($('.sheet.active')) });
  document.body.classList.toggle('keyboard-open', keyboard);
  document.body.classList.toggle('compact-editor', layout.compact);
  const root = document.documentElement.style;
  root.setProperty('--app-height', `${height}px`);
  root.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
  root.setProperty('--dock-height', `${layout.dockHeight}px`);
  resize();
}
function scheduleViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(fitViewport);
}
window.visualViewport?.addEventListener('resize', scheduleViewport);
window.visualViewport?.addEventListener('scroll', scheduleViewport);
window.addEventListener('resize', scheduleViewport);
document.addEventListener('focusin', scheduleViewport);
document.addEventListener('focusout', scheduleViewport);
fitViewport();
$('#sheet-share .sheet-heading p').textContent = `10-second video · 1080 × 1920 · ${mobileDevice ? 30 : 60} fps`;
new ResizeObserver(resize).observe($('.stage-wrap'));
$('#export-btn').disabled = true;
updateLayerList(); resize(); animate();
