export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_BYTES = 15 * 1024 * 1024;

// Embeddings are L2-normalised, so cosine similarity equals the dot product.
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function rank(queryEmb, items, k = 5) {
  return items
    .map((it) => ({ item: it, score: cosine(queryEmb, it.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function makeThumbnail(file, size = 360) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Thumbnail failed'))), 'image/jpeg', 0.82));
}

const CONTACTS = ['Maya', 'Jon', 'Priya', 'Study group', 'Mum', 'Alex', 'Design crew'];
const LINES = [
  'Sending this over before I forget!', 'Look what I found today', 'Can you save this for later?',
  'This is the one from last week', 'Sharing for the project board', 'Thought of you when I saw this',
  'Put this in the shared folder please', 'Remember this? 😄',
];
export function mockChat() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const d = new Date(Date.now() - Math.random() * 90 * 864e5);
  return { contact: pick(CONTACTS), message: pick(LINES), date: d.toISOString() };
}
