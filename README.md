# Chat History Search

Client-side CLIP image search (React + Vite + Tailwind v4, `@huggingface/transformers`, `Xenova/clip-vit-base-patch32`).
Inference runs in a Web Worker (WebGPU if available, quantized WASM otherwise). Images and embeddings stay in IndexedDB.

## Deploy to GitHub Pages (no terminal)
1. Create a public repository named `chat-history-search` on github.com.
2. Upload every file from this project (including the hidden `.github` folder) with **Add file > Upload files**,
   or create `.github/workflows/deploy.yml` with **Add file > Create new file** and paste the contents.
   Commit to the `main` branch. Do not upload `node_modules`.
3. Go to **Settings > Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The workflow runs on every push to `main` (or run it manually).
5. The site appears at `https://<your-username>.github.io/chat-history-search/`.

If you rename the repository, change `base` in `vite.config.js` to match.

## How subpath hosting is handled
- `base: '/chat-history-search/'` in `vite.config.js` prefixes all built assets, including the Web Worker.
- `scripts/copy-ort.mjs` (runs before every build) copies ONNX Runtime's `.wasm`/`.mjs` files to `dist/ort/`, and the worker points ONNX Runtime at that folder.
- Model weights download from the Hugging Face Hub (absolute URLs, no CORS or subpath issues) and are cached by the browser.
- GitHub Pages can't send cross-origin-isolation headers, so WASM runs single-threaded. Indexing is slower than a multi-threaded setup but works.

## Local development (optional)
    npm install
    npm run dev    # http://localhost:5173/chat-history-search/
