// All CLIP inference runs here, off the UI thread.
import {
  env,
  AutoProcessor,
  AutoTokenizer,
  CLIPVisionModelWithProjection,
  CLIPTextModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

env.allowLocalModels = false; // fetch from the Hugging Face Hub (absolute URLs, so the site subpath doesn't matter)

// Serve ONNX Runtime WASM from this site's own subpath in production (copied at build time by
// scripts/copy-ort.mjs). If that isn't available, the library's default CDN is used.
async function configureWasm() {
  // GitHub Pages can't send COOP/COEP headers, so SharedArrayBuffer threads are unavailable.
  if (!self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1;
  if (!import.meta.env.PROD) return;
  try {
    const root = `${self.location.origin}${import.meta.env.BASE_URL}ort/`;
    const res = await fetch(root + 'manifest.json');
    const m = await res.json();
    if (m.ok) env.backends.onnx.wasm.wasmPaths = root;
  } catch { /* keep CDN default */ }
}

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
let tokenizer, processor, textModel, visionModel, device;
let readyPromise = null;
let files = {};

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

function reportProgress() {
  const list = Object.values(files);
  const total = list.reduce((s, f) => s + f.total, 0);
  const loaded = list.reduce((s, f) => s + f.loaded, 0);
  post({ type: 'progress', loaded, total, pct: total ? (loaded / total) * 100 : 0 });
}

const progress_callback = (p) => {
  if (p.status === 'progress' && p.total) {
    files[p.file] = { loaded: p.loaded, total: p.total };
    reportProgress();
  }
};

async function loadAll(dev) {
  // Quantized (int8) weights for WASM; fp32 for WebGPU, where int8 ops are poorly supported.
  const dtype = dev === 'webgpu' ? 'fp32' : 'q8';
  const opts = { device: dev, dtype, progress_callback };
  files = {};
  [tokenizer, processor, textModel, visionModel] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID, opts),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, opts),
  ]);
  device = `${dev} (${dtype})`;
}

function init() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await configureWasm();
    let gpu = null;
    try { gpu = self.navigator?.gpu ? await self.navigator.gpu.requestAdapter() : null; } catch { /* no WebGPU */ }
    if (gpu) {
      try { await loadAll('webgpu'); }
      catch (e) { console.warn('WebGPU failed, falling back to WASM', e); await loadAll('wasm'); }
    } else {
      await loadAll('wasm');
    }
    post({ type: 'ready', device });
  })().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

function normalize(data) {
  const v = Float32Array.from(data);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

// Run one inference at a time.
let queue = Promise.resolve();
const enqueue = (fn) => { const r = queue.then(fn); queue = r.catch(() => {}); return r; };

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      await init();
      post({ id, type: 'result', device });
    } else if (type === 'embedImage') {
      const emb = await enqueue(async () => {
        await init();
        const image = await RawImage.fromBlob(data.blob);
        const inputs = await processor(image);
        const out = await visionModel(inputs);
        const v = normalize(out.image_embeds.data);
        out.image_embeds.dispose?.();
        return v;
      });
      post({ id, type: 'result', embedding: emb }, [emb.buffer]);
    } else if (type === 'embedText') {
      const emb = await enqueue(async () => {
        await init();
        const inputs = await tokenizer([data.text], { padding: true, truncation: true });
        const out = await textModel(inputs);
        const v = normalize(out.text_embeds.data);
        out.text_embeds.dispose?.();
        return v;
      });
      post({ id, type: 'result', embedding: emb }, [emb.buffer]);
    }
  } catch (e) {
    post({ id, type: 'error', message: String(e?.message || e) });
  }
};
