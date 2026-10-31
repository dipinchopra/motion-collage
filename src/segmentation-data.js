// RMBG-1.4's published preprocessing: RGB / 255, mean 0.5, std 1.
export const MODEL_SIZE = 1024;
export function modelPixels(rgba, width, height) {
  const count = width * height;
  if (rgba.length !== count * 4) throw new Error('Image pixels are incomplete');
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    values[i] = rgba[i * 4] / 255 - 0.5;
    values[count + i] = rgba[i * 4 + 1] / 255 - 0.5;
    values[count * 2 + i] = rgba[i * 4 + 2] / 255 - 0.5;
  }
  return values;
}
export function maskPixels(values) {
  const logits = values.some((value) => value < -1e-5 || value > 1 + 1e-5);
  const pixels = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const probability = logits ? 1 / (1 + Math.exp(-values[i])) : values[i];
    pixels[i] = Math.round(Math.max(0, Math.min(1, probability)) * 255);
  }
  return pixels;
}
