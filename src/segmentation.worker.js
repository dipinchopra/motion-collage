import { pipeline, env, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let segmenter;

self.onmessage = async ({ data: { id, pixels, width, height, mobile } }) => {
  try {
    if (!segmenter) {
      self.postMessage({ id, type: 'status', message: 'Loading background removal…' });
      segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4', {
        device: 'wasm', dtype: 'q8',
        session_options: { enableCpuMemArena: false, enableMemPattern: false },
        progress_callback: (progress) => {
          if (progress.status === 'progress') self.postMessage({ id, type: 'progress', progress: progress.progress || 0 });
        },
      });
      // The convolutional model accepts variable spatial dimensions. Mobile
      // inference uses a quarter of the default 1024² input pixel count.
      if (mobile) segmenter.processor.image_processor.size = { width: 512, height: 512 };
    }
    self.postMessage({ id, type: 'status', message: 'Removing background…' });
    const result = await segmenter(new RawImage(pixels, width, height, 4));
    const mask = result[0]?.mask;
    if (!mask?.data || !mask.width || !mask.height) throw new Error('No cutout was returned');
    self.postMessage({ id, type: 'result', mask: { data: mask.data, width: mask.width, height: mask.height } }, [mask.data.buffer]);
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || 'Background removal failed' });
  }
};
