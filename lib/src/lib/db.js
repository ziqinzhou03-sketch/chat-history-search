const DB_NAME = 'chat-history-search';
const STORE = 'images';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Could not open local storage: ' + (req.error?.message || 'unknown error')));
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result.result); };
    tx.onerror = tx.onabort = () => {
      db.close();
      const e = tx.error;
      reject(new Error(e?.name === 'QuotaExceededError'
        ? 'Storage is full. Delete some images and try again.'
        : 'Local storage failed: ' + (e?.message || 'unknown error')));
    };
  });
}

export const getAll = () => run('readonly', (s) => s.getAll());
export const putItem = (item) => run('readwrite', (s) => s.put(item));
export const deleteItem = (id) => run('readwrite', (s) => s.delete(id));
export const clearAll = () => run('readwrite', (s) => s.clear());
