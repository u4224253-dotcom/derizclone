// Penyimpanan file project di browser (IndexedDB). Satu project = satu record {name, savedAt, data, clips}.
// data = JSON struktur project; clips = audio clip sebagai Blob WAV (tidak dimasukkan ke JSON supaya ringan).
export interface ProjectRecord { name: string; savedAt: number; data: unknown; clips: Record<string, Blob> }
export interface ProjectInfo { name: string; savedAt: number }

const DB = 'derizmp3', STORE = 'projects';

// Satu koneksi dipakai bersama (tidak buka-tutup tiap operasi). Kalau koneksi putus / macet, dibuka ulang otomatis.
let dbp: Promise<IDBDatabase> | null = null;
function openOnce(version?: number): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    let r: IDBOpenDBRequest;
    try { r = version ? indexedDB.open(DB, version) : indexedDB.open(DB); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, {keyPath: 'name'}); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('IndexedDB gagal dibuka'));
    // onblocked: tab lain masih memegang koneksi lama; onsuccess menyusul begitu dilepas, jadi tidak perlu ditangani
  });
}
async function open(): Promise<IDBDatabase> {
  let db = await openOnce();   // tanpa nomor versi: ikut versi yang sudah ada (database baru otomatis dibuat versi 1 + store project)
  if (!db.objectStoreNames.contains(STORE)) {   // database bernama sama sudah ada tapi tanpa store project: naikkan versi supaya store dibuat
    const v = db.version + 1; db.close(); db = await openOnce(v);
  }
  db.onversionchange = () => { db.close(); dbp = null; };
  db.onclose = () => { dbp = null; };
  return db;
}
const timeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('penyimpanan browser tidak merespons')), ms);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const db = await timeout(dbp ||= open(), 8000);
      return await new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE));
        t.oncomplete = () => res(q.result);
        t.onerror = t.onabort = () => rej(t.error || new Error('transaksi penyimpanan gagal'));
      });
    } catch (e) {
      dbp = null;   // koneksi dianggap rusak: buka ulang
      if (attempt >= 1) throw e;   // gagal dua kali berturut-turut: lapor ke pemanggil
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// Minta browser jangan membuang data situs ini saat penyimpanan menipis (project hilang diam-diam kalau tidak persisten)
export function keepStorage(): void { try { void navigator.storage?.persist?.(); } catch { /* tidak didukung */ } }

export const saveProject = (rec: ProjectRecord) => { keepStorage(); return tx('readwrite', s => s.put(rec)); };
export const loadProject = (name: string) => tx<ProjectRecord | undefined>('readonly', s => s.get(name));
export const deleteProject = (name: string) => tx('readwrite', s => s.delete(name));
export async function listProjects(): Promise<ProjectInfo[]> {
  const all = await tx<ProjectRecord[]>('readonly', s => s.getAll());
  return all.filter(r => r && typeof r.name === 'string' && r.name).map(r => ({name: r.name, savedAt: Number(r.savedAt) || 0})).sort((a, b) => b.savedAt - a.savedAt);
}
export const projectExists = async (name: string) => !!(await loadProject(name));

// ---- ekspor / impor file .json (audio clip jadi data URL di dalam JSON) ----
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
export async function recordToJson(rec: ProjectRecord): Promise<string> {
  const clips: Record<string, string> = {};
  for (const [k, b] of Object.entries(rec.clips)) clips[k] = await toDataUrl(b);
  return JSON.stringify({app: 'derizmp3', name: rec.name, savedAt: rec.savedAt, data: rec.data, clips});
}
// data URL -> Blob lewat atob (tanpa fetch('data:...'), yang bisa gagal di sebagian browser / kebijakan keamanan)
function dataUrlToBlob(u: string): Blob {
  const i = u.indexOf(',');
  if (!u.startsWith('data:') || i < 0) throw new Error('data audio di file rusak');
  const head = u.slice(5, i), bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length);
  for (let n = 0; n < bin.length; n++) a[n] = bin.charCodeAt(n);
  return new Blob([a], {type: head.split(';')[0] || 'audio/wav'});
}
export async function jsonToRecord(text: string): Promise<ProjectRecord> {
  const j = JSON.parse(text.replace(/^\uFEFF/, ''));   // BOM di awal file (editor / aplikasi file tertentu) tidak boleh bikin gagal
  if (j.app !== 'derizmp3' || !j.data) throw new Error('bukan file project derizmp3');
  const clips: Record<string, Blob> = {};
  for (const [k, u] of Object.entries(j.clips || {})) clips[k] = dataUrlToBlob(String(u));
  return {name: String(j.name || 'Project'), savedAt: Date.now(), data: j.data, clips};
}
