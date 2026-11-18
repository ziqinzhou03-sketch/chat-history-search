// Copies the ONNX Runtime Web .wasm/.mjs files into public/ort so they are
// served from your own GitHub Pages site instead of a CDN. Runs automatically
// before `vite build` (npm "prebuild" hook).
import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const candidates = [
  'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist',
  'node_modules/onnxruntime-web/dist',
];
const out = 'public/ort';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const src = candidates.find((p) => existsSync(p));
const files = src ? readdirSync(src).filter((f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f)) : [];

if (!files.length) {
  console.warn('[copy-ort] onnxruntime-web files not found; the app will fall back to the jsDelivr CDN for WASM.');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ok: false }));
} else {
  for (const f of files) copyFileSync(join(src, f), join(out, f));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ok: true, files }));
  console.log(`[copy-ort] copied ${files.length} files from ${src}`);
}
