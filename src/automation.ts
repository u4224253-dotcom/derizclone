// Automation Clip: kurva nilai (0..1) yang menggerakkan satu knob / slider efek selama lagu diputar.
// Satu clip di timeline = elemen .pattern dengan data-au-id (kunci data di sini). Titik kurva disimpan dalam KETUKAN dari awal clip
// (bukan piksel), jadi zoom tidak mengubah apa pun; memanjangkan clip menahan nilai titik terakhir, memendekkan hanya memotong.
// Modul ini murni data + gambar + editor; yang tahu soal lane, playback, dan efek adalah main.ts.

import type { AutoParamInfo } from './fx-rack';

export interface AutoPoint { x: number; y: number }   // x: ketukan dari awal clip, y: 0..1 (nilai knob)
export interface AutoTargetRef { track: string; fxId: number; key: string }
export interface AutoClip { target: AutoTargetRef | null; pts: AutoPoint[] }   // target null = efeknya sudah tidak ada (clip diam)
export interface AutoSaved { p: Array<[number, number]> }   // bentuk simpanan titik (target disimpan main.ts, karena id efek tidak tetap antar sesi)

const clips = new Map<string, AutoClip>();
let seq = 0;
const GAP = 0.01;   // jarak minimum antar titik (ketukan): dua titik tidak boleh persis sama x supaya interpolasi aman
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export const getClip = (id: string): AutoClip | undefined => clips.get(id);
export const hasClip = (id: string): boolean => clips.has(id);

// Clip baru: garis datar di nilai knob saat ini, jadi menekan Play tidak mengubah bunyi sampai pengguna menggambar kurvanya
export function createClip(target: AutoTargetRef | null, value: number, lenBeats: number): string {
  const id = 'au' + (++seq), v = clamp01(value);
  clips.set(id, { target, pts: [{ x: 0, y: v }, { x: Math.max(GAP * 2, lenBeats), y: v }] });
  return id;
}

export function importClip(target: AutoTargetRef | null, saved: AutoSaved): string {
  const id = 'au' + (++seq);
  const pts = (saved.p || []).map(([x, y]) => ({ x: Math.max(0, +x || 0), y: clamp01(+y || 0) })).sort((a, b) => a.x - b.x);
  if (!pts.length) pts.push({ x: 0, y: 0.5 });
  clips.set(id, { target, pts });
  return id;
}
export const exportClip = (id: string): AutoSaved => ({ p: (clips.get(id)?.pts ?? []).map(q => [Math.round(q.x * 1e4) / 1e4, Math.round(q.y * 1e4) / 1e4] as [number, number]) });

// Nilai kurva di ketukan `beat` (dari awal clip); sebelum titik pertama / sesudah titik terakhir = nilai titik itu (ditahan)
export function valueAt(id: string, beat: number): number | undefined {
  const c = clips.get(id); if (!c || !c.pts.length) return undefined;
  const p = c.pts;
  if (beat <= p[0].x) return p[0].y;
  const last = p[p.length - 1];
  if (beat >= last.x) return last.y;
  let i = 1; while (i < p.length - 1 && p[i].x < beat) i++;
  const a = p[i - 1], b = p[i], t = (beat - a.x) / Math.max(1e-9, b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

export function setTarget(id: string, target: AutoTargetRef | null): void { const c = clips.get(id); if (c) c.target = target; }

// Copy pattern: kurva yang sama, clip baru (diedit terpisah)
export function cloneClip(id: string): string {
  const c = clips.get(id), nid = 'au' + (++seq);
  clips.set(nid, { target: c?.target ? { ...c.target } : null, pts: (c?.pts ?? []).map(q => ({ ...q })) });
  return nid;
}

// Bagi dua di ketukan `cut`: clip kiri dipotong di titik itu, clip kanan (id baru) mulai dari nilai kurva di titik itu. Mengembalikan id kanan.
export function splitClip(id: string, cut: number): string {
  const c = clips.get(id), nid = 'au' + (++seq);
  if (!c) { clips.set(nid, { target: null, pts: [{ x: 0, y: 0.5 }] }); return nid; }
  const at = valueAt(id, cut) ?? 0.5;
  const left = c.pts.filter(q => q.x < cut - GAP), right = c.pts.filter(q => q.x > cut + GAP).map(q => ({ x: q.x - cut, y: q.y }));
  c.pts = [...left, { x: cut, y: at }];
  clips.set(nid, { target: c.target ? { ...c.target } : null, pts: [{ x: 0, y: at }, ...right] });
  return nid;
}

// Awal clip digeser `delta` ketukan (resize dari kiri): delta > 0 = awal dimajukan (bagian depan kurva dipotong, nilai di titik itu jadi titik awal),
// delta < 0 = awal dimundurkan (nilai awal ditahan di bagian baru). `base` = titik asli sebelum gerakan dimulai (exportClip), supaya ditarik maju-mundur tetap akurat.
export function shiftClip(id: string, delta: number, base?: AutoSaved): void {
  const c = clips.get(id); if (!c) return;
  if (base) c.pts = base.p.map(([x, y]) => ({ x, y }));
  if (!c.pts.length) return;
  if (delta > GAP) {
    const at = valueAt(id, delta) ?? 0.5;
    c.pts = [{ x: 0, y: at }, ...c.pts.filter(q => q.x > delta + GAP).map(q => ({ x: q.x - delta, y: q.y }))];
  } else if (delta < -GAP) {
    const e = -delta;
    c.pts = [{ x: 0, y: c.pts[0].y }, ...c.pts.map(q => ({ x: q.x + e, y: q.y }))];
  }
}

// ---------- gambar mini di dalam clip (timeline) ----------
const SVGNS = 'http://www.w3.org/2000/svg';
export function renderMini(el: HTMLElement, id: string, lenBeats: number): void {
  const c = clips.get(id); if (!c || lenBeats <= 0) return;
  let host = el.querySelector<HTMLElement>('.pattern__auto');
  if (!host) {
    host = document.createElement('div'); host.className = 'pattern__auto';
    el.insertBefore(host, el.querySelector('.pattern__handle'));
  }
  const Y = (v: number): string => (94 - clamp01(v) * 88).toFixed(1);   // sisakan 6 satuan di atas / bawah supaya garis tidak terpotong
  const pts = c.pts.filter(q => q.x < lenBeats);
  const first = c.pts[0], endV = valueAt(id, lenBeats) ?? first.y;
  const line = ['0 ' + Y(pts.length ? first.y : endV), ...pts.map(q => q.x.toFixed(3) + ' ' + Y(q.y)), lenBeats.toFixed(3) + ' ' + Y(endV)];
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + lenBeats.toFixed(3) + ' 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const area = document.createElementNS(SVGNS, 'path'); area.setAttribute('class', 'pattern__auto-fill');
  area.setAttribute('d', 'M' + line.join('L') + 'L' + lenBeats.toFixed(3) + ' 100L0 100Z');
  const ln = document.createElementNS(SVGNS, 'path'); ln.setAttribute('class', 'pattern__auto-line');
  ln.setAttribute('d', 'M' + line.join('L')); ln.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(area, ln);
  host.replaceChildren(svg);
}

// ---------- editor: jendela di tengah layar (gaya sama dengan overlay DERIZ) ----------
export interface AutoEditorOpts {
  id: string;
  len: number;                  // panjang clip (ketukan)
  title: string;                // mis. "Filter · Cutoff"
  color: string;
  info: AutoParamInfo | null;   // null = efek target sudah dihapus: kurva tetap bisa digambar, label nilai jadi persen
  onChange(): void;             // dipanggil tiap kurva berubah (gambar mini di clip diperbarui)
  onClose?(): void;
}

let closeCurrent: (() => void) | null = null;
export const closeAutoEditor = (): void => { closeCurrent?.(); };

export function openAutoEditor(o: AutoEditorOpts): void {
  const found = clips.get(o.id); if (!found) return;
  const clip: AutoClip = found;   // tipe pasti untuk fungsi bersarang di bawah
  closeCurrent?.();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (v: number): string => (o.info ? o.info.fmt(v) : Math.round(v * 100) + '%');
  const bars = o.len / 4, barTxt = (Math.round(bars * 100) / 100).toString().replace('.', ',');
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const root = document.createElement('div');
  root.className = 'autoov';
  root.innerHTML = '<div class="autoov__back"></div>' +
    '<div class="autoov__win" role="dialog" aria-modal="true" aria-label="Automation Clip" tabindex="-1">' +
    '<header class="autoov__head"><div class="autoov__ttl"><b></b><span></span></div>' +
    '<button type="button" class="autoov__btn" data-act="reset" title="Kembalikan jadi garis datar di nilai awal knob">Reset</button>' +
    '<button type="button" class="autoov__btn autoov__btn--pri" data-act="done">Selesai</button></header>' +
    '<div class="autoov__plot"><svg class="autoov__svg" role="application" aria-label="Kurva automation"></svg></div>' +
    '<p class="autoov__read" aria-live="polite"></p>' +
    '<p class="autoov__hint">Ketuk area kosong: tambah titik &nbsp;·&nbsp; seret titik: atur &nbsp;·&nbsp; ketuk dua kali titik: hapus</p></div>';
  root.querySelector('.autoov__ttl b')!.textContent = o.title;
  root.querySelector('.autoov__ttl span')!.textContent = 'Automation Clip · ' + barTxt + ' bar' + (o.info ? '' : ' · efek target dihapus');
  root.style.setProperty('--auto-color', o.color);
  document.body.appendChild(root);

  const win = root.querySelector<HTMLElement>('.autoov__win')!, plot = root.querySelector<HTMLElement>('.autoov__plot')!;
  const svg = root.querySelector<SVGSVGElement>('.autoov__svg')!, read = root.querySelector<HTMLElement>('.autoov__read')!;
  const PADX = 14, PADY = 16;
  let W = 0, H = 0, sel: AutoPoint | null = null, drag: AutoPoint | null = null, lastTap: { p: AutoPoint; t: number } | null = null;
  let down = { x: 0, y: 0 }, armed = false;   // armed: gerakan sudah melewati ambang 4 px (getar jari saat mengetuk tidak menggeser titik)

  const bx = (b: number): number => PADX + (b / o.len) * (W - 2 * PADX);
  const vy = (v: number): number => PADY + (1 - v) * (H - 2 * PADY);
  const toBeat = (x: number): number => Math.max(0, Math.min(o.len, ((x - PADX) / Math.max(1, W - 2 * PADX)) * o.len));
  const toVal = (y: number): number => clamp01(1 - (y - PADY) / Math.max(1, H - 2 * PADY));
  const snapB = (b: number): number => Math.round(b * 4) / 4;   // 1/16 nada (seperempat ketukan)
  const barBeat = (b: number): string => 'bar ' + (Math.floor(b / 4) + 1) + ' · ketukan ' + (Math.round((b % 4 + 1) * 100) / 100).toString().replace('.', ',');
  const say = (p: AutoPoint | null): void => { read.textContent = p ? fmt(p.y) + '  ·  ' + barBeat(p.x) : ''; };

  const el = (name: string, attrs: Record<string, string | number>): SVGElement => {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  };

  function draw(): void {
    W = plot.clientWidth; H = plot.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
    const g: SVGElement[] = [];
    const pxBeat = (W - 2 * PADX) / o.len;
    for (let b = 0; b <= o.len + 1e-6; b += 1) {   // garis ketukan (tipis) dan bar (tebal); ketukan disembunyikan kalau terlalu rapat
      const bar = Math.abs(b % 4) < 1e-6;
      if (!bar && pxBeat < 14) continue;
      g.push(el('line', { x1: bx(b), x2: bx(b), y1: PADY - 6, y2: H - PADY + 6, class: bar ? 'autoov__bar' : 'autoov__beat' }));
    }
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      g.push(el('line', { x1: PADX, x2: W - PADX, y1: vy(v), y2: vy(v), class: v === 0.5 && o.info?.bipolar ? 'autoov__mid' : 'autoov__hline' }));
    }
    for (const v of [1, 0.5, 0]) {   // label nilai di sisi kiri: ujung atas, tengah, ujung bawah knob
      const t = el('text', { x: PADX + 4, y: vy(v) + (v === 1 ? 13 : v === 0 ? -5 : -4), class: 'autoov__lbl' });
      t.textContent = fmt(v); g.push(t);
    }
    const p = clip.pts, first = p[0], last = p[p.length - 1];
    const line = [`${bx(0)} ${vy(first.y)}`, ...p.map(q => `${bx(Math.min(q.x, o.len))} ${vy(q.y)}`), `${bx(o.len)} ${vy(last.y)}`];
    g.push(el('path', { d: 'M' + line.join('L') + `L${bx(o.len)} ${vy(0)}L${bx(0)} ${vy(0)}Z`, class: 'autoov__area' }));
    g.push(el('path', { d: 'M' + line.join('L'), class: 'autoov__line' }));
    for (const q of p) {
      if (q.x > o.len + 1e-6) continue;   // titik di luar clip (clip dipendekkan): tidak digambar, kurvanya tetap ada
      g.push(el('circle', { cx: bx(q.x), cy: vy(q.y), r: q === sel ? 9 : 7, class: 'autoov__pt' + (q === sel ? ' is-sel' : '') }));
    }
    svg.replaceChildren(...g);
  }

  const local = (e: PointerEvent): { x: number; y: number } => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const nearest = (x: number, y: number): AutoPoint | null => {
    let best: AutoPoint | null = null, bd = 22;   // radius sentuh 22 px: nyaman untuk jari
    for (const q of clip.pts) { if (q.x > o.len + 1e-6) continue; const d = Math.hypot(bx(q.x) - x, vy(q.y) - y); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  const sortPts = (): void => { clip.pts.sort((a, b) => a.x - b.x); };
  const changed = (): void => { draw(); o.onChange(); };

  function remove(q: AutoPoint): void {
    if (clip.pts.length <= 1) return;   // minimal satu titik: kurva selalu punya nilai
    clip.pts.splice(clip.pts.indexOf(q), 1);
    if (sel === q) sel = null;
    say(null); changed();
  }

  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const { x, y } = local(e);
    let q = nearest(x, y);
    if (q && lastTap && lastTap.p === q && e.timeStamp - lastTap.t < 380) { lastTap = null; remove(q); return; }   // ketuk dua kali = hapus
    if (!q) {   // area kosong: titik baru langsung bisa diseret
      q = { x: snapB(toBeat(x)), y: toVal(y) };
      if (clip.pts.some(r => Math.abs(r.x - q!.x) < GAP)) q.x += GAP * 2;
      clip.pts.push(q); sortPts(); lastTap = null;
    } else lastTap = { p: q, t: e.timeStamp };
    sel = q; drag = q; down = { x, y }; armed = false;
    svg.setPointerCapture(e.pointerId);
    say(q); changed();
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const { x, y } = local(e);
    if (!armed) { if (Math.hypot(x - down.x, y - down.y) < 4) return; armed = true; lastTap = null; }
    const i = clip.pts.indexOf(drag), prev = clip.pts[i - 1], next = clip.pts[i + 1];
    let nx = snapB(toBeat(x));
    if (prev) nx = Math.max(nx, prev.x + GAP);
    if (next) nx = Math.min(nx, next.x - GAP);
    if (!prev) nx = Math.max(0, nx);
    drag.x = Math.max(0, Math.min(o.len, nx)); drag.y = toVal(y);
    say(drag); changed();
  });
  const end = (): void => { drag = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('contextmenu', e => {   // klik kanan pada titik = hapus
    e.preventDefault();
    const r = svg.getBoundingClientRect(), q = nearest(e.clientX - r.left, e.clientY - r.top); if (q) remove(q);
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); e.stopPropagation(); remove(sel); }
  };
  root.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });   // pintasan DAW (Space, panah) tidak ikut jalan selama editor terbuka
  root.addEventListener('keyup', e => e.stopPropagation());
  document.addEventListener('keydown', onKey, true);
  const onResize = (): void => draw();
  window.addEventListener('resize', onResize);

  root.addEventListener('click', e => {
    const t = e.target as Element;
    if (t.classList.contains('autoov__back')) { close(); return; }
    const b = t.closest<HTMLElement>('[data-act]'); if (!b) return;
    if (b.dataset.act === 'done') close();
    else if (b.dataset.act === 'reset') {   // garis datar di nilai awal knob (atau tengah kalau efeknya sudah tidak ada)
      const v = o.info ? o.info.def : 0.5;
      clip.pts = [{ x: 0, y: v }, { x: Math.max(GAP * 2, o.len), y: v }]; sel = null; say(null); changed();
    }
  });

  let closing = false;
  function close(): void {
    if (closing) return; closing = true;
    if (closeCurrent === close) closeCurrent = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    const fin = (): void => { root.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); o.onClose?.(); };
    if (reduce) { fin(); return; }
    root.style.pointerEvents = 'none';
    root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = fin;
  }
  closeCurrent = close;

  if (!reduce) {
    root.querySelector('.autoov__back')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    win.animate([{ opacity: 0, transform: 'translateY(14px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.3,.64,1)' });
  }
  draw(); win.focus({ preventScroll: true });
}
