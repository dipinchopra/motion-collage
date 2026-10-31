export const TOOLS = {
  motion: { label: 'motion', tuning: 'Motion', color: '#f1f0ed', accent: '#dfff00', font: 'Manrope' },
  poster: { label: 'poster', tuning: 'Layout', color: '#dfe7e7', accent: '#b6c4ff', font: 'Manrope' },
  echo: { label: 'echo', tuning: 'Echo', color: '#ffc9dd', accent: '#ff935b', font: 'Mochiy Pop One' },
};

// Pure transforms shared by the live preview, still export and video export.
export function toolTransform(tool, { index = 0, count = 1, text = false, phase = 0, depth = 0.7, spread = 0.5, tilt = 0.15, copy = 0, copies = 1, spacing = 0.13 } = {}) {
  if (tool === 'motion') return { x: 0, y: 0, z: 0, ry: phase + index * depth, rz: 0, scale: 1, opacity: 1 };
  if (tool === 'poster') {
    if (text) return { x: 0, y: 1.02 - index * 0.36, z: 0.04, ry: 0, rz: 0, scale: 1, opacity: 1 };
    const centered = index - (count - 1) / 2;
    return { x: centered * spread, y: count === 1 ? -0.12 : -0.15 + Math.abs(centered) * 0.13, z: index * 0.003, ry: 0, rz: centered * tilt, scale: Math.min(1.3, 1.65 / Math.sqrt(count)), opacity: 1 };
  }
  if (text) return { x: 0, y: 1.15 - index * 0.4, z: 0.1, ry: 0, rz: 0, scale: 0.9, opacity: 1 };
  const trail = copies - 1 - copy;
  const centered = index - (count - 1) / 2;
  return { x: centered * 0.55 + trail * spacing - (copies - 1) * spacing / 2, y: -0.2 + trail * spacing * 1.1 + Math.sin(phase + trail * 0.35) * 0.045, z: copy * 0.003, ry: 0, rz: -0.06, scale: Math.min(1, 1.3 / Math.sqrt(count)) * (1 - trail * 0.055), opacity: copy === copies - 1 ? 1 : 0.4 + copy / copies * 0.35 };
}
