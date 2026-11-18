import { useCallback, useEffect, useRef, useState } from 'react';
import { startWorker, embedImage, embedText } from './lib/workerClient.js';
import * as db from './lib/db.js';
import { ACCEPTED, MAX_BYTES, makeThumbnail, mockChat, rank } from './lib/utils.js';

const mb = (n) => (n / 1048576).toFixed(1);

export default function App() {
  const [model, setModel] = useState({ state: 'loading', pct: 0, loaded: 0, total: 0, device: '', error: '' });
  const [items, setItems] = useState([]);
  const [errors, setErrors] = useState([]);
  const [indexing, setIndexing] = useState(null); // {done,total,name}
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const addError = (m) => setErrors((e) => [...e, m].slice(-6));

  // Load model in the worker.
  useEffect(() => {
    startWorker((ev) => {
      if (ev.type === 'progress') setModel((m) => (m.state === 'ready' ? m : { ...m, pct: ev.pct, loaded: ev.loaded, total: ev.total }));
      else if (ev.type === 'ready') setModel((m) => ({ ...m, state: 'ready', pct: 100, device: ev.device }));
      else if (ev.type === 'fatal') setModel((m) => ({ ...m, state: 'error', error: ev.message }));
    }).catch((e) =>
      setModel((m) => ({ ...m, state: 'error', error: e.message })));
  }, []);

  // Restore saved images.
  useEffect(() => {
    db.getAll()
      .then((rows) => setItems(rows.sort((a, b) => a.addedAt - b.addedAt).map(hydrate)))
      .catch((e) => addError(e.message));
    navigator.storage?.persist?.();
  }, []);

  const addFiles = useCallback(async (fileList) => {
    const files = [...fileList];
    const good = [];
    for (const f of files) {
      if (!ACCEPTED.includes(f.type)) addError(`“${f.name}” isn’t supported. Use JPG, PNG, WebP or GIF.`);
      else if (f.size > MAX_BYTES) addError(`“${f.name}” is ${mb(f.size)} MB. The limit is 15 MB per image.`);
      else good.push(f);
    }
    if (!good.length) return;
    let done = 0;
    for (const f of good) {
      setIndexing({ done, total: good.length, name: f.name });
      try {
        const thumb = await makeThumbnail(f);
        const embedding = await embedImage(f);
        const row = { id: crypto.randomUUID(), name: f.name, size: f.size, addedAt: Date.now(), thumb, original: f, embedding, chat: mockChat() };
        await db.putItem(row);
        setItems((prev) => [...prev, hydrate(row)]);
      } catch (e) {
        addError(`“${f.name}” couldn’t be indexed: ${e.message}`);
      }
      done++;
    }
    setIndexing(null);
  }, []);

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || !items.length) return;
    setSearching(true);
    try {
      const emb = await embedText(q);
      setResults({ q, hits: rank(emb, items, 5) });
    } catch (err) {
      addError('Search failed: ' + err.message);
    } finally { setSearching(false); }
  };

  const remove = async (id) => {
    try {
      await db.deleteItem(id);
      setItems((p) => { const g = p.find((i) => i.id === id); g && URL.revokeObjectURL(g.url); return p.filter((i) => i.id !== id); });
      setResults((r) => r && { ...r, hits: r.hits.filter((h) => h.item.id !== id) });
    } catch (e) { addError(e.message); }
  };

  const clear = async () => {
    if (!window.confirm('Delete all images and embeddings stored in this browser?')) return;
    try {
      await db.clearAll();
      items.forEach((i) => URL.revokeObjectURL(i.url));
      setItems([]); setResults(null);
    } catch (e) { addError(e.message); }
  };

  const ready = model.state === 'ready';
  const busy = !!indexing;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Chat History Search</h1>
          <p className="mt-1 max-w-xl text-slate-600">Find a photo from a conversation by describing it. Everything runs in your browser. Nothing is uploaded.</p>
        </div>
        <ModelStatus m={model} />
      </header>

      {model.state === 'error' && (
        <Alert tone="red">
          The search model failed to load: {model.error}. Check your connection (the model downloads once from Hugging Face) and reload the page.
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert tone="amber" onClose={() => setErrors([])}>
          <ul className="space-y-1">{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </Alert>
      )}

      <form onSubmit={search} className="mb-8 flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Describe the image you’re looking for</label>
        <input
          id="q" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={items.length ? 'Try “a dog on a beach” or “birthday cake”' : 'Add images first, then describe one to find it'}
          disabled={!ready || !items.length}
          className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-5 py-3 text-base shadow-sm disabled:bg-slate-100"
        />
        <button disabled={!ready || !items.length || searching || busy || !query.trim()}
          className="rounded-full bg-ultra px-6 py-3 font-semibold text-white disabled:opacity-40">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results && (
        <section aria-live="polite" className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Top matches for “{results.q}”</h2>
          {results.hits.length === 0 ? <p className="text-slate-600">No images left to show.</p> : (
            <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.hits.map(({ item, score }, i) => <ResultCard key={item.id} item={item} score={score} best={i === 0} rank={i + 1} />)}
            </ol>
          )}
          <p className="mt-3 text-sm text-slate-500">Scores are cosine similarity. CLIP scores are usually between 0.15 and 0.35, so compare them against each other rather than against 1.0.</p>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your images <span className="font-normal text-slate-500">({items.length})</span></h2>
          {items.length > 0 && <button onClick={clear} className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">Clear all data</button>}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`mb-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${dragging ? 'border-ultra bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <p className="mb-3 text-slate-700">Drag images here, or</p>
          <button onClick={() => inputRef.current?.click()} disabled={!ready || busy}
            className="rounded-full border border-ultra px-5 py-2 font-semibold text-ultra disabled:opacity-40">Choose images</button>
          <input ref={inputRef} type="file" multiple accept={ACCEPTED.join(',')} hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {!ready && model.state === 'loading' && <p className="mt-3 text-sm text-slate-500">Uploads unlock once the model has loaded.</p>}
          {indexing && (
            <div className="mx-auto mt-4 max-w-md text-left" aria-live="polite">
              <Bar pct={(indexing.done / indexing.total) * 100} />
              <p className="mt-1 text-sm text-slate-600">Indexing {indexing.done + 1} of {indexing.total}: {indexing.name}</p>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <p className="py-8 text-center text-slate-500">No images yet. Add a few photos to try a search.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((it) => (
              <li key={it.id} className="group relative overflow-hidden rounded-xl bg-white shadow-sm">
                <img src={it.url} alt={it.name} className="aspect-square w-full object-cover" />
                <button onClick={() => remove(it.id)} aria-label={`Delete ${it.name}`}
                  className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-lg font-bold text-red-700 shadow focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function hydrate(row) {
  return { ...row, embedding: new Float32Array(row.embedding), url: URL.createObjectURL(row.thumb) };
}

function ModelStatus({ m }) {
  if (m.state === 'ready') return <p className="rounded-full bg-white px-4 py-1.5 text-sm shadow-sm">Model ready · {m.device}</p>;
  if (m.state === 'error') return <p className="rounded-full bg-red-100 px-4 py-1.5 text-sm text-red-800">Model not loaded</p>;
  return (
    <div className="w-64" aria-live="polite">
      <p className="mb-1 text-sm text-slate-600">
        {m.total ? `Downloading model ${mb(m.loaded)} / ${mb(m.total)} MB` : 'Preparing model…'}
      </p>
      <Bar pct={m.pct} />
    </div>
  );
}

function Bar({ pct }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-ultra transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Alert({ tone, children, onClose }) {
  const c = tone === 'red' ? 'bg-red-50 text-red-900 border-red-200' : 'bg-amber-50 text-amber-900 border-amber-200';
  return (
    <div role="alert" className={`mb-5 flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${c}`}>
      <div>{children}</div>
      {onClose && <button onClick={onClose} className="font-semibold underline">Dismiss</button>}
    </div>
  );
}

function ResultCard({ item, score, best, rank: n }) {
  const date = new Date(item.chat.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <li className={`overflow-hidden rounded-2xl bg-white shadow-sm ${best ? 'ring-2 ring-ultra' : ''}`}>
      <img src={item.url} alt={item.name} className="aspect-[4/3] w-full object-cover" />
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">#{n}{best ? ' best match' : ''}</span>
          <span className="tabular-nums text-sm font-semibold text-ultra">{score.toFixed(3)}</span>
        </div>
        <div className="rounded-2xl rounded-bl-sm bg-sent px-3 py-2 text-sm">
          <p className="font-medium">{item.chat.contact}</p>
          <p>{item.chat.message}</p>
          <p className="mt-0.5 text-xs text-slate-600">{date} · {item.name}</p>
        </div>
      </div>
    </li>
  );
}
