let worker = null;
let nextId = 1;
const pending = new Map();
let listener = () => {};
let initPromise = null;

export function startWorker(onEvent) {
  listener = onEvent;
  if (worker) return initPromise;
  worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress' || data.type === 'ready') return listener(data);
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data);
  };
  worker.onerror = (e) => listener({ type: 'fatal', message: e.message || 'Worker crashed' });
  initPromise = call('init');
  return initPromise;
}

function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload });
  });
}

export const embedImage = async (blob) => (await call('embedImage', { blob })).embedding;
export const embedText = async (text) => (await call('embedText', { text })).embedding;
