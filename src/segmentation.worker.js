import { AutoModelForImageSegmentation, Tensor, env } from '@huggingface/transformers';
import { MODEL_SIZE, modelPixels, maskPixels } from './segmentation-data.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let model;

self.onmessage = async ({ data: { id, pixels, width, height } }) => {
  let input;
  let outputs;
  try {
    if (width !== MODEL_SIZE || height !== MODEL_SIZE) throw new Error('Unsupported cutout input size');
    if (!model) {
      self.postMessage({ id, type: 'status', message: 'Loading background removal…' });
      model = await AutoModelForImageSegmentation.from_pretrained('briaai/RMBG-1.4', {
        device: 'wasm', dtype: 'q8',
        session_options: { enableCpuMemArena: false, enableMemPattern: false },
        progress_callback: (progress) => {
          if (progress.status === 'progress') self.postMessage({ id, type: 'progress', progress: progress.progress || 0 });
        },
      });
    }
    self.postMessage({ id, type: 'status', message: 'Removing background…' });
    input = new Tensor('float32', modelPixels(pixels, width, height), [1, 3, height, width]);
    const session = model.sessions.model;
    outputs = await model({ pixel_values: input, [session.inputNames[0]]: input });
    const result = outputs[session.outputNames[0]];
    if (!result?.data || result.dims.length < 2) throw new Error('No cutout was returned');
    const mask = { data: maskPixels(result.data), width: result.dims.at(-1), height: result.dims.at(-2) };
    self.postMessage({ id, type: 'result', mask }, [mask.data.buffer]);
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  } finally {
    input?.dispose();
    if (outputs) for (const tensor of new Set(Object.values(outputs))) tensor?.dispose?.();
  }
};
