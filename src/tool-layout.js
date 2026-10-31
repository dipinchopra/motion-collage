export const TOOLS = {
  motion: { label: 'motion', tuning: 'Spin', color: '#f1f0ed', accent: '#dfff00', font: 'Manrope' },
  orbit: { label: 'orbit', tuning: 'Orbit', color: '#dfe7e7', accent: '#b6c4ff', font: 'Manrope' },
  shutters: { label: 'shutters', tuning: 'Shutters', color: '#dfdfd8', accent: '#dfff00', font: 'Manrope' },
  ribbon: { label: 'ribbon', tuning: 'Ribbon', color: '#f1e8d4', accent: '#ffb365', font: 'Mochiy Pop One' },
  stamp: { label: 'stamp', tuning: 'Stamp', color: '#e9e5dd', accent: '#ff7878', font: 'Mochiy Pop One' },
  echo: { label: 'echo', tuning: 'Trail', color: '#ffc9dd', accent: '#ff935b', font: 'Mochiy Pop One' },
};

// Every tool is periodic over 2π; preview and video export share these transforms.
export function toolTransform(tool, { index = 0, count = 1, phase = 0, depth = 0.7, radius = 0.5, tilt = 0.6, copy = 0, copies = 1, spacing = 0.13, bands = 6, fold = 1.4, rows = 2, slant = -0.12, hits = 3, punch = 0.24 } = {}) {
  if (tool === 'motion') return { x: 0, y: 0, z: 0, ry: phase + index * depth, rz: 0, scale: 1, opacity: 1 };
  const turn = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  if (tool === 'shutters') {
    const wave = (Math.sin(phase + copy * 0.28 + index * 1.4) + 1) / 2;
    const eased = wave * wave * (3 - 2 * wave);
    return { x: 0, y: 0, z: index * 0.006, rx: (copy % 2 ? -1 : 1) * fold * eased, ry: 0, rz: 0, scale: 1.15, opacity: 1 };
  }
  if (tool === 'ribbon') {
    const row = Math.floor(copy / 3);
    const repeat = copy % 3 - 1;
    const step = 1.1;
    const period = Math.max(1, count) * step;
    const travel = (row % 2 ? -1 : 1) * turn * period;
    const wrapped = ((index * step + travel) % period + period) % period;
    return { x: wrapped - period / 2 + repeat * period, y: ((rows - 1) / 2 - row) * 1.05, z: index * 0.002, rx: 0, ry: 0, rz: slant, scale: rows === 1 ? 0.95 : 0.68, opacity: 1 };
  }
  if (tool === 'stamp') {
    const number = index * hits + copy;
    const total = Math.max(1, count * hits);
    const start = number / total * 0.58;
    const age = turn - start;
    const progress = Math.max(0, Math.min(1, age / 0.065));
    const overshoot = punch * 8;
    const back = 1 + (overshoot + 1) * Math.pow(progress - 1, 3) + overshoot * Math.pow(progress - 1, 2);
    const clear = Math.max(0, Math.min(1, (turn - 0.84) / 0.12));
    const random = (seed) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
    return { x: (random(number + 1) - 0.5) * 1.05, y: (random(number + 13) - 0.5) * 1.9, z: number * 0.001, rx: 0, ry: 0, rz: (random(number + 31) - 0.5) * 0.7, scale: 0.68 * Math.max(0, back), opacity: age < 0 ? 0 : 1 - clear * clear * (3 - 2 * clear) };
  }
  const angle = phase + index / Math.max(1, count) * Math.PI * 2;
  if (tool === 'orbit') {
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * (0.5 + tilt), z: Math.sin(angle) * 0.45, ry: Math.sin(angle) * 0.32, rz: Math.cos(angle) * 0.16, scale: Math.min(0.9, 1.3 / Math.sqrt(count)), opacity: 1 };
  }
  const behind = copies - 1 - copy;
  const delayed = angle - behind * spacing * Math.PI * 2;
  return { x: Math.sin(delayed) * 0.4, y: Math.cos(delayed) * 0.65, z: copy * 0.008 + index * 0.001, ry: Math.sin(delayed) * 0.2, rz: Math.sin(delayed) * 0.18, scale: Math.min(0.9, 1.3 / Math.sqrt(count)) * (1 - behind * 0.07), opacity: behind === 0 ? 1 : 0.3 + copy / copies * 0.4 };
}
