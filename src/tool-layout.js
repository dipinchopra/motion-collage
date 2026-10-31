export const TOOLS = {
  motion: { label: 'motion', tuning: 'Spin', color: '#f1f0ed', accent: '#dfff00', font: 'Manrope' },
  orbit: { label: 'orbit', tuning: 'Orbit', color: '#dfe7e7', accent: '#b6c4ff', font: 'Manrope' },
  echo: { label: 'echo', tuning: 'Trail', color: '#ffc9dd', accent: '#ff935b', font: 'Mochiy Pop One' },
};

// Every tool is periodic over 2π; preview and video export share these transforms.
export function toolTransform(tool, { index = 0, count = 1, phase = 0, depth = 0.7, radius = 0.5, tilt = 0.6, copy = 0, copies = 1, spacing = 0.13 } = {}) {
  if (tool === 'motion') return { x: 0, y: 0, z: 0, ry: phase + index * depth, rz: 0, scale: 1, opacity: 1 };
  const angle = phase + index / Math.max(1, count) * Math.PI * 2;
  if (tool === 'orbit') {
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * (0.5 + tilt), z: Math.sin(angle) * 0.45, ry: Math.sin(angle) * 0.32, rz: Math.cos(angle) * 0.16, scale: Math.min(0.9, 1.3 / Math.sqrt(count)), opacity: 1 };
  }
  const behind = copies - 1 - copy;
  const delayed = angle - behind * spacing * Math.PI * 2;
  return { x: Math.sin(delayed) * 0.4, y: Math.cos(delayed) * 0.65, z: copy * 0.008 + index * 0.001, ry: Math.sin(delayed) * 0.2, rz: Math.sin(delayed) * 0.18, scale: Math.min(0.9, 1.3 / Math.sqrt(count)) * (1 - behind * 0.07), opacity: behind === 0 ? 1 : 0.3 + copy / copies * 0.4 };
}
