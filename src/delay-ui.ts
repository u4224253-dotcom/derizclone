// Tampilan plugin Delay: panel putih dengan knob bertik, layar LCD BPM, tombol mode, dan meter stereo (jendela tengah layar, seperti DERIZ).
// Di panel efek hanya kartu ringkas (judul + ringkasan); isi lengkap ada di .dly yang baru terlihat saat kartu dibuka di overlay.
// Semua ukuran dalam "unit desain" (panel = 630 x 340) dikali --u (lebar kontainer / 630), jadi tampilan mengecil / membesar mengikuti lebar jendela.
// Nilai knob tetap 0..1 di fx.v; satuan nyata ada di delay-fx.ts.

import {
  NOTE_STEPS, NOTE_COUNT, DEFAULT_NOTE, noteIndex, bpmOf, bpmValue, syncMode, syncStereo, msOf, getHostBpm,
  feedbackPct, hpHz, lpHz, rateHz, outDb, analogLevel,
} from './delay-fx';

type V = Record<string, number>;

export interface DelayParam {
  key: string; label: string; hint?: string; def: number; fmt: (v: number) => string;
  fmtFx?: (v: number, all: V) => string;       // format yang bergantung pada parameter lain (mis. waktu: note atau ms)
  steps?: number | ((all: V) => number);         // 0 / undefined = kontinu
  dk?: boolean;                                 // knob gaya Delay (bukan knob DERIZ)
}

const pctF = (v: number): string => Math.round(v * 100) + '%';
const fmtMs = (ms: number): string => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s');
const fmtHzD = (hz: number): string => hz >= 10000 ? Math.round(hz / 1000) + ' kHz' : hz >= 1000 ? (hz / 1000).toFixed(1) + ' kHz' : hz >= 100 ? Math.round(hz) + ' Hz' : hz >= 10 ? hz.toFixed(1) + ' Hz' : hz.toFixed(2) + ' Hz';
const fmtDbD = (db: number): string => (db > 0.05 ? '+' : db < -0.05 ? '−' : '') + Math.abs(db).toFixed(1) + ' dB';
const ANALOG_NAMES = ['Off', '1', '2', '3', '4'];
const MODE_NAMES = ['BPM', 'HOST', 'MS'];

export const DELAY_PARAMS: DelayParam[] = [
  { key: 'time', label: 'Time', hint: 'Delay (jarak antar echo)', def: DEFAULT_NOTE, dk: true,
    steps: a => (syncMode(a.sync) === 2 ? 0 : NOTE_COUNT),
    fmt: v => NOTE_STEPS[noteIndex(v)].label, fmtFx: (v, a) => (syncMode(a.sync) === 2 ? fmtMs(msOf(v)) : NOTE_STEPS[noteIndex(v)].label) },
  { key: 'feedback', label: 'Feedback', hint: 'Feedback (jumlah ulangan)', def: 0.25, dk: true, fmt: v => feedbackPct(v) + '%' },
  { key: 'depth', label: 'Depth', hint: 'Depth (kedalaman modulasi)', def: 0, dk: true, fmt: pctF },
  { key: 'rate', label: 'Rate', hint: 'Rate (kecepatan modulasi)', def: 0.3, dk: true, fmt: v => fmtHzD(rateHz(v)) },
  { key: 'hp', label: 'HiPass', hint: 'HiPass (buang bass echo)', def: 0, dk: true, fmt: v => fmtHzD(hpHz(v)) },
  { key: 'lp', label: 'LoPass', hint: 'LoPass (gelapkan echo)', def: 1, dk: true, fmt: v => fmtHzD(lpHz(v)) },
  { key: 'dw', label: 'Dry/Wet', hint: 'Dry/Wet (campuran echo)', def: 0.35, dk: true, fmt: pctF },
  { key: 'out', label: 'Output', hint: 'Output (level akhir)', def: 0.5, dk: true, fmt: v => fmtDbD(outDb(v)) },
  { key: 'analog', label: 'Analog', hint: 'Analog (saturasi + gelap ala pita)', def: 0, dk: true, steps: 5, fmt: v => ANALOG_NAMES[analogLevel(v)] },
  { key: 'bpm', label: 'BPM', hint: 'BPM (tempo delay)', def: bpmValue(120), dk: true, fmt: v => bpmOf(v) + ' BPM' },
  { key: 'stereo', label: 'Stereo', def: 0, steps: 2, fmt: v => (syncStereo(v) ? 'Ping Pong' : 'Dual') },
  { key: 'phl', label: 'Phase L', def: 0, steps: 2, fmt: v => (v >= 0.5 ? 'Ø L aktif' : 'Ø L mati') },
  { key: 'phr', label: 'Phase R', def: 0, steps: 2, fmt: v => (v >= 0.5 ? 'Ø R aktif' : 'Ø R mati') },
  { key: 'sync', label: 'Sync', def: 0.5, steps: 3, fmt: v => MODE_NAMES[syncMode(v)] },
  { key: 'link', label: 'Link', def: 0, steps: 2, fmt: v => (v >= 0.5 ? 'Link nyala' : 'Link mati') },
];
export const delayParam = (key: string): DelayParam => DELAY_PARAMS.find(p => p.key === key)!;
export const stepsOfParam = (p: { steps?: number | ((a: V) => number) }, all: V): number => (typeof p.steps === 'function' ? p.steps(all) : p.steps ?? 0);

// ---------- knob ----------
const ARC = 270, A0 = -135;
const sinCos = (deg: number): [number, number] => { const a = deg * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };
const n1 = (n: number): string => (Math.round(n * 100) / 100).toString();

function tickSvg(count: number, disc: number, step?: number): string {   // count tik merata sepanjang 270 derajat; step: hanya tik di posisi diskrit (Analog)
  let s = '';
  const total = step ? step : count;
  for (let i = 0; i < total; i++) {
    const f = total === 1 ? 0 : i / (total - 1), [sx, sy] = sinCos(A0 + f * ARC);
    const major = step ? true : i === 0 || i === total - 1 || i % 5 === 0, r1 = disc + (major ? 3 : 4.2);
    s += `<line x1="${n1(sx * r1)}" y1="${n1(sy * r1)}" x2="${n1(sx * 49)}" y2="${n1(sy * 49)}" class="${major ? 'is-major' : ''}"/>`;
  }
  return s;
}

function knob(key: string, label: string, cx: number, cy: number, size: number, o: { ticks?: number; steps?: number; disc?: number } = {}): string {
  const disc = (o.disc ?? 0.8) * 50;
  return `<div class="dly__k" style="--x:${cx};--y:${cy};--s:${size}"><div class="dk" role="slider" tabindex="0" data-k="${key}" aria-label="Delay ${label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" style="--disc:${o.disc ?? 0.8}">` +
    `<svg class="dk__ticks" viewBox="-50 -50 100 100" aria-hidden="true">${tickSvg(o.ticks ?? 41, disc, o.steps)}</svg>` +
    `<div class="dk__disc"><i class="dk__ptr"></i></div></div></div>`;
}
const lab = (text: string, cx: number, top: number): string => `<span class="dly__lab" style="--x:${cx};--y:${top}">${text}</span>`;
function rng(cx: number, cy: number, size: number, left: string, right: string, key?: string): string {   // angka ujung rentang, di bawah kiri / kanan knob
  const r = size / 2 + 6, [sx, sy] = sinCos(135), [lx, ly] = sinCos(-135);
  return `<span class="dly__rng" ${key ? `data-rng="${key}-l" ` : ''}style="--x:${n1(cx + lx * r)};--y:${n1(cy + ly * r)}">${left}</span>` +
    `<span class="dly__rng" ${key ? `data-rng="${key}-r" ` : ''}style="--x:${n1(cx + sx * r)};--y:${n1(cy + sy * r)}">${right}</span>`;
}
function stepLabels(cx: number, cy: number, size: number, names: string[]): string {   // label di tiap posisi diskrit (Analog)
  const r = size / 2 + 8;
  return names.map((t, i) => { const [sx, sy] = sinCos(A0 + i / (names.length - 1) * ARC); return `<span class="dly__rng" style="--x:${n1(cx + sx * r)};--y:${n1(cy + sy * r)}">${t}</span>`; }).join('');
}
const opt = (key: string, val: number, text: string, grow: number, toggle = false): string =>
  `<button type="button" class="dly__opt" data-opt="${key}" data-val="${val}"${toggle ? ' data-toggle="1"' : ''} aria-pressed="false" style="flex:${grow}">${text}</button>`;

const SCALE = [0, 3, 6, 12, 24, 36, 48];

export function delayHtml(): string {
  const bar = (c: string): string => `<div class="mt__bar ${c}"></div><i class="mt__pk ${c}"></i>`;
  return `<div class="dly" aria-label="Delay"><div class="dly__panel">` +
    `<div class="dly__logo" aria-hidden="true"><span>DERIZ</span><b>DELAY</b></div>` +
    // atas: Delay, layar, Feedback
    knob('time', 'Delay', 78, 103, 116, { ticks: 41 }) + lab('DELAY', 78, 166) + rng(78, 103, 116, '1/64T', '2Bar', 'time') +
    `<div class="dly__seg dly__seg--mode" role="group" aria-label="Mode stereo" style="--x:164;--y:67;--w:114;--h:13">` +
      opt('phl', 1, 'Ø L', 22, true) + opt('stereo', 0, 'PING PONG', 38) + opt('stereo', 1, 'DUAL', 29) + opt('phr', 1, 'Ø R', 22, true) + `</div>` +
    `<div class="dly__lcd" style="--x:164;--y:84;--w:114;--h:72"><span class="lcd__side lcd__side--l">L</span><span class="lcd__side lcd__side--r">R</span>` +
      `<div class="lcd__fr lcd__fr--l"></div><div class="lcd__fr lcd__fr--r"></div>` +
      `<span class="lcd__big" data-lcd="big">120</span><span class="lcd__unit" data-lcd="unit">BPM</span></div>` +
    `<div class="dly__seg dly__seg--sync" role="group" aria-label="Sumber tempo" style="--x:164;--y:160;--w:114;--h:15">` +
      opt('sync', 0, 'BPM', 1) + opt('sync', 0.5, 'HOST', 1) + opt('sync', 1, 'MS', 1) + `</div>` +
    knob('feedback', 'Feedback', 363, 103, 116, { ticks: 41 }) + lab('FEEDBACK', 363, 166) + rng(363, 103, 116, '0', '200') +
    // meter
    `<div class="dly__meter" aria-hidden="true" style="--x:448;--y:52;--w:60;--h:268">${bar('mt--l')}` +
      `<div class="mt__scale">${SCALE.map(db => `<span style="--y:${dbY(db)}">${db}</span>`).join('')}</div>${bar('mt--r')}</div>` +
    // kanan: Dry/Wet, Output, Analog
    knob('dw', 'Dry/Wet', 569, 84, 54, { ticks: 27, disc: 0.68 }) + lab('DRY/WET', 569, 115) + rng(569, 84, 54, '0', '100') +
    knob('out', 'Output', 569, 181, 54, { ticks: 27, disc: 0.68 }) + lab('OUTPUT', 569, 212) + rng(569, 181, 54, '−18', '+18') +
    knob('analog', 'Analog', 569, 276, 54, { steps: 5, disc: 0.68 }) + lab('ANALOG', 569, 308) + stepLabels(569, 276, 54, ['OFF', '1', '2', '3', '4']) +
    // bawah: modulasi + filter
    knob('depth', 'Depth', 58, 245, 66, { ticks: 27, disc: 0.7 }) + lab('DEPTH', 58, 287) + rng(58, 245, 66, '0', '100') +
    knob('rate', 'Rate', 146, 246, 66, { ticks: 27, disc: 0.7 }) + lab('RATE', 146, 287) + rng(146, 246, 66, '0.1', '6K') +
    `<span class="dly__grp" style="--x:102;--y:308">MODULATION</span>` +
    knob('hp', 'HiPass', 254, 246, 66, { ticks: 27, disc: 0.7 }) + lab('HiPASS', 254, 287) + rng(254, 246, 66, '20Hz', '20kHz') +
    `<button type="button" class="dly__link dly__opt" data-opt="link" data-val="1" data-toggle="1" aria-pressed="false" aria-label="Link HiPass dan LoPass" style="--x:319;--y:246"><i></i></button>` + lab('LINK', 319, 268) +
    knob('lp', 'LoPass', 378, 246, 66, { ticks: 27, disc: 0.7 }) + lab('LoPASS', 378, 287) + rng(378, 246, 66, '0.1', '20K') +
    `<span class="dly__grp" style="--x:319;--y:308">FILTERS</span>` +
    `</div></div>` +
    `<button type="button" class="dly__sum" aria-label="Buka Delay di tengah layar" title="Buka di tengah layar"><b data-sum="a"></b><span data-sum="b"></span></button>`;
}

// ---------- meter ----------
const DB_Y: Array<[number, number]> = [[0, 18], [3, 46], [6, 80], [12, 121], [24, 161], [36, 195], [48, 223], [60, 250]];   // atenuasi dB -> posisi y (unit desain di dalam meter)
export function dbY(att: number): number {
  if (att <= 0) return DB_Y[0][1];
  for (let i = 1; i < DB_Y.length; i++) if (att <= DB_Y[i][0]) { const [d0, y0] = DB_Y[i - 1], [d1, y1] = DB_Y[i]; return y0 + (att - d0) / (d1 - d0) * (y1 - y0); }
  return 258;
}
const BAR_TOP = 10, BAR_H = 248;
const hold = new WeakMap<HTMLElement, { lv: [number, number]; pk: [number, number]; pt: [number, number] }>();
export function paintMeter(card: HTMLElement, peak: [number, number], now: number): void {
  const m = card.querySelector<HTMLElement>('.dly__meter'); if (!m) return;
  const st = hold.get(m) ?? { lv: [BAR_H, BAR_H] as [number, number], pk: [BAR_H, BAR_H] as [number, number], pt: [0, 0] as [number, number] };
  hold.set(m, st);
  for (let i = 0; i < 2; i++) {
    const att = peak[i] > 1e-5 ? -20 * Math.log10(peak[i]) : 99;
    const t = Math.max(0, Math.min(BAR_H, dbY(att) - BAR_TOP));
    st.lv[i] = t < st.lv[i] ? t : Math.min(BAR_H, st.lv[i] + 5);   // naik cepat, turun pelan
    if (t <= st.pk[i]) { st.pk[i] = t; st.pt[i] = now; } else if (now - st.pt[i] > 900) st.pk[i] = Math.min(BAR_H, st.pk[i] + 3);   // puncak ditahan 0,9 detik lalu jatuh
    const c = i ? 'mt--r' : 'mt--l';
    m.querySelector<HTMLElement>(`.mt__bar.${c}`)!.style.setProperty('--t', n1(st.lv[i]));
    const pk = m.querySelector<HTMLElement>(`.mt__pk.${c}`)!;
    pk.style.setProperty('--t', n1(st.pk[i])); pk.style.opacity = st.pk[i] >= BAR_H - 1 ? '0' : '.9';
  }
}

// ---------- knob + panel ----------
export function paintDk(el: HTMLElement, v: number, p: DelayParam, all: V): void {
  if (!el.classList.contains('dk--num')) el.style.setProperty('--a', (A0 + v * ARC).toFixed(1) + 'deg');
  el.setAttribute('aria-valuenow', v.toFixed(3));
  el.setAttribute('aria-valuetext', `Delay ${p.label} ${p.fmtFx ? p.fmtFx(v, all) : p.fmt(v)}`);
}

const frac = (num: number, den: number, suf: string): string =>
  `<em>${suf}</em><span class="lcd__f"><i>${num}</i><i>${den}</i></span>`;

export function paintDelayUi(card: HTMLElement, v: V): void {
  const mode = syncMode(v.sync), pp = syncStereo(v.stereo), note = NOTE_STEPS[noteIndex(v.time)];
  card.querySelectorAll<HTMLElement>('.dly__opt').forEach(b => {
    const key = b.dataset.opt!, val = +b.dataset.val!;
    const on = b.dataset.toggle ? (v[key] ?? 0) >= 0.5 : key === 'sync' ? mode === syncMode(val) : key === 'stereo' ? (val === 0) === pp : false;
    b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
  });
  const big = card.querySelector<HTMLElement>('[data-lcd="big"]'), unit = card.querySelector<HTMLElement>('[data-lcd="unit"]');
  if (big && unit) {
    // angka besar LCD = knob BPM (mode BPM), knob Delay (mode MS, dalam ms), atau hanya tampilan (mode HOST)
    const k = mode === 0 ? 'bpm' : mode === 2 ? 'time' : '';
    big.textContent = String(mode === 0 ? bpmOf(v.bpm) : mode === 1 ? Math.round(getHostBpm()) : Math.round(msOf(v.time)));
    unit.textContent = mode === 0 ? 'BPM' : mode === 1 ? 'HOST' : 'MS';
    big.classList.toggle('dk', !!k); big.classList.toggle('dk--num', !!k);
    if (k) { big.dataset.k = k; big.setAttribute('role', 'slider'); big.tabIndex = 0; big.setAttribute('aria-label', 'Delay ' + (k === 'bpm' ? 'BPM' : 'waktu (ms)')); big.setAttribute('aria-valuemin', '0'); big.setAttribute('aria-valuemax', '1'); }
    else { delete big.dataset.k; big.removeAttribute('role'); big.removeAttribute('tabindex'); big.removeAttribute('aria-label'); }
  }
  const html = mode === 2 ? '<span class="lcd__dash">––</span>' : frac(note.num, note.den, note.suf);
  card.querySelectorAll<HTMLElement>('.lcd__fr').forEach(e => { e.innerHTML = html; });
  const tl = card.querySelector('[data-rng="time-l"]'), tr = card.querySelector('[data-rng="time-r"]');
  if (tl && tr) { tl.textContent = mode === 2 ? '5ms' : '1/64T'; tr.textContent = mode === 2 ? '2s' : '2Bar'; }
  // ringkasan di kartu panel
  const a = card.querySelector('[data-sum="a"]'), b = card.querySelector('[data-sum="b"]');
  if (a && b) {
    a.textContent = (mode === 2 ? fmtMs(msOf(v.time)) : note.label) + ' · ' + (pp ? 'Ping Pong' : 'Dual');
    b.textContent = 'FB ' + feedbackPct(v.feedback) + '% · Mix ' + pctF(v.dw);
  }
}

// Link HiPass + LoPass: dua filter bergeser bersama (jarak antar keduanya tetap). Mengembalikan nilai baru pasangan, atau null kalau tidak perlu.
export function linkedPartner(v: V, key: string, before: number, now: number): { key: string; val: number } | null {
  if ((key !== 'hp' && key !== 'lp') || (v.link ?? 0) < 0.5) return null;
  const other = key === 'hp' ? 'lp' : 'hp', val = Math.max(0, Math.min(1, v[other] + (now - before)));
  return val === v[other] ? null : { key: other, val };
}
