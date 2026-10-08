// @ts-nocheck
import { ivkDock, ivkSetCaps } from './ivory-keys';
import { uiTheme, syncTrackColors } from './ui-theme';
import '@fontsource/syncopate/700.css';   // font judul plugin DERIZ (dibundel, tidak butuh internet)
import '@fontsource/plus-jakarta-sans/latin-400.css';   // font gelembung tutorial (dibundel, tidak butuh internet)
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import './no-context-menu';   // tutup menu klik-tahan / klik kanan bawaan browser
import './no-zoom';   // kunci zoom halaman (pinch, Ctrl + roda, Ctrl + / -)
import { openAudioUploadCard, trackAudioFiles } from './audio-upload-card';
import { initEffectsPanel } from './effects-panel';
import { initTrackMeters } from './track-meters';
import { initTrackReorder } from './track-reorder';
import { initFxRack, holdSpec } from './fx-rack';
import { setHostBpm } from './delay-fx';
import { initRecordJelly } from './record-jelly';
import { initPatternJelly } from './pattern-jelly';
import { initClipIconMenu } from './clip-icon-menu';
import { STRETCH_MIN, STRETCH_MAX } from './time-stretch';
import { initLandscape } from './landscape';
import { registerSW } from './pwa';
import { startLicenseGuard } from './license';
import { initMenuPanel, setProjectIO } from './menu-panel';
import { dbgRun, dbgZoom } from './audio-debug';
import { mpcsExport, mpcsImport } from './mpcs';
import { setMgchordBridge, mgchordExport, mgchordImport } from './mgchord';
import { setSpectrumBridge, restoreSpectrum } from './spectrum';
import { setDrumsBridge, drumsRefresh, drumsSyncPlay, openDrums, DRUMS_HIDDEN } from './drums';
import { drumRow, DRUM_KIT } from './drums-audio';
import { setExportIO } from './export-audio';
import { hasSynth, isDrumsTrack, startVoice, releaseVoice, playNote, stopAllSynth } from './synth-engine';
import { click as metroClick, cancel as metroCancel } from './metronome-audio';
import { initMetronomePanel, BPM_MIN, BPM_MAX } from './metronome-panel';
import { initTransportMore } from './transport-more';
import { initPitchPanel, getMasterPitch, setMasterPitch } from './master-pitch';
import { createClip, importClip, exportClip, cloneClip, splitClip, shiftClip, valueAt, getClip, renderMini, openAutoEditor } from './automation';
import { decodeFile, addBuffer, getBuffer, encodeWav, renderWave, play as playClips, stopAll as stopClips, stopTrack, setTrackVolume, setTrackMuted } from './audio-engine';
import { slideSource, glideBeats } from './note-slide';
import { velAlpha } from './velocity';
import { DEMO, LIMITS, demoNotice, demoMount } from './demo';
import { initTutorial } from './tutorial';
const demoTrackFull = (ins) => { if (!DEMO) return false; const cs = [...document.querySelectorAll('.trkcard-wrap')]; if (cs.length >= LIMITS.tracks) { demoNotice('track'); return true; } if (ins === 'DERIZ' && cs.filter(c => c.dataset.ins === 'DERIZ').length >= LIMITS.deriz) { demoNotice('deriz'); return true; } if (ins === 'DERIZ' && fxRack.derizCount() >= LIMITS.derizPlugins) { demoNotice('derizplug'); return true; } return false; };   // DEMO: batas jumlah track / DERIZ
import { openPianoRoll, closePianoRoll, isPianoRollOpen, setPianoRollPlayhead, setPianoRollChangeHandler, setPianoRollPreviewHandler, setPianoRollSeekHandler, getNoteColor, setNoteColor, getPianoRollNotes, setPianoRollNotes, copyPianoRollNotes, trimPianoRollNotes, shiftPianoRollNotes, pianoRollExtraKeys, dropPianoRollNotesOf, clearPianoRollNotes, PR_BEATS } from './piano-roll';
// Tahap 1 (porting tanpa perubahan perilaku): logika dipindah apa adanya dari web-daw.html.
registerSW();   // PWA: bisa di-install & jalan offline (aktif pada hasil build)
startLicenseGuard();   // build full: verifikasi lisensi ke server (tidak ada efek di build demo / dev)
initLandscape();
initMenuPanel();
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)', EASE_SPRING = 'cubic-bezier(.34,1.56,.64,1)', EASE_INOUT = 'cubic-bezier(.65,0,.35,1)';
const TRACK_TPL = document.querySelector('.trkcard-wrap').cloneNode(true);
TRACK_TPL.querySelector('.trkcard').classList.remove('trkcard--on');   // track baru tidak otomatis terpilih dari template
// Gambar penggaris bar/ketukan (bisa di-zoom)
let BARS = 32;   // bertambah otomatis kalau audio yang di-upload lebih panjang dari timeline
const MAX_BARS = 300, H = 48;
const BAR_MIN = 24, BAR_MAX = 3840, BAR_DEFAULT = 80;   // maks 4800%: sampai level 1/64 ketukan kelihatan jelas
const wsEl = document.querySelector('.workspace'), tlEl = document.getElementById('timeline');
let BAR_W = BAR_DEFAULT, W = BARS * BAR_W;
const pl = el => parseFloat(el.style.left) || 0, pw = el => parseFloat(el.style.width) || 0;
// Snap makin halus saat di-zoom besar (1/4 bar sampai 240px, lalu 1/16, 1/32, 1/64)
let progScrollAt = 0;   // waktu terakhir timeline digeser oleh Auto Scroll: scroll semacam itu tidak boleh menutup menu yang sedang terbuka
const isProgScroll = () => performance.now() - progScrollAt < 80;
let snapOn = true;   // tombol Snap di toolbar pattern
const snapStep = () => BAR_W / (BAR_W <= 240 ? 4 : BAR_W <= 640 ? 16 : BAR_W <= 1280 ? 32 : 64);
const canvas = document.getElementById('axis');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const g = canvas.getContext('2d');
function sizeRuler() {
  W = BARS * BAR_W;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  document.getElementById('timeline').style.width = W + 'px';
  document.getElementById('ruler').style.width = W + 'px';
}
// Ruler hanya digambar untuk bagian yang terlihat (+ margin): canvas selebar W akan melewati batas browser saat zoom besar
let rp = {x0: -1, x1: -1, bar: 0};
// Warna tick ruler. Gaya Flat membaca token --flat-pl-tick-a/b/c dari CSS (satu sumber warna, tidak di-hardcode di sini); hasilnya disimpan
// per kombinasi (gaya, tema) supaya getComputedStyle tidak dipanggil tiap repaint saat zoom / scroll.
let rulerKey = '', rulerCols: [string, string, string] = ['#9486ad', '#6f6385', '#5a4f70'];
function rulerColors(): [string, string, string] {
  const root = document.documentElement, flat = root.dataset.uistyle === 'flat', ut = uiTheme(), key = (flat ? 'flat' : 'soft') + '/' + ut;
  if (key === rulerKey) return rulerCols;
  rulerKey = key;
  if (flat) {
    const cs = getComputedStyle(root), tk = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    rulerCols = [tk('--flat-pl-tick-a', '#677089'), tk('--flat-pl-tick-b', '#8d96ab'), tk('--flat-pl-tick-c', '#a9b1c3')];
  } else rulerCols = ut === 'mono' ? ['#8a8a9a', '#6a6a76', '#52525c'] : ['#9486ad', '#6f6385', '#5a4f70'];
  return rulerCols;
}
function paintRuler(force) {
  const cw = wsEl.clientWidth, off = tlEl.offsetLeft;
  const a0 = Math.max(0, wsEl.scrollLeft - off), a1 = Math.min(W, wsEl.scrollLeft - off + cw);
  const pad = cw * .4;
  if (!force && rp.bar === BAR_W &&
      (rp.x0 === 0 || a0 - pad >= rp.x0) && (rp.x1 === W || a1 + pad <= rp.x1)) return;
  const x0 = Math.max(0, Math.floor(a0 - cw)), x1 = Math.min(W, Math.ceil(a1 + cw));
  rp = {x0, x1, bar: BAR_W};
  const d = Math.min(dpr, 16000 / Math.max(1, x1 - x0));
  const nw = Math.max(1, Math.round((x1 - x0) * d)), nh = Math.round(H * d);
  if (canvas.width !== nw || canvas.height !== nh) { canvas.width = nw; canvas.height = nh; }   // ukuran sama (kasus umum saat zoom): cukup hapus, tanpa alokasi ulang backing store
  else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, nw, nh); }
  canvas.style.left = x0 + 'px'; canvas.style.width = (x1 - x0) + 'px';
  g.setTransform(d, 0, 0, d, -x0 * d, 0);
  const [RA, RB, RC] = rulerColors();   // warna tick ruler: per tema UI, atau token --flat-pl-tick-* saat Gaya UI Flat
  const every = BAR_W < 28 ? 4 : BAR_W < 50 ? 2 : 1;
  const beat = BAR_W >= 56, sub = BAR_W >= 160, mid = BAR_W >= 640, fine = BAR_W >= 1280;
  const step = fine ? 1 : mid ? 2 : sub ? 4 : beat ? 16 : 64;   // dalam satuan 1/64 bar
  const b0 = Math.max(0, Math.floor(x0 / BAR_W) - 1), b1 = Math.min(BARS, Math.ceil(x1 / BAR_W) + 1);
  for (let b = b0; b < b1; b++) {
    const bx = b * BAR_W;
    g.fillStyle = RA;
    if (b % every === 0) { g.font = '11px system-ui, sans-serif'; g.fillRect(bx + .5, 24, 1, 24); g.fillText(b + 1, bx + 4, 38); }
    else g.fillRect(bx + .5, 38, 1, 10);
    for (let j = step; j < 64; j += step) {
      const x = bx + j * BAR_W / 64;
      if (x < x0 - 60 || x > x1 + 60) continue;
      const h = j % 16 === 0 ? 10 : j % 4 === 0 ? 5 : j % 2 === 0 ? 3 : 2;
      g.fillStyle = h >= 10 ? RA : RB;
      g.fillRect(x + .5, 48 - h, 1, h);
      if (j % 16 === 0 && BAR_W >= 240) {            // label ketukan: 3.2 = bar 3 ketukan 2
        g.fillStyle = RB; g.font = '10px system-ui, sans-serif';
        g.fillText((b + 1) + '.' + (j / 16 + 1), x + 4, 38);
      } else if (j % 4 === 0 && BAR_W >= 1280) {      // label 1/16: 3.2.4
        g.fillStyle = RC; g.font = '9px system-ui, sans-serif';
        g.fillText((b + 1) + '.' + (((j / 16) | 0) + 1) + '.' + ((j % 16) / 4 + 1), x + 3, 38);
      }
    }
  }
}
sizeRuler(); paintRuler();
window.addEventListener('derizmp3:ui', () => paintRuler(true));   // ganti Tema UI: ruler digambar ulang
const initRec = root => root.querySelectorAll('.trkcard__arm').forEach(btn => {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-checked') === 'true';
    btn.setAttribute('aria-checked', String(!on));
    if (!REDUCE) btn.animate([{transform:'scale(.8)'},{transform:'scale(1.15)',offset:.55},{transform:'scale(1)'}],{duration:380,easing:EASE_OUT});
  });
});
// Card putih kecil (dipakai bersama knob pan & slider volume): muncul saat digeser, menampilkan nilainya
const panTip = document.createElement('div');
panTip.className = 'pan-tip';
panTip.hidden = true;
panTip.setAttribute('role', 'status');
document.body.appendChild(panTip);
let tipTimer = 0;
// Slider volume: 0-150%, 100% = default (gain 1.0), di atasnya boost sampai 150%. Warna ungu ikut bergeser
const initSliders = root => root.querySelectorAll('.slider').forEach(sl => {
  const sync = () => {
    const min = +sl.min, max = +sl.max, v = +sl.value;
    const f = (v - min) / (max - min);
    sl.style.setProperty('--slider-progress', (f * 100) + '%');
    sl.style.setProperty('--slider-progress-fraction', f);
    sl.setAttribute('aria-valuenow', v);
    sl.setAttribute('aria-valuetext', 'Vol ' + Math.round(v) + '%');
  };
  const showTip = ms => {   // card putih persentase tepat di atas thumb slider
    const min = +sl.min, max = +sl.max, f = (+sl.value - min) / (max - min);
    panTip.textContent = Math.round(+sl.value) + '%';
    panTip.hidden = false;
    const r = sl.getBoundingClientRect(), t = panTip.getBoundingClientRect(), TH = 8;
    let left = r.left + TH / 2 + f * (r.width - TH) - t.width / 2;
    left = Math.max(8, Math.min(left, innerWidth - t.width - 8));
    let top = r.top - t.height - 8;
    if (top < 4) top = r.bottom + 8;
    panTip.style.left = left + 'px';
    panTip.style.top = top + 'px';
    clearTimeout(tipTimer);
    if (ms) tipTimer = setTimeout(() => { panTip.hidden = true; }, ms);
  };
  let drag = false;
  sl.addEventListener('pointerdown', () => {
    drag = true; sync(); showTip();
    const end = () => { drag = false; panTip.hidden = true; clearTimeout(tipTimer); };
    addEventListener('pointerup', end, {once: true});
    addEventListener('pointercancel', end, {once: true});
  });
  sl.addEventListener('input', () => { sync(); showTip(drag ? 0 : 900); });   // keyboard: tampil sebentar
  sync();
});

// Knob pan: putar dengan drag (atas/kanan = naik), panah keyboard, dobel klik = reset
const initKnobs = root => root.querySelectorAll('.knob-input').forEach(el => {
  const hideTip = () => { panTip.hidden = true; };
  const showTip = ms => {
    panTip.textContent = el.getAttribute('aria-valuetext');
    panTip.hidden = false;
    const r = el.getBoundingClientRect(), t = panTip.getBoundingClientRect();
    let left = r.right + 6;
    if (left + t.width > innerWidth - 8) left = r.left - t.width - 6;
    panTip.style.left = left + 'px';
    panTip.style.top = (r.top + r.height / 2 - t.height / 2) + 'px';
    clearTimeout(tipTimer);
    if (ms) tipTimer = setTimeout(hideTip, ms);
  };
  const pos = el.querySelector('.knob-pos');
  const arc = el.querySelector('.circle');
  let v = 0.5;
  el.style.touchAction = 'none';
  const render = () => {
    pos.style.transform = 'rotate(' + (-135 + v * 270) + 'deg)';
    const a = Math.min(v, 0.5) * 75, b = Math.max(v, 0.5) * 75;
    arc.setAttribute('stroke-dashoffset', '0');
    arc.setAttribute('stroke-dasharray', '0 ' + a + ' ' + (b - a) + ' 100');
    const pan = Math.round((v - 0.5) * 200);
    el.setAttribute('aria-valuenow', v.toFixed(3));
    el.setAttribute('aria-valuetext', 'Pan ' + (pan < 0 ? -pan + ' L' : pan > 0 ? pan + ' R' : '0'));
  };
  const set = n => { v = Math.max(0, Math.min(1, n)); render(); if (!panTip.hidden) showTip(); };
  let sx = 0, sy = 0, sv = 0.5, drag = false;
  el.addEventListener('pointerdown', e => {
    drag = true; el.classList.add('is-dragging'); sx = e.clientX; sy = e.clientY; sv = v;
    el.setPointerCapture(e.pointerId); e.preventDefault(); showTip();
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    set(sv + ((sy - e.clientY) + (e.clientX - sx)) / 150);
  });
  const end = () => { drag = false; el.classList.remove('is-dragging'); hideTip(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { set(0.5); showTip(900); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(v + 0.02); showTip(900); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(v - 0.02); showTip(900); e.preventDefault(); }
  });
  render();
});
// Menu titik tiga: Delete & Color
const COLORS = ['#ff5c9e','#a66cff','#5b8ff3','#2dd4bf','#3fbf5f','#f2b632','#ff8a4c','#ef4444'];
syncTrackColors(COLORS); window.addEventListener('derizmp3:ui', () => syncTrackColors(COLORS));   // set warna mengikuti Tema UI
let menu = null, sub = null, menuBtn = null;
function fadeOut(el) {
  el.style.pointerEvents = 'none';
  el.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.9) translateY(-4px)'}],
    {duration:160,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}).onfinish = () => el.remove();
}
function closeMenu(instant) {
  const s = sub, m = menu, b = menuBtn;
  sub = menu = menuBtn = null;
  [s, m].forEach(el => { if (el) (instant === true || instant instanceof Event || REDUCE) ? el.remove() : fadeOut(el); });
  if (b) b.setAttribute('aria-expanded', 'false');
}
function removeTrack(cont, lane) {
  stopTrack(actx, cont.dataset.track);
  if (kbdCont === cont) closeKbd();
  if (selTrack && cont.contains(selTrack)) selTrack = null;
  fxRack.drop(cont.dataset.track);
  if (lane && selPat && lane.contains(selPat)) selectPattern(null);
  if (REDUCE) { if (lane) lane.remove(); cont.remove(); return; }
  const h = cont.offsetHeight, o = {duration:420, easing:EASE_INOUT, fill:'forwards'};
  cont.style.overflow = 'hidden';
  cont.animate([
    {height:h+'px', paddingTop:'4px', opacity:1, transform:'translateX(0) scale(1)'},
    {opacity:0, transform:'translateX(-48px) scale(.94)', offset:.5},
    {height:'0px', paddingTop:'0px', opacity:0, transform:'translateX(-48px) scale(.94)'}], o).onfinish = () => cont.remove();
  if (lane) {
    lane.style.overflow = 'hidden';
    lane.animate([{height:h+'px',opacity:1},{opacity:0,offset:.5},{height:'0px',opacity:0}], o).onfinish = () => lane.remove();
  }
}
function openMenu(btn) {
  closeMenu(true);
  const cont = btn.closest('.trkcard-wrap');
  const cur = cont.style.getPropertyValue('--track-color') || COLORS[0];
  menu = document.createElement('div');
  menu.className = 'track-menu mixer-menu';
  menu.setAttribute('role', 'menu');
  const rnLane = document.querySelector('.lane[data-track="' + cont.dataset.track + '"]');
  const rnPats = rnLane ? [...rnLane.querySelectorAll('.pattern')].sort((a, b) => pl(a) - pl(b)) : [];
  const rnTarget = lastPat && rnPats.includes(lastPat) ? lastPat : rnPats[0] || null;   // pattern terakhir dipilih di track ini, kalau tidak ada: yang paling kiri
  menu.innerHTML =
    '<button role="menuitem" class="track-menu__item" data-act="rename"' + (rnTarget ? '' : ' disabled title="Track ini belum punya pattern"') + '>' +
      '<span class="ico"><svg class="ico-ln" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span>' +
      '<span>Ganti nama pattern</span></button>' +
    '<button role="menuitem" class="track-menu__item" data-act="duplicate"' + (cont.dataset.ins === 'Automation' ? ' disabled title="Track Automation tidak bisa diduplikat"' : '') + '>' +
      '<span class="ico"><svg class="ico-ln" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>' +
      '<span>Duplicate track</span></button>' +
    '<button role="menuitem" class="track-menu__item track-menu__item--danger" data-act="delete">' +
      '<span class="ico"><svg class="ico-ln" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span>' +
      '<span>Delete track</span></button>' +
    '<button role="menuitem" class="track-menu__item" data-act="color" aria-expanded="false">' +
      '<span class="track-menu__dot" style="background:' + cur + '"></span><span>Color</span>' +
      '<svg class="track-menu__chev ico-ln" viewBox="0 0 24 24" width="14" height="14" stroke-width="2.4" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>' +
    '';
  document.body.appendChild(menu);
  // posisi: di sebelah kanan tombol, kalau tidak muat pindah ke kiri
  const r = cont.getBoundingClientRect(), m = menu.getBoundingClientRect();
  let left = r.right + 4;
  if (left + m.width > innerWidth - 8) left = Math.max(8, r.left - m.width - 4);
  menu.style.left = left + 'px';
  menu.style.top = Math.max(8, Math.min(r.top + 12, innerHeight - m.height - 8)) + 'px';
  menu.style.transformOrigin = left >= r.right ? 'left top' : 'right top';
  btn.setAttribute('aria-expanded', 'true');
  menuBtn = btn;

  menu.addEventListener('click', e => {
    const it = e.target.closest('[data-act]');
    if (!it) return;
    if (it.dataset.act === 'duplicate') {
      closeMenu(true);
      duplicateTrack(cont);
    } else if (it.dataset.act === 'delete') {
      const lane = document.querySelector('.lane[data-track="' + cont.dataset.track + '"]');
      removeTrack(cont, lane);
      closeMenu();
    } else if (it.dataset.act === 'rename') {
      closeMenu(true);
      if (!rnTarget || !rnTarget.isConnected) return;
      selectPattern(rnTarget);
      rnTarget.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: REDUCE ? 'auto' : 'smooth'});
      setTimeout(() => { if (rnTarget.isConnected) renamePattern(rnTarget); }, 30);
    } else {
      openColors(cont, it);
    }
  });
}
// Card terpisah untuk pilihan warna, muncul di kanan menu utama
function openColors(cont, it) {
  if (sub) { fadeOut(sub); sub = null; it.setAttribute('aria-expanded', 'false'); return; }
  sub = document.createElement('div');
  sub.className = 'track-menu track-menu--colors mixer-menu';
  sub.setAttribute('role', 'menu');
  sub.innerHTML = '<div class="track-menu__swatches">' +
    COLORS.map((c, i) => '<button class="track-menu__swatch" data-c="' + c + '" style="background:' + c + ';--i:' + i + '" aria-label="Warna ' + c + '"></button>').join('') +
    '</div>';
  document.body.appendChild(sub);
  const mr = menu.getBoundingClientRect(), ir = it.getBoundingClientRect(), sr = sub.getBoundingClientRect();
  let left = mr.right + 4;
  if (left + sr.width > innerWidth - 8) left = Math.max(8, mr.left - sr.width - 4);
  sub.style.left = left + 'px';
  sub.style.top = Math.max(8, Math.min(ir.top - 6, innerHeight - sr.height - 8)) + 'px';
  sub.style.transformOrigin = left >= mr.right ? 'left top' : 'right top';
  it.setAttribute('aria-expanded', 'true');
  sub.addEventListener('click', e => {
    const sw = e.target.closest('.track-menu__swatch');
    if (!sw) return;
    cont.style.setProperty('--track-color', sw.dataset.c);
    const ln = document.querySelector('.lane[data-track="' + cont.dataset.track + '"]');
    if (ln) ln.style.setProperty('--track-color', sw.dataset.c);
    const ib = cont.querySelector('.trkcard__inst');
    if (ib && !REDUCE) ib.animate([
      {transform:'scale(1)', boxShadow:'0 0 0 0 ' + sw.dataset.c},
      {transform:'scale(1.28)', boxShadow:'0 0 0 10px transparent', offset:.5},
      {transform:'scale(1)', boxShadow:'0 0 0 0 transparent'}], {duration:550, easing:EASE_OUT});
    closeMenu();
  });
}
const initMore = root => root.querySelectorAll('.trkcard__menu').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation(); closeAddMenu(true);
    if (menuBtn === btn) closeMenu(); else openMenu(btn);
  });
});
document.addEventListener('click', e => { if (menu && !menu.contains(e.target) && !(sub && sub.contains(e.target))) closeMenu(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menu) { const b = menuBtn; closeMenu(); b && b.focus(); }
});
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', () => { if (!isProgScroll()) closeMenu(); }, true);

// Klik area kosong di timeline -> kartu "Add" -> pattern kosong
const lanesEl = document.getElementById('lanes');
let addCard = null, ghost = null;
function dismissAdd(instant) {
  const els = [addCard, ghost]; addCard = ghost = null;
  els.forEach(el => {
    if (!el) return;
    if (instant || REDUCE) { el.remove(); return; }
    el.style.pointerEvents = 'none';
    const kf = el.classList.contains('add-card')
      ? [{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.8)'}] : [{opacity:1},{opacity:0}];
    el.animate(kf, {duration:140, easing:'cubic-bezier(.4,0,1,1)', fill:'forwards'}).onfinish = () => el.remove();
  });
}
// cari posisi (snap ke bar) & lebar yang muat tanpa menimpa pattern lain
function slot(lane, x) {
  const pats = [...lane.querySelectorAll('.pattern')].map(p => ({s:pl(p), e:pl(p) + pw(p)})).sort((a, b) => a.s - b.s);
  let start = Math.floor(x / BAR_W) * BAR_W;
  for (const p of pats) if (p.e > start && p.s <= x) start = p.e;
  let end = Math.min(start + BAR_W * 2, W);
  for (const p of pats) if (p.s >= start && p.s < end) end = p.s;
  return end - start >= BAR_W / 2 ? {start, width: end - start} : null;
}
// Isi note ditampilkan mini di dalam pattern (seperti piano roll kecil): x = ketukan dari awal pattern, y = nada (dipusatkan sesuai rentang nada)
function renderPatNotes(el) {
  const id = el.dataset.prId; if (!id) return;
  const notes = [id, ...pianoRollExtraKeys(id)].flatMap(k => getPianoRollNotes(k));   // nada milik track pattern + nada dari DERIZ lain yang mengisi pattern ini
  let box = el.querySelector('.pattern__notes');
  if (!notes.length) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'pattern__notes'; el.insertBefore(box, el.querySelector('.pattern__handle')); }
  if (isDrumsTrack(el.parentElement.dataset.track)) {   // pattern Drums: tampil sebagai blok per alat (8 baris tetap), bukan tinggi nada
    box.innerHTML = '<svg viewBox="0 0 ' + PR_BEATS + ' ' + DRUM_KIT.length + '" preserveAspectRatio="none" aria-hidden="true" style="width:calc(var(--bar) * ' + PR_BEATS / 4 + ')">' +
      notes.map(n => '<rect x="' + n.s + '" y="' + (drumRow(n.p) + 0.12) + '" width="0.2" height="0.76" rx="0.05"' + (n.v !== undefined ? ' fill-opacity="' + velAlpha(n.v).toFixed(2) + '"' : '') + '/>').join('') + '</svg>';
    return;
  }
  let lo = 127, hi = 0; notes.forEach(n => { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); });
  const rows = Math.max(hi - lo + 1, 8), top = (rows - (hi - lo + 1)) / 2;   // minimal 8 baris supaya 1-2 nada tidak jadi balok raksasa
  box.innerHTML = '<svg viewBox="0 0 ' + PR_BEATS + ' ' + rows + '" preserveAspectRatio="none" aria-hidden="true" style="width:calc(var(--bar) * ' + PR_BEATS / 4 + ')">' +
    notes.map(n => '<rect x="' + n.s + '" y="' + (top + hi - n.p + 0.1) + '" width="' + Math.max(n.l, 0.12) + '" height="0.8"' + (n.v !== undefined ? ' fill-opacity="' + velAlpha(n.v).toFixed(2) + '"' : '') + '/>').join('') + '</svg>';
}
// Banyak DERIZ bisa mengisi satu pattern: nada instrumen bawaan track pemilik pattern disimpan di kunci id pattern, nada DERIZ lain di "<id>@<id DERIZ>"
const patKey = (prId, fxId, laneTrack) => !hasSynth(laneTrack) && fxRack.derizOwnsPlain(laneTrack, fxId) ? prId : prId + '@' + fxId;   // DERIZ pertama yang dibuat di track pemilik pattern pakai kunci polos (data lama tetap terbaca)
const patBase = id => id.split('@')[0];
const copyPatNotes = (from, to, a, b) => { copyPianoRollNotes(from, to, a, b); for (const k of pianoRollExtraKeys(from)) copyPianoRollNotes(k, to + k.slice(from.length), a, b); };
const trimPatNotes = (id, beat) => { trimPianoRollNotes(id, beat); for (const k of pianoRollExtraKeys(id)) trimPianoRollNotes(k, beat); };
setPianoRollChangeHandler(id => { const el = lanesEl.querySelector('.pattern[data-pr-id="' + patBase(id) + '"]'); if (el) renderPatNotes(el); });
document.addEventListener('prbarschange', () => lanesEl.querySelectorAll('.pattern[data-pr-id]').forEach(renderPatNotes));   // Pengaturan > Grid Piano Roll diganti: note mini di semua pattern ikut lebar grid yang baru
function createPattern(lane, sl, ci) {   // ci = {clip, off}: pattern ini adalah audio clip
  const cont = document.querySelector('.trkcard-wrap[data-track="' + lane.dataset.track + '"]');
  const col = cont && cont.style.getPropertyValue('--track-color');
  if (col) lane.style.setProperty('--track-color', col);
  const nm = document.getElementById('track-name-' + lane.dataset.track);
  const el = document.createElement('div');
  el.className = 'pattern';
  el.style.left = sl.start + 'px';
  el.style.width = sl.width + 'px';
  el.innerHTML = '<div class="pattern__head"><span class="pattern__title"></span></div><div class="pattern__handle" aria-label="Panjangkan / pendekkan akhir pattern"></div><div class="pattern__handle pattern__handle--l" aria-label="Panjangkan / pendekkan awal pattern"></div>';
  el.querySelector('.pattern__title').textContent = nm ? nm.textContent : 'Track';
  if (ci) { el.dataset.clip = ci.clip; el.dataset.off = ci.off; if (ci.src) el.dataset.src = ci.src; if (ci.bpm) el.dataset.bpm = ci.bpm; }   // src = clip asli sebelum di-stretch, bpm = BPM yang diisi di menu Tempo
  lane.appendChild(el);
  return el;
}
function onLaneTap(e) {
  if (e.target.closest('.pattern') || e.target.closest('.add-card')) return;
  const lane = e.target.closest('.lane');
  dismissAdd();
  if (!lane) return;
  const x = e.clientX - lane.getBoundingClientRect().left;
  const sl = slot(lane, x);
  if (!sl) return;
  ghost = document.createElement('div');
  ghost.className = 'pattern-ghost';
  ghost.style.left = sl.start + 'px';
  ghost.style.width = sl.width + 'px';
  addCard = document.createElement('button');
  addCard.className = 'add-card';
  addCard.textContent = 'Add';
  addCard.setAttribute('aria-label', 'Tambah pattern kosong');
  addCard.style.left = Math.max(2, Math.min(x - 17, W - 36)) + 'px';
  addCard.addEventListener('click', () => { createPattern(lane, sl); dismissAdd(); });
  lane.append(ghost, addCard);
}
let tap = null;
lanesEl.addEventListener('pointerdown', e => { tap = e.button > 0 ? null : {x:e.clientX, y:e.clientY, t:e.timeStamp, id:e.pointerId}; });
lanesEl.addEventListener('pointercancel', () => { tap = null; });
lanesEl.addEventListener('pointerup', e => {
  if (!tap || tap.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), dt = e.timeStamp - tap.t;
  tap = null;
  if (moved < 8 && dt < 600) onLaneTap(e);
});
document.addEventListener('click', e => { if (addCard && !lanesEl.contains(e.target)) dismissAdd(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && addCard) dismissAdd(); });
// Geser pattern kiri-kanan: bebas saat di-drag, snap ke 1/4 bar saat dilepas
lanesEl.addEventListener('pointerdown', e => {
  const el = e.target.closest('.pattern');
  if (!el || e.button > 0 || e.target.closest('.pattern__handle') || e.target.isContentEditable) return;
  const lane = el.parentElement, w = pw(el), s0 = pl(el), STEP = snapStep();
  let lo = 0, hi = W;
  [...lane.querySelectorAll('.pattern')].filter(p => p !== el).forEach(p => {
    const a = pl(p), b = a + pw(p);
    if (b <= s0 + 1) lo = Math.max(lo, b); else if (a >= s0 + w - 1) hi = Math.min(hi, a);
  });
  const clamp = v => Math.max(lo, Math.min(hi - w, v));
  const sx = e.clientX; let moved = false;
  el.setPointerCapture(e.pointerId);
  const move = ev => {
    if (document.documentElement.classList.contains('is-pat-jelly')) return;   // pattern sedang diangkat (Record Mode jelly): jangan geser yang asli
    const dx = ev.clientX - sx;
    if (!moved) {
      if (Math.abs(dx) < 4) return;
      moved = true; dismissAdd();
      el.classList.remove('is-settling'); el.classList.add('is-dragging');
    }
    el.style.left = clamp(s0 + dx) + 'px';
  };
  const end = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    if (!moved) return;
    el.classList.remove('is-dragging');
    if (!REDUCE) el.classList.add('is-settling');
    el.style.left = clamp(snapOn ? Math.round(pl(el) / STEP) * STEP : pl(el)) + 'px';
    setTimeout(() => el.classList.remove('is-settling'), 320);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
});

// Seleksi pattern (outline putih) + resize lewat bulatan di kanan
let selPat = null;
function handleSide(el) { el.classList.toggle('handle-inside', pl(el) + pw(el) > W - 40); el.classList.toggle('handle-inside-l', pl(el) < 40); }   // bulatan resize kiri / kanan pindah ke dalam pattern kalau mepet ujung timeline
let lastPat = null;   // pattern terakhir yang dipilih (dipakai menu titik tiga: klik tombolnya melepas pilihan, jadi perlu diingat)
function selectPattern(el) {
  if (el) lastPat = el;
  if (selPat === el) return;
  if (selPat) selPat.classList.remove('is-selected');
  selPat = el;
  if (el) { handleSide(el); el.classList.add('is-selected'); }
  patBarShow(el);
  drumsRefresh();   // jendela Drums (kalau terbuka) ikut menampilkan pattern yang baru dipilih
  syncRecFocus();   // Record Mode: blur lane lain hanya saat ada pattern terpilih
}
document.addEventListener('pointerup', () => { if (selPat) setTimeout(() => selPat && handleSide(selPat), 330); });
lanesEl.addEventListener('pointerdown', e => {
  const el = e.target.closest('.pattern');
  if (el && e.button <= 0) {
    if (!e.target.closest('.pattern__handle')) {
      patAnchor = (e.clientX - el.getBoundingClientRect().left) / BAR_W;   // titik klik di dalam pattern
      if (selPat === el) { patBarPlace(); patBarPop(); }   // pattern sama, titik klik baru: muncul ulang di sana (tanpa bergeser)
    }
    selectPattern(el); dismissAdd();
  }
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.pattern, .pat-bar, .pat-menu, .kbd')) selectPattern(null); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && selPat && !addCard) selectPattern(null); });
lanesEl.addEventListener('pointerdown', e => {
  const h = e.target.closest('.pattern__handle:not(.pattern__handle--l)');
  if (!h || e.button > 0) return;
  e.preventDefault();
  const el = h.parentElement, lane = el.parentElement;
  const s0 = pl(el), w0 = pw(el), STEP = snapStep(), MIN = BAR_W / 2;
  let hi = W;
  [...lane.querySelectorAll('.pattern')].filter(p => p !== el).forEach(p => {
    if (pl(p) >= s0 + w0 - 1) hi = Math.min(hi, pl(p));
  });
  const clamp = v => Math.max(MIN, Math.min(hi - s0, v));
  const sx = e.clientX;
  h.setPointerCapture(e.pointerId);
  el.classList.remove('is-snapping'); el.classList.add('is-resizing');
  const move = ev => { el.style.width = clamp(w0 + ev.clientX - sx) + 'px'; handleSide(el); };
  const end = () => {
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', end);
    h.removeEventListener('pointercancel', end);
    el.classList.remove('is-resizing');
    if (!REDUCE) el.classList.add('is-snapping');
    el.style.width = clamp(snapOn ? Math.round((s0 + pw(el)) / STEP) * STEP - s0 : pw(el)) + 'px';
    setTimeout(() => el.classList.remove('is-snapping'), 300);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
});

// Resize dari sisi KIRI (awal pattern): ujung kanan diam, isi pattern tetap di posisi waktunya.
// Audio clip: offset ikut bergeser (tidak bisa ditarik lebih kiri dari awal audio). Nada piano roll & kurva Automation Clip digeser saat dilepas
// (nada / titik yang jatuh sebelum awal baru dipotong, sama seperti "Bagi dua"); selama ditarik, nada mini digeser lewat CSS dan kurva digeser langsung.
lanesEl.addEventListener('pointerdown', e => {
  const h = e.target.closest('.pattern__handle--l');
  if (!h || e.button > 0) return;
  e.preventDefault();
  const el = h.parentElement;
  const s0 = pl(el), end = s0 + pw(el), STEP = snapStep(), MIN = BAR_W / 2;
  const isClip = !!el.dataset.clip, off0 = +el.dataset.off || 0, auId = el.dataset.auId, base = auId ? exportClip(auId) : null;
  let lo = 0;
  otherPats(el).forEach(p => { const b = pl(p) + pw(p); if (b <= s0 + 1) lo = Math.max(lo, b); });   // batas kiri: pattern sebelumnya / awal timeline
  if (isClip) lo = Math.max(lo, s0 - off0 / SEC_PER_BAR * BAR_W);                                    // audio clip: tidak boleh melewati awal audio
  const clamp = v => Math.max(lo, Math.min(end - MIN, v));
  const sx = e.clientX;
  const apply = L => {
    const d = L - s0;
    el.style.left = L + 'px'; el.style.width = (end - L) + 'px';
    if (isClip) el.dataset.off = Math.max(0, off0 + d / BAR_W * SEC_PER_BAR);
    if (auId) shiftClip(auId, d / BAR_W * 4, base);
    el.querySelectorAll('.pattern__notes svg').forEach(sv => { sv.style.transform = d ? 'translateX(' + (-d) + 'px)' : ''; });
    handleSide(el);
  };
  h.setPointerCapture(e.pointerId);
  el.classList.remove('is-snapping'); el.classList.add('is-resizing');
  const move = ev => apply(clamp(s0 + ev.clientX - sx));
  const done = () => {
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', done);
    h.removeEventListener('pointercancel', done);
    el.classList.remove('is-resizing');
    const L = clamp(snapOn ? Math.round(pl(el) / STEP) * STEP : pl(el));
    apply(L);
    el.querySelectorAll('.pattern__notes svg').forEach(sv => { sv.style.transform = ''; });
    const dB = (L - s0) / BAR_W * 4;   // ketukan: + = awal dimajukan (memendek), - = awal dimundurkan (memanjang)
    if (el.dataset.prId && Math.abs(dB) > 1e-6) {
      const id = el.dataset.prId;
      [id, ...pianoRollExtraKeys(id)].forEach(k => shiftPianoRollNotes(k, -dB));
      renderPatNotes(el);
    }
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', done);
  h.addEventListener('pointercancel', done);
});


// ===== Toolbar bulat di atas pattern terpilih =====
const patBar = document.createElement('div');
patBar.className = 'pat-bar'; patBar.hidden = true; patBar.setAttribute('role', 'toolbar'); patBar.setAttribute('aria-label', 'Aksi pattern');
[['copy','Copy','Salin pattern'],['del','Delete','Hapus pattern'],['snap','Snap','Snap ke grid'],['edit','Edit','Buka piano roll'],['more','More...','Opsi lainnya']]
  .forEach(([act, txt, label], i) => {
    const b = document.createElement('button');
    b.className = 'pat-btn'; b.type = 'button'; b.dataset.act = act; b.textContent = txt;
    b.setAttribute('aria-label', label); b.style.setProperty('--i', i);
    if (act === 'snap') b.setAttribute('aria-pressed', 'true');
    if (act === 'more') b.setAttribute('aria-haspopup', 'menu');
    patBar.appendChild(b);
  });
lanesEl.appendChild(patBar);

let patAnchor = null;   // posisi klik di pattern (dalam bar); null = tengah bagian yang terlihat
const patObs = new MutationObserver(() => patBarPlace());   // ikut bergerak saat pattern digeser / di-resize / di-zoom
const recOn = () => document.documentElement.dataset.rec === 'on';   // Pengaturan > Record Mode
function patBarShow(el) {
  patObs.disconnect(); closePatMenu();
  if (!el || recOn()) { patBar.hidden = true; return; }   // Record Mode: menu bulat tidak muncul
  patObs.observe(el, {attributes: true, attributeFilter: ['style']});
  patBar.hidden = false; patBarPlace(); patBarPop();
}
function patBarPop() { patBar.classList.remove('is-open'); void patBar.offsetWidth; if (!REDUCE) patBar.classList.add('is-open'); }
function patBarPlace() {
  const el = selPat, lane = el && el.parentElement;
  if (!lane || patBar.hidden) return;
  const bw = patBar.offsetWidth, bh = patBar.offsetHeight || 46;
  const a = pl(el), b = a + pw(el);
  const v0 = wsEl.scrollLeft, v1 = wsEl.scrollLeft + wsEl.clientWidth - tlEl.offsetLeft;   // bagian timeline yang terlihat
  const i0 = Math.max(a, v0), i1 = Math.min(b, v1);
  patBar.style.visibility = i1 <= i0 ? 'hidden' : 'visible';
  const cx = patAnchor == null ? (i0 + i1) / 2 : Math.max(a, Math.min(b, a + patAnchor * BAR_W));   // di bawah/atas titik klik
  let left = cx - bw / 2;
  left = Math.max(v0 + 6, Math.min(left, v1 - bw - 6));
  left = Math.max(0, Math.min(left, W - bw));
  const above = lane.offsetTop - bh - 8;
  patBar.style.left = left + 'px';
  patBar.style.top = (above < 0 ? lane.offsetTop + lane.offsetHeight + 8 : above) + 'px';   // track paling atas: toolbar turun ke bawah pattern
}
wsEl.addEventListener('scroll', () => { patBarPlace(); if (!isProgScroll()) closePatMenu(); }, {passive: true});
// ===== Tempo audio clip: stretch (pitch tetap) supaya BPM clip mengikuti BPM project =====
// Menu Tempo (tahan icon microphone): isi BPM asli clip, mis. vokal 126 di project 130 -> audio dipercepat 126/130 tanpa mengubah nada.
// Hasil stretch = buffer baru (clip id baru); clip asli tetap disimpan (dataset.src) supaya stretch ulang selalu dari audio asli, bukan bertumpuk.
let stretchWorker = null, stretchSeq = 0;
const stretchJobs = new Map(), stretchCache = new Map();
function stretchWorkerGet() {
  if (stretchWorker) return stretchWorker;
  stretchWorker = new Worker(new URL('./stretch-worker.ts', import.meta.url), {type: 'module'});
  stretchWorker.onmessage = e => {
    const m = e.data, j = stretchJobs.get(m.id); if (!j) return;
    if (m.type === 'done') { stretchJobs.delete(m.id); j.ok(m.y); }
    else if (m.type === 'error') { stretchJobs.delete(m.id); j.err(new Error(m.msg)); }
  };
  stretchWorker.onerror = () => { stretchJobs.forEach(j => j.err(new Error('Pemrosesan audio gagal'))); stretchJobs.clear(); stretchWorker = null; };
  return stretchWorker;
}
function stretchClipBuffer(srcId, factor) {   // -> Promise<id buffer baru>
  const key = srcId + '|' + factor.toFixed(5);
  if (stretchCache.has(key)) return stretchCache.get(key);
  const buf = getBuffer(srcId);
  const chs = Array.from({length: buf.numberOfChannels}, (_, c) => buf.getChannelData(c).slice());
  const p = new Promise((ok, err) => {
    const id = ++stretchSeq; stretchJobs.set(id, {ok, err});
    stretchWorkerGet().postMessage({id, chs, sr: buf.sampleRate, factor}, chs.map(c => c.buffer));
  }).then(y => {
    const out = audio().createBuffer(y.length, y[0].length, buf.sampleRate);
    y.forEach((c, i) => out.copyToChannel(c, i));
    return addBuffer(out);
  });
  stretchCache.set(key, p); p.catch(() => stretchCache.delete(key));
  return p;
}
async function applyClipTempo(el, clipBpm) {
  if (!el.isConnected || !el.dataset.clip) throw new Error('Clip tidak ditemukan');
  const factor = clipBpm / BPM;   // durasi hasil / durasi asli
  if (factor < STRETCH_MIN || factor > STRETCH_MAX) throw new Error('Terlalu jauh dari project: pakai ' + Math.ceil(BPM * STRETCH_MIN) + '-' + Math.floor(BPM * STRETCH_MAX) + ' BPM');
  const curId = +el.dataset.clip, srcId = +(el.dataset.src || curId);
  const cur = getBuffer(curId), src = getBuffer(srcId);
  if (!cur || !src) throw new Error('Audio clip tidak ditemukan');
  const kPrev = cur.duration / src.duration;   // faktor yang sedang terpasang (1 = audio asli)
  let newId;
  try { newId = Math.abs(factor - 1) < 5e-4 ? srcId : await stretchClipBuffer(srcId, factor); }
  catch (err) { console.error(err); throw new Error('Gagal memproses audio'); }
  if (!el.isConnected) return;
  const r = getBuffer(newId).duration / src.duration / kPrev;   // perubahan panjang isi audio dibanding yang tampil sekarang
  const st = pl(el), off = (+el.dataset.off || 0) * r;
  const need = (st + pw(el) * r) / BAR_W;
  if (need > BARS) growTimeline(Math.min(MAX_BARS, Math.ceil(need) + 1));
  let hi = W; otherPats(el).forEach(o => { if (pl(o) > st + 1) hi = Math.min(hi, pl(o)); });
  const w = Math.max(Math.min(pw(el) * r, hi - st), Math.min(BAR_W / 2, hi - st));   // sama seperti ganti BPM: dipotong kalau menabrak clip berikutnya
  el.dataset.clip = newId; el.dataset.off = off; el.dataset.src = srcId; el.dataset.bpm = clipBpm;
  el.style.width = w + 'px'; handleSide(el);
  delete el.dataset.wk; syncWaves();   // waveform dari buffer baru
  if (el === selPat) patBarPlace();
  if (playing) scheduleClips();
  toast('Tempo ' + (Math.round(clipBpm * 100) / 100) + ' → ' + BPM + ' BPM');
}

// ===== Sync all sample (tahan icon piano pada pattern nada) =====
// Semua DERIZ yang bernada di pattern ini dikunci ke BPM project: kecepatan (knob Speed) tiap sample dicatat saat Sync dinyalakan
// (boleh beda-beda), lalu ikut berubah sebanding tiap BPM project diganti. Speed baru = Speed catatan x BPM sekarang / BPM saat sync.
// Knob Speed DERIZ terbatas 0.5x - 2x: di luar itu berhenti di batas.
const derizSpeedOf = v => 2 ** ((v - 0.5) * 2), derizSpeedKnob = sp => Math.max(0, Math.min(1, Math.log2(sp) / 2 + 0.5));
function patDerizList(el) {   // DERIZ yang menyala + berisi audio dan punya nada di pattern ini
  const prId = el.dataset.prId, lt = el.parentElement.dataset.track; if (!prId) return [];
  return fxRack.derizAll().filter(d => getPianoRollNotes(patKey(prId, d.id, lt)).length);
}
function unsyncPattern(el) { el._sync = null; delete el.dataset.sync; }
function toggleSyncSamples(el) {
  if (el._sync) { unsyncPattern(el); return toast('Sync all sample mati'); }
  const items = new Map();
  patDerizList(el).forEach(d => { const v = fxRack.getParam(d.track, d.id, 'speed'); if (v !== undefined) items.set(d.id, derizSpeedOf(v)); });
  if (!items.size) return toast('Belum ada DERIZ bernada di pattern ini');
  lanesEl.querySelectorAll('.pattern').forEach(o => {   // satu DERIZ hanya ikut satu pattern yang di-sync: yang lama dilepas
    if (o === el || !o._sync) return;
    items.forEach((_, id) => o._sync.items.delete(id));
    if (!o._sync.items.size) unsyncPattern(o);
  });
  el._sync = {bpm: BPM, items}; el.dataset.sync = '1';
  toast('Sync all sample: ' + items.size + ' DERIZ ikut BPM project');
}
function applySyncSamples() {
  let clamped = false;
  lanesEl.querySelectorAll('.pattern').forEach(el => {
    const sy = el._sync; if (!sy) return;
    sy.items.forEach((sp, id) => {
      const tr = fxRack.derizTrackOf(id);
      if (tr === undefined) { sy.items.delete(id); return; }   // DERIZ sudah dihapus
      const want = sp * BPM / sy.bpm, v = derizSpeedKnob(want);
      if (Math.abs(derizSpeedOf(v) - want) > 1e-4) clamped = true;
      fxRack.setParam(tr, id, 'speed', v);
    });
    if (!sy.items.size) unsyncPattern(el);
  });
  if (clamped) toast('Speed sample sudah di batas 0.5× - 2×');
}

// Tahan icon microphone pada audio clip -> card putih "Tempo"; menu bulat (copy, delete, dst) hilang selama card terbuka
let barHidByCard = false, barHideAnim = null;
initClipIconMenu(lanesEl, {
  onPatternMenu: el => toggleSyncSamples(el),
  isPatternSynced: el => !!el._sync,
  getProjectBpm: () => BPM,
  getClipBpm: el => el.dataset.bpm ? +el.dataset.bpm : null,
  applyTempo: (el, bpm) => applyClipTempo(el, bpm),
  onOpen() {
    closePatMenu();
    if (patBar.hidden) return;
    barHidByCard = true;
    if (REDUCE) { patBar.hidden = true; return; }
    barHideAnim = patBar.animate([{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.8)'}], {duration: 150, easing: 'ease-in', fill: 'forwards'});
    barHideAnim.onfinish = () => { if (barHidByCard) patBar.hidden = true; if (barHideAnim) barHideAnim.cancel(); barHideAnim = null; };
  },
  onClose() {
    if (!barHidByCard) return;
    barHidByCard = false;
    if (barHideAnim) { barHideAnim.cancel(); barHideAnim = null; }
    if (patBar.hidden && selPat) patBarShow(selPat);   // pattern masih terpilih: menu bulat muncul lagi
  }
});
window.addEventListener('resize', patBarPlace);

function shakeBar() { patBar.classList.remove('is-shake'); void patBar.offsetWidth; patBar.classList.add('is-shake'); }
const clipOf = (el, addSec) => el.dataset.clip ? {clip: +el.dataset.clip, off: (+el.dataset.off || 0) + addSec, src: el.dataset.src, bpm: el.dataset.bpm} : null;
const otherPats = el => [...el.parentElement.querySelectorAll('.pattern')].filter(p => p !== el);
function freeRightOf(el) {   // batas kanan terdekat sebelum pattern lain / ujung timeline
  const end = pl(el) + pw(el); let hi = W;
  otherPats(el).forEach(p => { if (pl(p) >= end - 1) hi = Math.min(hi, pl(p)); });
  return hi;
}
function copyPattern() {
  const el = selPat; if (!el) return;
  const lane = el.parentElement, w = pw(el);
  const spans = [...lane.querySelectorAll('.pattern')].map(p => ({s: pl(p), e: pl(p) + pw(p)})).sort((x, y) => x.s - y.s);
  let start = pl(el) + w;
  for (const p of spans) if (p.e > start && p.s < start + w) start = p.e;   // geser ke ruang kosong terdekat di kanan
  if (start + w > W + .5) return shakeBar();
  const n = createPattern(lane, {start, width: w}, clipOf(el, 0));
  n.querySelector('.pattern__title').textContent = el.querySelector('.pattern__title').textContent;
  if (el.dataset.prId) { n.dataset.prId = 'pat' + (++prSeq); copyPatNotes(el.dataset.prId, n.dataset.prId); renderPatNotes(n); }   // salinan ikut membawa nada
  if (el.dataset.auId) setupAutoEl(n, cloneClip(el.dataset.auId));   // salinan Automation Clip: kurva sama, diedit terpisah
  patAnchor = null; selectPattern(n);
  n.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
}
function deletePattern() {
  const el = selPat; if (!el) return;
  selectPattern(null);
  if (REDUCE) { el.remove(); return; }
  el.animate([{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.9)'}], {duration: 200, easing: EASE_OUT, fill: 'forwards'}).onfinish = () => el.remove();
}
// Tombol "Edit": pattern instrumen -> buka piano roll; pattern audio clip (tidak punya nada) -> tetap ganti nama seperti sebelumnya
let prSeq = 0, prStartBar = 0;   // prStartBar: posisi awal pattern yang sedang dibuka di piano roll (dalam bar), supaya playhead-nya relatif
let prEl = null;   // elemen pattern yang sedang dibuka di piano roll (target drag & drop DERIZ)
let prvTarget = null;   // instrumen yang dibunyikan piano roll saat nada ditambah / digeser: {track, fx}; fx = id DERIZ (null = DERIZ pertama track / Supersaw)
function editPattern() {
  const el = selPat; if (!el) return;
  if (el.dataset.auId) return openAutoEdit(el);   // Automation Clip: buka editor kurva
  if (el.dataset.clip) return renamePattern();
  openEdit(el);
}
// keepView = pindah dari VST lain lewat tahan nada di piano roll: zoom/scroll tetap, keyboard bawah ikut pindah
function openEdit(el, keepView = false) {
  if (!el.isConnected) return;
  const lane = el.parentElement, id = lane.dataset.track;
  const nm = document.getElementById('track-name-' + id);
  if (!el.dataset.prId) el.dataset.prId = 'pat' + (++prSeq);   // kunci supaya nada piano roll tersimpan per pattern
  if (isDrumsTrack(id)) { selectPattern(el); openDrums(); return; }   // track Drums: pola disusun di editor blok (step sequencer), bukan piano roll
  prStartBar = pl(el) / BAR_W; prEl = el;
  prvTarget = {track: id, fx: hasSynth(id) ? null : fxRack.derizIds(id)[0] ?? null};   // sama dengan pemilik editKey(el)
  openPianoRoll({
    id: editKey(el),
    ghosts: patGhosts(el, editKey(el)),
    track: nm ? nm.textContent : 'Track',
    pattern: el.querySelector('.pattern__title').textContent,
    color: lane.style.getPropertyValue('--track-color') || undefined,
    keepView,
  });
  if (keepView && kbdCont) { const cont = document.querySelector('.trkcard-wrap[data-track="' + id + '"]'); if (cont) openKbd(cont, hasSynth(id) ? null : fxRack.derizIds(id)[0] ?? null); }
  renderPlayhead();
}
// Masuk ke pattern dari tombol titik tiga di DERIZ: piano roll yang sama, tapi nadanya milik DERIZ ini (dimainkan lewat sampler DERIZ ini)
const trackColorOf = track => { const c = document.querySelector('.trkcard-wrap[data-track="' + track + '"]'); return (c && getComputedStyle(c).getPropertyValue('--track-color').trim()) || '#a66cff'; };
// nada instrumen lain di pattern yang sama (DERIZ lain di track mana pun + Supersaw milik track pattern): ditampilkan meredup di piano roll;
// ditahan = pindah ke VST pemiliknya (open), jadi tidak perlu keluar-masuk lewat titik tiga
function patGhosts(el, curKey) {
  const prId = el.dataset.prId, lt = el.parentElement.dataset.track, out = [];
  const add = (key, track, open) => { if (key !== curKey && !out.some(g => g.key === key)) out.push({key, color: trackColorOf(track), open}); };
  if (hasSynth(lt)) add(prId, lt, () => openEdit(el, true));
  document.querySelectorAll('.trkcard-wrap').forEach(c => fxRack.derizIds(c.dataset.track).forEach(id => add(patKey(prId, id, lt), c.dataset.track, () => enterPatternAs(el, id, true))));
  return out;
}
// tombol Edit: kunci nada instrumen track pemilik pattern (Supersaw = polos; DERIZ = DERIZ pertama yang ada di track itu)
function editKey(el) {
  const lt = el.parentElement.dataset.track, ids = hasSynth(lt) ? [] : fxRack.derizIds(lt);
  return ids.length ? patKey(el.dataset.prId, ids[0], lt) : el.dataset.prId;
}
function enterPatternAs(el, fxId, keepView = false) {
  if (!el.isConnected) return;
  const lane = el.parentElement, track = fxRack.derizTrackOf(fxId); if (track === undefined) return;
  if (!el.dataset.prId) el.dataset.prId = 'pat' + (++prSeq);
  const nm = document.getElementById('track-name-' + track), cont = document.querySelector('.trkcard-wrap[data-track="' + track + '"]');
  prStartBar = pl(el) / BAR_W; prEl = el;
  prvTarget = {track, fx: fxId};   // nada di piano roll ini milik DERIZ fxId
  openPianoRoll({
    id: patKey(el.dataset.prId, fxId, lane.dataset.track),
    ghosts: patGhosts(el, patKey(el.dataset.prId, fxId, lane.dataset.track)),
    track: (nm ? nm.textContent : 'Track') + (fxRack.derizIds(track).length > 1 ? ' · ' + fxRack.derizLabel(fxId) : ''),
    pattern: el.querySelector('.pattern__title').textContent,
    color: (cont && getComputedStyle(cont).getPropertyValue('--track-color').trim()) || undefined,
    keepView,
  });
  if (kbdCont && cont) openKbd(cont, fxId);   // keyboard di bawah ikut memainkan DERIZ ini
  renderPlayhead();
}
const patternBridge = {
  list(fxId) {
    const rows = [...lanesEl.querySelectorAll('.pattern:not([data-clip]):not([data-au-id])')].map(el => {
      const lane = el.parentElement, lt = lane.dataset.track, id = el.dataset.prId;
      const nm = document.getElementById('track-name-' + lt), cont = document.querySelector('.trkcard-wrap[data-track="' + lt + '"]');
      return {
        title: el.querySelector('.pattern__title').textContent || 'Pattern',
        trackName: nm ? nm.textContent : 'Track',
        color: (cont && getComputedStyle(cont).getPropertyValue('--track-color').trim()) || '#a66cff',
        bar: Math.round(pl(el) / BAR_W * 100) / 100 + 1,
        notes: id ? getPianoRollNotes(patKey(id, fxId, lt)).length : 0,
        ref: el, top: lane.offsetTop, left: pl(el)
      };
    });
    return rows.sort((a, b) => a.top - b.top || a.left - b.left);
  },
  open(row, fxId) { if (row.ref.isConnected) enterPatternAs(row.ref, fxId); },
  drop(fxId) {   // DERIZ di-drag & drop ke piano roll yang terbuka: piano roll pindah ke nada DERIZ ini, tampilan (zoom / scroll) tetap
    if (!isPianoRollOpen() || !prEl || !prEl.isConnected) return false;
    enterPatternAs(prEl, fxId, true); toast('DERIZ masuk ke piano roll'); return true;
  },
  removed(fxId, track, ownedPlain) {
    dropPianoRollNotesOf(String(fxId));
    if (ownedPlain) lanesEl.querySelectorAll('.pattern[data-pr-id]').forEach(p => { if (p.parentElement.dataset.track === track) clearPianoRollNotes(p.dataset.prId); });
  }
};
lanesEl.addEventListener('dblclick', e => {   // ganti nama pattern: klik dua kali judulnya
  const t = e.target.closest && e.target.closest('.pattern__title');
  if (t && selPat && selPat.contains(t)) renamePattern();
});
function renamePattern(target) {   // ubah nama pattern langsung di judulnya
  const el = target || selPat; if (!el) return;
  const t = el.querySelector('.pattern__title'), old = t.textContent;
  t.contentEditable = 'true'; t.spellcheck = false; t.focus();
  const rg = document.createRange(); rg.selectNodeContents(t);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  const end = save => {
    t.removeEventListener('blur', onBlur); t.removeEventListener('keydown', onKey);
    t.contentEditable = 'false';
    const v = t.textContent.trim().slice(0, 40);
    t.textContent = save && v ? v : old;
    getSelection().removeAllRanges();
  };
  const onBlur = () => end(true);
  const onKey = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); end(true); }
    else if (e.key === 'Escape') { e.preventDefault(); end(false); }
  };
  t.addEventListener('blur', onBlur); t.addEventListener('keydown', onKey);
}
function splitPattern() {
  const el = selPat; if (!el) return;
  const s0 = pl(el), w = pw(el), st = snapStep();
  let cut = snapOn ? Math.round((s0 + w / 2) / st) * st : s0 + w / 2;
  if (cut - s0 < st || s0 + w - cut < st) cut = s0 + w / 2;
  if (cut - s0 < 4 || s0 + w - cut < 4) return shakeBar();
  const n = createPattern(el.parentElement, {start: cut, width: s0 + w - cut}, clipOf(el, (cut - s0) / BAR_W * SEC_PER_BAR));
  n.querySelector('.pattern__title').textContent = el.querySelector('.pattern__title').textContent;
  if (el.dataset.prId) {   // nada ikut terbagi: kiri dipotong di titik bagi, kanan mulai dari titik itu
    const cb = (cut - s0) / BAR_W * 4;
    n.dataset.prId = 'pat' + (++prSeq); copyPatNotes(el.dataset.prId, n.dataset.prId, cb); trimPatNotes(el.dataset.prId, cb);
    renderPatNotes(el); renderPatNotes(n);
  }
  if (el.dataset.auId) setupAutoEl(n, splitClip(el.dataset.auId, (cut - s0) / BAR_W * 4));   // kurva ikut terbagi di titik potong
  el.style.width = (cut - s0) + 'px'; handleSide(el);
}
function doubleLength() {
  const el = selPat; if (!el) return;
  const s0 = pl(el), w = pw(el), nw = Math.min(w * 2, freeRightOf(el) - s0);
  if (nw <= w + 1) return shakeBar();
  if (!REDUCE) { el.classList.add('is-snapping'); setTimeout(() => el.classList.remove('is-snapping'), 300); }
  el.style.width = nw + 'px'; handleSide(el);
}

let patMenu = null;
function closePatMenu() {
  if (patMenu) { patMenu.remove(); patMenu = null; }
  const mb = patBar.querySelector('[data-act="more"]'); if (mb) mb.setAttribute('aria-expanded', 'false');
}
function openPatMenu(btn) {
  closeMenu(true); closeAddMenu(true);
  const m = document.createElement('div');
  m.className = 'track-menu pat-menu'; m.setAttribute('role', 'menu');
  [['Bagi dua', splitPattern], ['Gandakan panjang', doubleLength]].forEach(([txt, fn]) => {
    const it = document.createElement('button');
    it.className = 'track-menu__item'; it.type = 'button'; it.setAttribute('role', 'menuitem'); it.textContent = txt;
    it.addEventListener('click', () => { closePatMenu(); fn(); });
    m.appendChild(it);
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left + r.width / 2 - mw / 2, innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + 8 + mh > innerHeight - 8 ? r.top - 8 - mh : r.bottom + 8) + 'px';
  patMenu = m; btn.setAttribute('aria-expanded', 'true');
}
document.addEventListener('pointerdown', e => { if (patMenu && !patMenu.contains(e.target) && !e.target.closest('.pat-bar')) closePatMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && patMenu) closePatMenu(); });

patBar.addEventListener('click', e => {
  const b = e.target.closest('.pat-btn'); if (!b) return;
  switch (b.dataset.act) {
    case 'copy': copyPattern(); break;
    case 'del': deletePattern(); break;
    case 'snap': snapOn = !snapOn; b.setAttribute('aria-pressed', String(snapOn)); break;
    case 'edit': editPattern(); break;
    case 'more': patMenu ? closePatMenu() : openPatMenu(b); break;
  }
});


// ===== Automation Clip =====
// Putar knob efek (mis. Cutoff) -> titik tiga di transport -> "Create Automation Clip": clip baru di track Automation (satu lane per knob)
// dan editornya langsung terbuka. Saat Play, kurvanya menggerakkan knob itu (autoPump, ikut jadwal 25 ms milik metroPump).
const AUTO_COLOR = '#f97316';
const autoKey = t => t.track + ':' + t.fxId + ':' + t.key;
const autoLen = el => pw(el) / BAR_W * 4;   // panjang clip dalam ketukan
const autoRO = new ResizeObserver(es => es.forEach(en => { const el = en.target; if (el.isConnected && el.dataset.auId) renderMini(el, el.dataset.auId, autoLen(el)); }));
function setupAutoEl(el, id) {   // pattern biasa -> Automation Clip
  el.dataset.auId = id; el.classList.add('pattern--auto');
  const c = getClip(id); if (c && c.target) el.parentElement.dataset.auTarget = autoKey(c.target);   // lane ini milik knob tsb: clip berikutnya untuk knob yang sama masuk ke sini
  autoRO.observe(el);
  renderMini(el, id, autoLen(el));
}
function openAutoEdit(el) {
  const id = el.dataset.auId, c = getClip(id); if (!c || !el.isConnected) return;
  const t = c.target, info = t ? fxRack.paramInfo(t.track, t.fxId, t.key) : null;
  openAutoEditor({
    id, len: autoLen(el), title: el.querySelector('.pattern__title').textContent, color: AUTO_COLOR, info,
    onChange: () => { if (el.isConnected) renderMini(el, id, autoLen(el)); }
  });
}
function createAutomationClip() {
  if (DEMO) { demoNotice('automation'); return; }   // DEMO: Automation Clip hanya di versi penuh
  const t = fxRack.lastTouched(); if (!t) return;
  const info = fxRack.paramInfo(t.track, t.fxId, t.key); if (!info) return;
  const value = fxRack.getParam(t.track, t.fxId, t.key) ?? info.def, tag = autoKey(t), title = info.fxName + ' · ' + info.label;
  const x = Math.max(0, Math.min(posBars * BAR_W, W - BAR_W / 2));   // mulai dari playhead
  let lane = [...lanesEl.querySelectorAll('.lane')].find(l => l.dataset.auTarget === tag && slot(l, x)), sl = lane && slot(lane, x);
  if (!lane) {   // belum ada lane untuk knob ini (atau penuh di posisi itu): track Automation baru
    const src = document.querySelector('.trkcard-wrap[data-track="' + t.track + '"]');
    addTrack({n: 'Automation', c: AUTO_COLOR});
    const id = trackSeq;
    lane = lanesEl.querySelector('.lane[data-track="' + id + '"]');
    const cont = document.querySelector('.trkcard-wrap[data-track="' + id + '"]');
    document.getElementById('track-name-' + id).textContent = title;
    cont.querySelector('.trkcard__title-btn').title = title;
    cont.querySelector('input[type=range]').setAttribute('aria-label', 'Volume, ' + title);
    lane.dataset.auTarget = tag;
    sl = slot(lane, x) || slot(lane, 0);
    if (src) selectTrack(src);   // panel efek tetap di track asal: knob yang diotomasi tetap kelihatan
  }
  if (!sl) { toast('Tidak ada ruang kosong untuk Automation Clip'); return; }
  const el = createPattern(lane, sl);
  el.querySelector('.pattern__title').textContent = title;
  setupAutoEl(el, createClip({track: t.track, fxId: t.fxId, key: t.key}, value, sl.width / BAR_W * 4));
  selectPattern(null);
  el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
  setTimeout(() => openAutoEdit(el), REDUCE ? 0 : 280);   // langsung bisa diatur (menunggu animasi track baru)
}
// Saat main: tiap knob yang punya Automation Clip mengikuti kurva clip terakhir yang sudah dimulai (sesudah clip berakhir, nilai terakhirnya ditahan)
function autoPump(ctx) {
  if (ctx.currentTime < startCtx) return;   // masih count-in
  const pos = startPos + (ctx.currentTime - startCtx) / SEC_PER_BAR, best = new Map();
  lanesEl.querySelectorAll('.pattern[data-au-id]').forEach(el => {
    if (el.parentElement.classList.contains('is-off')) return;   // track Automation dimatikan
    const c = getClip(el.dataset.auId); if (!c || !c.target) return;
    const start = pl(el) / BAR_W; if (start > pos) return;
    const k = autoKey(c.target), b = best.get(k);
    if (!b || start > b.start) best.set(k, {el, t: c.target, start});
  });
  best.forEach(({el, t, start}) => {
    const v = valueAt(el.dataset.auId, Math.min((pos - start) * 4, autoLen(el)));
    if (v !== undefined) fxRack.setParam(t.track, t.fxId, t.key, v);
  });
}
lanesEl.addEventListener('dblclick', e => {   // klik dua kali badan Automation Clip: buka editor (judul tetap ganti nama)
  const el = e.target.closest && e.target.closest('.pattern--auto');
  if (el && !e.target.closest('.pattern__title, .pattern__handle')) { selectPattern(el); openAutoEdit(el); }
});

// ===== Keyboard virtual =====
const kbdEl = document.getElementById('kbd'), kbdKeys = document.getElementById('kbdKeys'), kbdTitle = document.getElementById('kbdTitle');
const kbdOctLabel = document.getElementById('kbdOctLabel'), kbdOctDown = document.getElementById('kbdOctDown'), kbdOctUp = document.getElementById('kbdOctUp');
const IVKD = ivkDock();   // markup tuts A-1..C7 dibangun ivory-keys.ts (posisi px dihitung kode)
const KEY_W = 68, WK = 66, BK = 44, OCT_W = 7 * KEY_W, KB_C0 = IVKD.c0, KB_END = IVKD.width;
const KSEL = '.ivk__w, .ivk__b';
// tombol komputer -> semitone dari C di oktaf dasar (susunan ZXCVBNM,. dan QWERTYUIOP)
const KMAP = {z:0,s:1,x:2,d:3,c:4,v:5,g:6,b:7,h:8,n:9,j:10,m:11,',':12,l:13,'.':14,'1':15,q:16,w:17,'3':18,e:19,'4':20,r:21,'5':22,t:23,y:24,'7':25,u:26,'8':27,i:28,o:29,'0':30,p:31};
let kbdCont = null, kbdOct = 3, kbdN = 0;
const baseMidi = () => 12 + 12 * kbdOct;   // C3 = 48 (C4 = 60 = middle C)

// --- suara (WebAudio, polifonik) ---
let actx = null, master = null, guardOut = null, loudDry = null, loudWet = null; const voices = new Map();
function applyLoud(now) {   // Pengaturan > Master Loudness: nyala = lewat compressor + limiter, mati = jalur kering
  if (!loudDry) return;
  const on = document.documentElement.dataset.loud !== 'off', t = actx.currentTime;
  if (now) { loudWet.gain.value = on ? 1 : 0; loudDry.gain.value = on ? 0 : 1; return; }
  loudWet.gain.setTargetAtTime(on ? 1 : 0, t, 0.01); loudDry.gain.setTargetAtTime(on ? 0 : 1, t, 0.01);
}
document.addEventListener('loudchange', () => applyLoud(false));
function audio() {
  if (!actx) {
    // latencyHint 'playback': buffer keluaran lebih besar, jadi lonjakan beban sesaat (banyak VST / reverb) tidak langsung jadi gresek.
    // Kualitas suara tidak berubah; harganya jeda (latency) sedikit lebih besar. Browser yang tidak mendukung mengabaikan opsi ini.
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    master = actx.createGain(); master.gain.value = 1;   // gain master tetap 1.0; pemadatan suara ada di rantai Master Loudness di bawah
    // Pengaman clipping: lurus sempurna sampai 0.9 (suara asli tidak tersentuh), di atasnya melengkung halus menuju 1.0 (sama dengan limiter lembut
    // tiap plugin DERIZ). Banyak track dijumlah bisa melewati 1.0 dan jadi kresek karena terpotong keras di output; ini menggantinya dengan lengkung halus.
    // Pra-gain 1/4 supaya lengkung menjangkau sampai +-4.0 sebelum terpotong. Tanpa oversampling dan tanpa latency.
    const guardPre = actx.createGain(), guard = actx.createWaveShaper(), GN = 4097, GR = 4, curve = new Float32Array(GN);
    guardPre.gain.value = 1 / GR;
    for (let i = 0; i < GN; i++) { const x = (i / (GN - 1) * 2 - 1) * GR, ax = Math.abs(x); curve[i] = Math.sign(x) * (ax <= 0.9 ? ax : 0.9 + 0.1 * Math.tanh((ax - 0.9) / 0.1)); }
    guard.curve = curve; guard.oversample = 'none';
    // Master Loudness (Pengaturan, bawaan NYALA): rantai "finishing" supaya output tidak mentah / datar. Urutan:
    //  1) high-pass 28 Hz: buang rumble/DC yang cuma memakan headroom
    //  2) tone EQ halus: low shelf +1.5 dB @ 90 Hz (bobot), peaking -1.5 dB @ 320 Hz (kurangi boxy), +1.2 dB @ 3.2 kHz (presence), high shelf +2 dB @ 10 kHz (air)
    //  3) exciter saturasi paralel: hanya komponen harmonik (residu tanh) di atas 180 Hz dicampur 35%. Fundamental tidak berubah, bagian keras mendapat harmonik,
    //     bagian pelan nyaris bersih, jadi suara terasa "hidup" dan hangat tanpa jadi kotor
    //  4) glue compressor (threshold -22 dB, rasio 2.5:1, knee 14, attack 30 ms supaya transient tetap lewat, release 200 ms). Makeup gain otomatis bawaan node
    //  5) stereo width M/S: side +15%, side di bawah 140 Hz dibuang (bass tetap mono dan fokus)
    //  6) limiter (threshold -1.5 dB, rasio 20:1). Pengaman clipping di bawah tetap jadi penjaga terakhir.
    // Dimatikan = jalur kering (master langsung ke pengaman). Export merekam dari guardOut, jadi hasil export ikut sama dengan yang terdengar.
    const bq = (type, f, g, q) => { const b = actx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (g !== undefined) b.gain.value = g; if (q !== undefined) b.Q.value = q; return b; };
    const hp = bq('highpass', 28, undefined, 0.707);
    const eLow = bq('lowshelf', 90, 1.5), eBox = bq('peaking', 320, -1.5, 0.9), ePres = bq('peaking', 3200, 1.2, 0.8), eAir = bq('highshelf', 10000, 2);
    const sum = actx.createGain(), satHp = bq('highpass', 180, undefined, 0.707), sat = actx.createWaveShaper(), satG = actx.createGain();
    const SN = 2049, SD = 3, sc = new Float32Array(SN);
    for (let i = 0; i < SN; i++) { const x = i / (SN - 1) * 2 - 1; sc[i] = Math.tanh(x * SD) / SD - x; }   // hanya residu nonlinear (harmonik); tanpa fundamental
    sat.curve = sc; sat.oversample = '2x'; satG.gain.value = 0.35;
    const glue = actx.createDynamicsCompressor(), lim = actx.createDynamicsCompressor();
    glue.threshold.value = -22; glue.knee.value = 14; glue.ratio.value = 2.5; glue.attack.value = 0.03; glue.release.value = 0.2;
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    const sp = actx.createChannelSplitter(2), mg = actx.createChannelMerger(2);
    const mid = actx.createGain(), sideA = actx.createGain(), sideB = actx.createGain(), sideHp = bq('highpass', 140, undefined, 0.707), sideW = actx.createGain(), sideN = actx.createGain();
    mid.gain.value = 0.5; sideA.gain.value = 0.5; sideB.gain.value = -0.5; sideW.gain.value = 1.15; sideN.gain.value = -1;
    loudDry = actx.createGain(); loudWet = actx.createGain();
    master.connect(loudDry); loudDry.connect(guardPre);
    master.connect(hp); hp.connect(eLow); eLow.connect(eBox); eBox.connect(ePres); ePres.connect(eAir);
    eAir.connect(sum); eAir.connect(satHp); satHp.connect(sat); sat.connect(satG); satG.connect(sum);
    sum.connect(glue); glue.connect(sp);
    sp.connect(mid, 0); sp.connect(mid, 1); sp.connect(sideA, 0); sp.connect(sideB, 1);
    sideA.connect(sideHp); sideB.connect(sideHp); sideHp.connect(sideW); sideW.connect(sideN);
    mid.connect(mg, 0, 0); sideW.connect(mg, 0, 0); mid.connect(mg, 0, 1); sideN.connect(mg, 0, 1);
    mg.connect(lim); lim.connect(loudWet); loudWet.connect(guardPre);
    applyLoud(true);
    guardPre.connect(guard); guard.connect(actx.destination); guardOut = guard;   // guardOut: titik rekam export audio (sama dengan yang sampai ke speaker)
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function noteOn(m) {
  if (voices.has(m)) return;
  const tid = kbdCont && kbdCont.dataset.track;
  if (tid && hasSynth(tid)) {   // track synth (Supersaw): suara dari plugin-nya, melewati efek track
    const ctx = audio();
    voices.set(m, {synth: startVoice(ctx, master, tid, m, ctx.currentTime)});
    return;
  }
  if (tid && fxRack.hasDeriz(tid)) {   // track DERIZ: suara dari sampler-nya (audio yang di-upload), melewati efek track
    audio();
    voices.set(m, {deriz: fxRack.derizOn(tid, m, kbdFx ?? undefined)});
    return;
  }
  const ctx = audio(), t = ctx.currentTime, f = 440 * 2 ** ((m - 69) / 12);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), g2 = ctx.createGain();
  o1.type = 'triangle'; o1.frequency.value = f;
  o2.type = 'sine'; o2.frequency.value = f * 2; g2.gain.value = .25;
  lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 8);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.36, t + .012); g.gain.setTargetAtTime(.16, t + .02, .35);
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
  o1.start(t); o2.start(t);
  voices.set(m, {o1, o2, g});
}
function noteOff(m) {
  const v = voices.get(m); if (!v) return;
  voices.delete(m);
  const t = actx.currentTime;
  if ('synth' in v) { releaseVoice(v.synth, t); return; }
  if ('deriz' in v) { fxRack.derizOff(v.deriz); return; }
  v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.setTargetAtTime(0, t, .07);
  v.o1.stop(t + .5); v.o2.stop(t + .5);
}
const keyElOf = m => kbdKeys.querySelector('[data-midi="' + m + '"]');
function press(m) { noteOn(m); const k = keyElOf(m); if (k) k.classList.add('is-down'); }
function release(m) { noteOff(m); const k = keyElOf(m); if (k) k.classList.remove('is-down'); }
function releaseAll() { [...voices.keys()].forEach(release); pointerNotes.clear(); kbdDown.clear(); }

// --- preview piano roll: nada yang ditambah / digeser langsung bunyi lewat instrumen pemilik piano roll (DERIZ = sample-nya, Supersaw = synth-nya) ---
// Terpisah dari keyboard bawah (tidak butuh dock terbuka) dan tidak ikut menyalakan tuts di keyboard.
const prvVoices = new Map();   // midi -> {synth} | {deriz}
setPianoRollPreviewHandler({
  on(m) {
    const t = prvTarget; if (!t || prvVoices.has(m)) return;
    if (hasSynth(t.track)) { const ctx = audio(); prvVoices.set(m, {synth: startVoice(ctx, master, t.track, m, ctx.currentTime)}); }
    else if (fxRack.hasDeriz(t.track)) { audio(); prvVoices.set(m, {deriz: fxRack.derizOn(t.track, m, t.fx ?? undefined)}); }
  },
  off(m) {
    const v = prvVoices.get(m); if (!v) return;
    prvVoices.delete(m);
    if ('synth' in v) releaseVoice(v.synth, actx.currentTime); else fxRack.derizOff(v.deriz);
  }
});

// --- tuts: markup dibangun ivory-keys.ts; oktaf = geser translateX, tuts di luar jendela dinonaktifkan ---
const kbdScroll = kbdKeys.querySelector('.ivk__scroll');
kbdKeys.querySelector('.ivk__keys').innerHTML = IVKD.html;
kbdScroll.style.width = IVKD.width + 'px';
const keyBtns = [...kbdKeys.querySelectorAll(KSEL)].map(el => ({el, left: parseFloat(el.style.left), w: el.classList.contains('ivk__b') ? BK : WK}));
const whitesFit = () => Math.max(7, Math.floor(kbdEl.clientWidth / KEY_W) || Math.floor(innerWidth / KEY_W));
function buildKeys(instant) {
  const nW = whitesFit(), W = nW * KEY_W - 2, maxOct = Math.max(0, Math.floor((KB_END - KB_C0 - W) / OCT_W));
  kbdOct = Math.max(0, Math.min(kbdOct, maxOct)); kbdN = nW;
  releaseAll();
  if (instant) kbdKeys.classList.add('no-anim');
  const off = KB_C0 + OCT_W * kbdOct;
  kbdKeys.style.width = W + 'px';
  kbdScroll.style.transform = 'translateX(' + (-off) + 'px)';
  keyBtns.forEach(k => {
    const vis = k.left >= off && k.left + k.w <= off + W;
    k.el.disabled = !vis; k.el.setAttribute('aria-hidden', String(!vis));
  });
  if (instant) { kbdKeys.offsetWidth; kbdKeys.classList.remove('no-anim'); }
  kbdOctLabel.textContent = 'C' + kbdOct;
  ivkSetCaps(kbdKeys, baseMidi(), KMAP);   // huruf tombol komputer di tuts mengikuti oktaf
  kbdOctDown.disabled = kbdOct <= 0; kbdOctUp.disabled = kbdOct >= maxOct;
}

// --- mouse / sentuh (bisa geser jari antar tuts) ---
const pointerNotes = new Map();
const keyAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(KSEL) : null; };
kbdKeys.addEventListener('pointerdown', e => {
  const k = e.target.closest(KSEL); if (!k || e.button > 0) return;
  e.preventDefault(); kbdKeys.setPointerCapture(e.pointerId);
  const m = +k.dataset.midi; pointerNotes.set(e.pointerId, m); press(m);
});
kbdKeys.addEventListener('pointermove', e => {
  if (!pointerNotes.has(e.pointerId)) return;
  const k = keyAt(e.clientX, e.clientY); if (!k) return;
  const m = +k.dataset.midi, cur = pointerNotes.get(e.pointerId);
  if (m !== cur) { release(cur); pointerNotes.set(e.pointerId, m); press(m); }
});
const upPtr = e => { const m = pointerNotes.get(e.pointerId); if (m != null) { pointerNotes.delete(e.pointerId); release(m); } };
kbdKeys.addEventListener('pointerup', upPtr); kbdKeys.addEventListener('pointercancel', upPtr);

// --- tombol komputer ---
const kbdDown = new Map();   // e.key -> midi (supaya pelepasan tetap benar walau oktaf berganti)
const typing = t => t && (t.isContentEditable || t.matches && t.matches('textarea, input:not([type="range"])'));
document.addEventListener('keydown', e => {
  if (!kbdEl.classList.contains('is-open') || dockCollapsed() || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  const k = e.key.toLowerCase();
  if (!(k in KMAP)) return;
  e.preventDefault();
  if (e.repeat || kbdDown.has(k)) return;
  const m = baseMidi() + KMAP[k]; kbdDown.set(k, m); press(m);
});
document.addEventListener('keyup', e => { const k = e.key.toLowerCase(), m = kbdDown.get(k); if (m != null) { kbdDown.delete(k); release(m); } });
window.addEventListener('blur', releaseAll);

// --- buka / tutup ---
let kbdFx = null;   // DERIZ tertentu yang dimainkan keyboard (null = DERIZ pertama track)
function openKbd(cont, fxId = null) {
  kbdFx = fxId;
  const nm = document.getElementById('track-name-' + cont.dataset.track);
  kbdTitle.textContent = 'Keyboard · ' + (nm ? nm.textContent : 'Track');
  const cs = getComputedStyle(cont).getPropertyValue('--track-color').trim() || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  kbdEl.style.setProperty('--kc', cs);
  const wasOpen = kbdEl.classList.contains('is-open');
  kbdCont = cont;
  kbdEl.classList.add('is-open');
  if (!dockCollapsed()) { kbdEl.removeAttribute('inert'); kbdEl.setAttribute('aria-hidden', 'false'); }
  if (!wasOpen) { buildKeys(true); setTimeout(() => cont.isConnected && cont.scrollIntoView({block: 'nearest', behavior: 'smooth'}), 400); }
  syncKbdToggle();
}
function closeKbd() {
  releaseAll(); kbdCont = null; kbdFx = null;
  kbdEl.classList.remove('is-open'); kbdEl.setAttribute('inert', ''); kbdEl.setAttribute('aria-hidden', 'true');
  syncKbdToggle();
}
// ===== Panel bawah (card transport + keyboard) =====
// - Panah di kanan card: menutup SELURUH panel bawah (hanya panah yang tersisa); ditekan lagi untuk membukanya.
// - Seret card transport ke atas / bawah: mengatur tinggi keyboard (di bawah ambang tertentu keyboard menutup sendiri).
const kbdToggle = document.getElementById('kbdToggle');
const dockBar = document.getElementById('dockBar'), dockClip = document.getElementById('dockClip'), dockCard = document.getElementById('dockCard');
const kbdInner = kbdEl.querySelector('.kbd__inner');
const dockCollapsed = () => dockBar.classList.contains('is-collapsed');
function syncKbdToggle() {
  const open = !dockCollapsed(), t = open ? 'Tutup panel bawah' : 'Buka panel bawah';
  kbdToggle.setAttribute('aria-expanded', String(open));
  kbdToggle.setAttribute('aria-label', t); kbdToggle.title = t;
}
function setDock(open) {
  dockBar.classList.toggle('is-collapsed', !open);
  document.documentElement.classList.toggle('dock-collapsed', !open);
  dockClip.toggleAttribute('inert', !open);   // card tersembunyi: tombolnya tidak bisa difokus / ditekan
  if (!open) { releaseAll(); kbdEl.setAttribute('inert', ''); kbdEl.setAttribute('aria-hidden', 'true'); }
  else if (kbdEl.classList.contains('is-open')) { kbdEl.removeAttribute('inert'); kbdEl.setAttribute('aria-hidden', 'false'); }
  syncKbdToggle();
}
kbdToggle.addEventListener('click', () => setDock(dockCollapsed()));

// tinggi keyboard = bar 44px + tuts + 12px; tuts tidak ikut mengecil saat ditarik (hanya terpotong seperti laci)
const KBD_BAR = 44, KBD_PAD = 12, KBD_MIN = 120, KBD_SNAP_CLOSE = 80;
const kbdMaxH = () => Math.max(KBD_MIN, Math.min(380, Math.round(window.innerHeight * 0.55)));
function setKbdHeight(h) {
  const kh = Math.max(Math.round(h) - KBD_BAR - KBD_PAD, 60), rs = document.documentElement.style;
  rs.setProperty('--kbd-h', Math.round(h) + 'px');
  rs.setProperty('--kh', kh + 'px');
  rs.setProperty('--bh', Math.round(kh * 0.613) + 'px');
}
function openKbdForSelected() {
  const cont = (selTrack && selTrack.closest('.trkcard-wrap')) || document.querySelector('.trkcard-wrap');
  if (cont) openKbd(cont);   // keyboard memainkan track yang sedang dipilih
  return !!cont;
}
let dockDrag = null;
// listener gerak dipasang di window selama jari / mouse menekan card, supaya seretan cepat yang keluar dari card tetap terbaca
dockCard.addEventListener('pointerdown', e => {
  if ((e.pointerType === 'mouse' && e.button !== 0) || dockDrag) return;
  const h0 = kbdEl.classList.contains('is-open') ? kbdInner.offsetHeight : 0;
  dockDrag = {id: e.pointerId, y0: e.clientY, h0, h: h0, moved: false};
  window.addEventListener('pointermove', onDockMove);
  window.addEventListener('pointerup', endDockDrag);
  window.addEventListener('pointercancel', endDockDrag);
});
function onDockMove(e) {
  const d = dockDrag; if (!d || e.pointerId !== d.id) return;
  const dy = d.y0 - e.clientY;
  if (!d.moved) {
    if (Math.abs(dy) < 8) return;   // di bawah 8px dianggap ketukan biasa (tombol tetap bisa ditekan)
    if (!kbdEl.classList.contains('is-open')) {
      kbdEl.classList.add('is-dragging'); setKbdHeight(0);
      if (!openKbdForSelected()) { kbdEl.classList.remove('is-dragging'); stopDockListeners(); dockDrag = null; return; }
    }
    d.moved = true;
    kbdEl.classList.add('is-dragging');
    document.documentElement.classList.add('is-dock-dragging');
  }
  d.h = Math.max(0, Math.min(kbdMaxH(), d.h0 + dy));
  setKbdHeight(d.h);
}
function stopDockListeners() {
  window.removeEventListener('pointermove', onDockMove);
  window.removeEventListener('pointerup', endDockDrag);
  window.removeEventListener('pointercancel', endDockDrag);
}
function endDockDrag(e) {
  const d = dockDrag; if (!d || e.pointerId !== d.id) return;
  dockDrag = null; stopDockListeners();
  if (!d.moved) return;
  const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };   // seretan tidak boleh ikut menekan tombol di bawah jari
  window.addEventListener('click', stop, {capture: true, once: true});
  setTimeout(() => window.removeEventListener('click', stop, true), 60);
  document.documentElement.classList.remove('is-dock-dragging');
  kbdEl.classList.remove('is-dragging');
  if (d.h < KBD_SNAP_CLOSE) closeKbd();
  else setKbdHeight(Math.max(d.h, KBD_MIN));
}
window.addEventListener('resize', () => { if (kbdEl.classList.contains('is-open') && kbdInner.offsetHeight > kbdMaxH()) setKbdHeight(kbdMaxH()); });
kbdOctDown.addEventListener('click', () => { kbdOct--; buildKeys(); });
kbdOctUp.addEventListener('click', () => { kbdOct++; buildKeys(); });
window.addEventListener('resize', () => { if (kbdEl.classList.contains('is-open') && whitesFit() !== kbdN) buildKeys(); });

initRec(document); initSliders(document); initKnobs(document); initMore(document);

// ===== Pilih track: klik card atau lane-nya (tidak membuka keyboard), efek glass hanya di track yang dipilih =====
let selTrack = document.querySelector('.trkcard--on');
// Record Mode: semua lane di timeline di-blur kecuali lane track yang dipilih
// Blur baru aktif saat ADA PATTERN TERPILIH (default Record Mode tanpa blur); yang tetap jelas = lane track pattern itu
function syncRecFocus() {
  const on = recOn() && !!selPat;
  const id = selPat && selPat.parentElement ? selPat.parentElement.dataset.track : null;
  lanesEl.querySelectorAll('.lane').forEach(l => l.classList.toggle('is-rec-dim', on && id != null && l.dataset.track !== id));
}
document.addEventListener('recmodechange', () => { patBarShow(selPat); syncRecFocus(); });
new MutationObserver(syncRecFocus).observe(lanesEl, {childList: true});   // track baru / dihapus ikut disesuaikan
syncRecFocus();
function selectTrack(cont) {
  const th = cont && cont.querySelector('.trkcard');
  if (!th || selTrack === th) return;
  if (selTrack) selTrack.classList.remove('trkcard--on');
  selTrack = th; th.classList.add('trkcard--on');
  syncRecFocus();
  fxRack.show(cont.dataset.track);   // panel efek ikut pindah ke track terpilih
  if (kbdEl.classList.contains('is-open')) openKbd(cont);   // keyboard yang sudah terbuka ikut pindah ke track terpilih
}
initPatternJelly(lanesEl);   // Record Mode: card pattern (kotak ungu di timeline) tahan -> bisa dibawa bebas + jelly
initRecordJelly(document.querySelector('.headers-list'), document.querySelector('.workspace'));   // Record Mode: card track terpilih bisa digoyang (drag + kenyal + rotasi)
initTrackReorder(document.querySelector('.headers-list'), lanesEl, document.querySelector('.workspace'), () => { patBarPlace(); });   // tahan + geser icon channel mixer: pindah urutan track (card + lane), semua mode
document.querySelector('.headers-list').addEventListener('pointerdown', e => {
  const c = e.target.closest('.trkcard-wrap');
  if (c) selectTrack(c);
});
lanesEl.addEventListener('pointerdown', e => {
  const l = e.target.closest('.lane');
  if (l) {
    const hc = document.querySelector('.trkcard-wrap[data-track="' + l.dataset.track + '"]');
    selectTrack(hc);
  }
});

// ===== Buka / tutup panel track: klik icon instrumen di track mana saja, atau tombol panah di atas =====
const tlistEl = document.querySelector('.tracklist'), panelToggle = document.getElementById('panelToggle');
// Animasi buka/tutup dijalankan lewat transform di compositor (tanpa layout ulang timeline tiap frame):
// tata letak langsung ke posisi akhir, lalu timeline "digeser balik" dengan translateX yang menyusut ke 0,
// sementara lebar kolom track dianimasikan terpisah (isinya hanya beberapa card, jadi ringan).
const PANEL_MS = 380;
let panelAnims = [];
function setPanel(collapsed) {
  const w0 = tlistEl.offsetWidth;                          // lebar yang sedang tampil (juga benar kalau animasi sebelumnya belum selesai)
  panelAnims.forEach(a => a.cancel()); panelAnims = [];
  tlistEl.classList.toggle('tracklist--collapsed', collapsed);
  const t = collapsed ? 'Buka panel track' : 'Tutup panel track';
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.setAttribute('aria-label', t); panelToggle.title = t;
  document.querySelectorAll('.trkcard__lead').forEach(b => b.title = t);
  closeMenu(true); closeAddMenu(true); dismissAdd(true);
  const w1 = tlistEl.offsetWidth;                          // lebar akhir (CSS tidak lagi punya transisi width)
  if (!REDUCE && w0 !== w1 && tlistEl.animate) {
    const o = {duration: PANEL_MS, easing: EASE_OUT};
    panelAnims = [
      // margin-right menjaga "jejak" kolom di layout tetap w1 selama lebarnya bergerak w0 → w1
      tlistEl.animate([{width: w0 + 'px', marginRight: (w1 - w0) + 'px'}, {width: w1 + 'px', marginRight: '0px'}], o),
      tlEl.animate([{transform: 'translate3d(' + (w0 - w1) + 'px,0,0)'}, {transform: 'translate3d(0,0,0)'}], o)
    ];
  }
  // posisi layout timeline sudah final sejak awal: ruler & toolbar pattern cukup disesuaikan sekali
  paintRuler(); patBarPlace();   // tanpa force: kanvas ruler sudah menutup area di luar layar (margin 1 layar), tidak perlu digambar ulang
}
const panelCollapsed = () => tlistEl.classList.contains('tracklist--collapsed');
panelToggle.addEventListener('click', () => setPanel(!panelCollapsed()));
document.querySelector('.headers-list').addEventListener('click', e => {
  if (e.target.closest('.trkcard__lead')) setPanel(!panelCollapsed());
});
document.querySelectorAll('.trkcard__lead').forEach(b => b.title = 'Tutup panel track');
// Panel efek (kanan): lebar timeline berubah selama animasi, jadi ruler & toolbar pattern digambar ulang tiap frame
const fxRack = initFxRack(() => ({ ctx: audio(), dest: master }), patternBridge);   // isi panel efek: tombol +, card pilihan efek, dan card tiap efek (per track)
initEffectsPanel(settled => { paintRuler(settled); patBarPlace(); }, () => { closeMenu(true); closeAddMenu(true); dismissAdd(true); fxRack.closePicker(true); });
fxRack.show(selTrack ? selTrack.closest('.trkcard-wrap').dataset.track : null);
// MGCHORD: kirim nada hasil progression ke pattern yang sedang dipilih di timeline (pattern dilebarkan kalau muat, nada lama diganti)
setMgchordBridge({
  bpm: () => BPM,
  send(notes, beats) {
    const el = selPat && selPat.isConnected ? selPat : (lastPat && lastPat.isConnected ? lastPat : null);
    if (!el) return 'Pilih dulu sebuah pattern di timeline';
    if (el.dataset.clip || el.dataset.auId) return 'Pattern ini bukan pattern nada';
    const lane = el.parentElement, lt = lane.dataset.track;
    if (!el.dataset.prId) el.dataset.prId = 'pat' + (++prSeq);
    const need = beats / 4 * BAR_W, left = pl(el);
    let room = W - left;   // lebarkan pattern sampai muat, tapi jangan menabrak pattern berikutnya di lane yang sama
    lane.querySelectorAll('.pattern').forEach(o => { if (o !== el && pl(o) > left + 1 && pl(o) - left < room) room = pl(o) - left; });
    if (pw(el) < need) el.style.width = Math.min(need, room) + 'px';
    const fit = pw(el) / BAR_W * 4;
    if (isPianoRollOpen()) closePianoRoll();   // supaya piano roll tidak menyimpan nada lama
    const key = editKey(el);
    setPianoRollNotes(key, notes.filter(n => n.s < fit - 1e-6).map(n => ({p: Math.max(24, Math.min(108, n.p)), s: n.s, l: Math.min(n.l, fit - n.s), ...(n.v < 1 ? {v: Math.round(n.v * 1000) / 1000} : {})})));
    renderPatNotes(el); patBarPlace();
    if (fit < beats - 1e-6) return 'Terkirim, tapi pattern kurang panjang (' + Math.floor(fit / 4) + ' bar). Panjangkan pattern untuk sisanya';
    if (!hasSynth(lt) && !fxRack.derizIds(lt).length) return 'Terkirim ke pattern, tapi track ini belum punya instrumen (pakai track Supersaw)';
    return null;
  },
  // nada dilepas di atas sebuah track: pattern baru dibuat di bar tempat dilepas (bagian kosong), panjangnya mengikuti progression selama muat
  drop(notes, beats, lane, cx) {
    if (!lane || !lane.isConnected) return {ok: false, msg: 'Lepas di atas sebuah track di timeline'};
    const lt = lane.dataset.track, cont = document.querySelector('.trkcard-wrap[data-track="' + lt + '"]');
    if (!cont || cont.dataset.ins === 'Audio clip' || cont.dataset.ins === 'Automation' || lane.dataset.auTarget) return {ok: false, msg: 'Track ini bukan track nada. Lepas di track instrumen'};
    const x = cx - lane.getBoundingClientRect().left, pats = [...lane.querySelectorAll('.pattern')];
    if (pats.some(p => pl(p) <= x && x < pl(p) + pw(p))) return {ok: false, msg: 'Lepas di bagian kosong track, bukan di atas pattern lain'};
    let start = Math.floor(Math.max(0, x) / BAR_W) * BAR_W;
    for (const p of pats) if (pl(p) + pw(p) > start && pl(p) <= x) start = pl(p) + pw(p);
    let end = Math.min(start + beats / 4 * BAR_W, W);
    for (const p of pats) if (pl(p) >= start && pl(p) < end) end = pl(p);   // jangan menabrak pattern berikutnya
    if (end - start < BAR_W / 2) return {ok: false, msg: 'Tidak ada ruang kosong di sini. Coba lepas di bar lain'};
    const el = createPattern(lane, {start, width: end - start});
    el.dataset.prId = 'pat' + (++prSeq);
    const fit = (end - start) / BAR_W * 4;
    setPianoRollNotes(editKey(el), notes.filter(n => n.s < fit - 1e-6).map(n => ({p: Math.max(24, Math.min(108, n.p)), s: n.s, l: Math.min(n.l, fit - n.s), ...(n.v < 1 ? {v: Math.round(n.v * 1000) / 1000} : {})})));
    renderPatNotes(el); patBarPlace(); selectPattern(el);
    el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
    let msg = 'Chord ditambahkan ke ' + document.getElementById('track-name-' + lt).textContent;
    if (fit < beats - 1e-6) msg += ' (pattern ' + Math.floor(fit / 4) + ' bar, panjangkan untuk sisanya)';
    else if (!hasSynth(lt) && !fxRack.derizIds(lt).length) msg += ' (track ini belum punya instrumen)';
    toast(msg);
    return {ok: true, msg};
  }
});
// Drums: step sequencer membaca / menulis nada pattern yang sedang dipilih di timeline (track harus punya plugin Drums)
{
  const drumsPat = () => { const el = selPat && selPat.isConnected ? selPat : (lastPat && lastPat.isConnected ? lastPat : null); return el && !el.dataset.clip && !el.dataset.auId && isDrumsTrack(el.parentElement.dataset.track) ? el : null; };
  setDrumsBridge({
    get() {
      const el = selPat && selPat.isConnected ? selPat : (lastPat && lastPat.isConnected ? lastPat : null);
      if (!el) return 'Pilih dulu sebuah pattern di track Drums di timeline.';
      if (el.dataset.clip || el.dataset.auId) return 'Pattern ini bukan pattern nada. Pilih pattern di track Drums.';
      const lt = el.parentElement.dataset.track;
      if (!isDrumsTrack(lt)) return 'Pattern ini bukan milik track Drums. Pilih pattern di track yang punya plugin Drums.';
      if (!el.dataset.prId) el.dataset.prId = 'pat' + (++prSeq);
      return {notes: getPianoRollNotes(editKey(el)).map(n => ({p: n.p, s: n.s, l: n.l, ...(n.v !== undefined ? {v: n.v} : {})})), beats: pw(el) / BAR_W * 4, label: document.getElementById('track-name-' + lt).textContent};
    },
    set(notes) {
      const el = drumsPat(); if (!el) return;
      if (isPianoRollOpen()) closePianoRoll();   // supaya piano roll tidak menyimpan nada lama
      setPianoRollNotes(editKey(el), notes);
      renderPatNotes(el); patBarPlace();
    },
    grow() {
      const el = drumsPat(); if (!el) return false;
      const lane = el.parentElement, left = pl(el);
      let room = W - left;   // jangan menabrak pattern berikutnya di lane yang sama
      lane.querySelectorAll('.pattern').forEach(o => { if (o !== el && pl(o) > left + 1 && pl(o) - left < room) room = pl(o) - left; });
      if (room < pw(el) + BAR_W - 1) return false;
      el.style.width = (pw(el) + BAR_W) + 'px';
      handleSide(el); renderPatNotes(el); patBarPlace();
      return true;
    },
    pads() { const el = drumsPat(); return el ? fxRack.drumsPads(el.parentElement.dataset.track) || {} : {}; },
    setPad(id, v) { const el = drumsPat(); if (el) fxRack.setDrumsPad(el.parentElement.dataset.track, id, v); },
    playing: () => playing,
    toggle: () => togglePlay(),
    hit(m) { const el = drumsPat(); if (!el) return; const ctx = audio(); startVoice(ctx, master, el.parentElement.dataset.track, m, ctx.currentTime); }
  });
}
// ===== Menu "Tambahkan track" =====
const INSTRUMENTS = [
  {n:'Audio clip', c:'#14b8a6'}, {n:'Supersaw', c:'#5b3de8'}, {n:'DERIZ', c:'#22c7e8'}, {n:'Drums', c:'#f59e0b'}
].filter(t => !(DRUMS_HIDDEN && t.n === 'Drums'));   // Drums disembunyikan (lihat DRUMS_HIDDEN di drums.ts)
let addMenu = null, addBtn = null;
let trackSeq = Math.max(1, ...[...document.querySelectorAll('.trkcard-wrap')].map(c => +c.dataset.track));
function closeAddMenu(instant) {
  const m = addMenu, b = addBtn; addMenu = addBtn = null;
  if (b) b.setAttribute('aria-expanded', 'false');
  if (m) (instant === true || instant instanceof Event || REDUCE) ? m.remove() : fadeOut(m);
}
function openAddMenu(btn) {
  closeMenu(true);
  const m = document.createElement('div');
  m.className = 'add-menu';
  m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Pilih instrumen');
  m.innerHTML = INSTRUMENTS.map((it, k) => '<button role="menuitem" class="add-menu__item" data-k="' + k + '" style="--i:' + k + '">' + it.n + '</button>').join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), w = Math.min(230, innerWidth - 16), h = m.offsetHeight;
  m.style.width = w + 'px';
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  if (r.bottom + 8 + h <= innerHeight - 8) { m.style.top = r.bottom + 8 + 'px'; m.style.transformOrigin = 'left top'; }
  else { m.style.top = Math.max(8, r.top - h - 8) + 'px'; m.style.transformOrigin = 'left bottom'; }
  btn.setAttribute('aria-expanded', 'true');
  addMenu = m; addBtn = btn;
  m.addEventListener('click', e => {
    const it = e.target.closest('.add-menu__item');
    if (!it) return;
    const ins = INSTRUMENTS[+it.dataset.k];
    if (demoTrackFull(ins.n)) { closeAddMenu(); return; }
    addTrack(ins);
    closeAddMenu();
    // Audio clip: setelah track dibuat, munculkan card upload audio (menunggu menu selesai menghilang)
    if (ins.n === 'Audio clip') {
      const id = trackSeq, top = parseFloat(m.style.top), left = parseFloat(m.style.left), width = parseFloat(m.style.width);
      const fromBottom = m.style.transformOrigin === 'left bottom', bottom = top + m.offsetHeight;
      setTimeout(() => openAudioUploadCard(id, {left, top, bottom, width, fromBottom}, f => importAudio(id, f)), REDUCE ? 0 : 180);
    }
  });
}
// Icon track "Audio clip": gelombang suara (5 batang tebal, ujung bulat, tinggi tidak simetris), digambar sendiri dengan SVG supaya tajam di ukuran berapa pun
const ICON_AUDIO_CLIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
  '<path d="M3 10v4M7.5 7v10M12 3.5v17M16.5 6v12M21 9.5v5"/></svg>';
const ICON_AUTO =   // Icon track "Automation": kurva dengan titik kontrol
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6"/><circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.6" fill="currentColor" stroke="none"/></svg>';
function addTrack(t) {
  const id = ++trackSeq, cont = TRACK_TPL.cloneNode(true);
  cont.dataset.track = id; cont.dataset.ins = t.n; cont.classList.add('is-new');
  cont.style.setProperty('--track-color', t.c);
  const used = [...document.querySelectorAll('.trkcard__title-btn span')].map(x => x.textContent);
  let name = t.n, n = 2;
  while (used.includes(name)) name = t.n + ' ' + n++;
  const nm = cont.querySelector('[id^="track-name-"]');
  nm.id = 'track-name-' + id; nm.textContent = name;
  cont.querySelector('.trkcard__title-btn').title = name;
  if (t.n === 'Audio clip') cont.querySelector('.trkcard__inst .ico').innerHTML = ICON_AUDIO_CLIP;
  if (t.n === 'Automation') cont.querySelector('.trkcard__inst .ico').innerHTML = ICON_AUTO;   // track khusus Automation Clip (dibuat dari titik tiga di transport)
  cont.querySelector('input[type=range]').setAttribute('aria-label', 'Volume, ' + name);
  const lane = document.createElement('div');
  lane.className = 'lane'; lane.dataset.track = id; lane.style.setProperty('--track-color', t.c);
  document.querySelector('.headers-list').appendChild(cont);
  lanesEl.insertBefore(lane, lanesEl.querySelector('.playhead'));
  initRec(cont); initSliders(cont); initKnobs(cont); initMore(cont);
  cont.querySelector('.trkcard__lead').title = panelCollapsed() ? 'Buka panel track' : 'Tutup panel track';
  if (t.n === 'Supersaw') fxRack.addInstrument(id, 'supersaw');   // plugin synth otomatis muncul di panel efek track ini
  if (t.n === 'Drums') fxRack.addInstrument(id, 'drums');   // plugin Drums (step sequencer) otomatis muncul di panel efek track ini
  if (t.n === 'DERIZ') fxRack.addInstrument(id, 'deriz');   // plugin DERIZ (spektrogram + upload audio) juga otomatis muncul di track ini
  selectTrack(cont);
  if (!REDUCE) {
    const H = lane.offsetHeight, o = {duration:520, easing:EASE_OUT, fill:'backwards'};
    cont.style.overflow = lane.style.overflow = 'hidden';
    cont.animate([
      {height:'0px', paddingTop:'0px', opacity:0, transform:'translateX(-36px) scale(.94)'},
      {opacity:1, offset:.55},
      {height:H + 'px', paddingTop:'4px', opacity:1, transform:'none'}], o).onfinish = () => { cont.style.overflow = ''; };
    lane.animate([{height:'0px'},{height:H + 'px'}], o).onfinish = () => { lane.style.overflow = ''; };
  }
  setTimeout(() => cont.scrollIntoView({block:'nearest', inline:'nearest', behavior:'smooth'}), 300);
}
// Duplicate track (menu titik tiga): salinan muncul tepat di bawah track asal, lengkap dengan nama (+ nomor), warna, volume, pan, on/off,
// efek (Reverb / EQ / Filter / Supersaw), semua DERIZ (audio, garis start, knob), serta pattern + nadanya + audio clip.
// Salinan pattern memakai data nada sendiri (diedit terpisah dari aslinya); audio clip memakai buffer yang sama (tidak berubah, jadi aman dibagi).
function duplicateTrack(src) {
  const sid = src.dataset.track, sLane = lanesEl.querySelector('.lane[data-track="' + sid + '"]');
  if (!sLane || src.dataset.ins === 'Automation') return;
  if (demoTrackFull(src.dataset.ins)) return;
  const sName = document.getElementById('track-name-' + sid).textContent;
  const base = sName.replace(/\s+\d+$/, ''), used = new Set([...document.querySelectorAll('.trkcard__title-btn span')].map(x => x.textContent));
  let n = 2; while (used.has(base + ' ' + n)) n++;
  const name = base + ' ' + n, color = src.style.getPropertyValue('--track-color') || COLORS[0];
  const sPwr = src.querySelector('.trkcard__power'), sVol = src.querySelector('input[type=range]'), sPan = src.querySelector('.knob-input');
  const derizSrc = fxRack.derizIds(sid), derizState = fxRack.derizExport(sid), fxs = fxRack.fxExport(sid);
  if (DEMO && fxRack.derizCount() + derizSrc.length > LIMITS.derizPlugins) { demoNotice('derizplug'); return; }   // DEMO: salinan track tidak boleh melewati batas plugin DERIZ
  const pats = [...sLane.querySelectorAll('.pattern')].sort((a, b) => pl(a) - pl(b));
  const pans = sPan ? Math.round((+sPan.getAttribute('aria-valuenow') - 0.5) / 0.02) : 0;

  addTrack({n: src.dataset.ins || 'Audio clip', c: color});
  const id = String(trackSeq);
  const cont = document.querySelector('.trkcard-wrap[data-track="' + id + '"]'), lane = lanesEl.querySelector('.lane[data-track="' + id + '"]');
  src.after(cont); sLane.after(lane);   // addTrack menaruh di paling bawah: pindahkan ke tepat di bawah track asal (card + lane)
  document.getElementById('track-name-' + id).textContent = name;
  cont.querySelector('.trkcard__title-btn').title = name;
  const vol = cont.querySelector('input[type=range]');
  if (vol && sVol) { vol.setAttribute('aria-label', 'Volume, ' + name); vol.value = sVol.value; vol.dispatchEvent(new Event('input', {bubbles: true})); }
  const pan = cont.querySelector('.knob-input');
  if (pan && pans) { const key = pans > 0 ? 'ArrowRight' : 'ArrowLeft'; for (let i = Math.abs(pans); i > 0; i--) pan.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})); }
  panTip.hidden = true;

  // DERIZ: pertama = bawaan track, sisanya lewat addDeriz (sama seperti membuka project)
  while (fxRack.derizIds(id).length < derizSrc.length) { const k = fxRack.derizIds(id).length; if (k === 0) fxRack.addInstrument(id, 'deriz'); else fxRack.addDeriz(id); if (fxRack.derizIds(id).length === k) break; }
  derizState.forEach((st, i) => { if (fxRack.derizIds(id)[i] !== undefined) fxRack.derizImport(id, i, st); });
  if (fxs.length) fxRack.fxImport(id, fxs);
  if (sPwr && sPwr.getAttribute('aria-checked') === 'false') cont.querySelector('.trkcard__power').click();

  // pattern: posisi, lebar, judul, audio clip, dan nada (nada DERIZ track asal dipetakan ke DERIZ ke-i di track baru)
  const newDz = fxRack.derizIds(id);
  for (const p of pats) {
    const el = createPattern(lane, {start: pl(p), width: pw(p)}, clipOf(p, 0));
    el.querySelector('.pattern__title').textContent = p.querySelector('.pattern__title').textContent;
    const pid = p.dataset.prId; if (!pid) continue;
    const nid = 'pat' + (++prSeq); el.dataset.prId = nid;
    copyPianoRollNotes(pid, nid);
    for (const k of pianoRollExtraKeys(pid)) {
      const fx = +k.slice(pid.length + 1), i = derizSrc.indexOf(fx);   // DERIZ milik track ini -> pasangannya di track baru; DERIZ track lain tetap
      const to = i >= 0 ? newDz[i] : fx;
      if (to !== undefined) copyPianoRollNotes(k, nid + '@' + to);
    }
    renderPatNotes(el);
  }
  selectTrack(cont);
  toast('Track diduplikat: ' + name);
}
const addTrackBtn = document.querySelector('.addtrack');
addTrackBtn.setAttribute('aria-haspopup', 'dialog');
addTrackBtn.setAttribute('aria-expanded', 'false');
addTrackBtn.addEventListener('click', e => { e.stopPropagation(); addMenu ? closeAddMenu() : openAddMenu(addTrackBtn); });
document.addEventListener('click', e => { if (addMenu && !addMenu.contains(e.target)) closeAddMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && addMenu) { const b = addBtn; closeAddMenu(); b && b.focus(); } });
window.addEventListener('resize', closeAddMenu);
window.addEventListener('scroll', () => { if (!isProgScroll()) closeAddMenu(); }, true);


// ===== Transport: play / jeda, ke awal, mundur, maju, siklus, rekam =====
let BPM = 120, SEC_PER_BAR = 240 / BPM;               // 4/4: 1 bar = 4 ketukan; BPM bisa diubah lewat panel metronome (tombol M)
const metro = {on: false, countIn: false};
const phEl = document.getElementById('playhead');
const tc = document.querySelector('.tp');
const btnPlay = tc.querySelector('.play'), btnMetro = document.getElementById('btnMetro');
const btnRew = tc.querySelector('.rewind'), btnFwd = tc.querySelector('.forward');
let posBars = 0, playing = false, playRaf = 0, startPos = 0, startCtx = 0, nextBeat = 0, metroTimer = 0, lastBeat = -1;
// Playhead (timeline + piano roll) saat main digerakkan animasi CSS di compositor (tidak lewat JS per frame), jadi tetap mulus
// walau main thread sibuk membunyikan banyak nada. Animasi dibuat dari jam audio (startPos / startCtx) dan dibuat ulang saat
// play / seek / ganti tempo (scheduleClips), zoom timeline (BAR_W berubah), atau piano roll dibuka.
let phAnim = null, phAnimBarW = 0, phHeld = false;
let phJs = false;   // true: playhead digerakkan JS bareng scroll (Auto Scroll terkunci di tengah), bukan animasi CSS
// Waktu yang SEDANG TERDENGAR: actx.currentTime adalah jam penjadwalan, suara baru keluar speaker setelah outputLatency
// (besar karena latencyHint 'playback', apalagi Bluetooth). Tanpa kompensasi ini playhead sudah jalan sementara suara masih tertinggal.
const audibleNow = () => actx.currentTime - (actx.outputLatency || actx.baseLatency || 0);
// actx.currentTime naik per blok besar (puluhan ms) sehingga kalau dipakai langsung, scroll jadi patah-patah. Jam halus: maju
// mengikuti performance.now() tiap frame, lalu dikoreksi pelan ke jam audio (rata-rata tetap sinkron dengan suara, tanpa lompatan).
let clkEst = 0, clkT = 0;
function smoothAudible() {
  const raw = audibleNow(), p = performance.now();
  if (!clkT || Math.abs(raw - clkEst) > .15) clkEst = raw;   // pertama kali / lompat besar (seek, tempo): ikut jam audio langsung
  else { clkEst += (p - clkT) / 1000; clkEst += (raw - clkEst) * .05; }
  clkT = p; return clkEst;
}
function stopPhAnim() { if (phAnim) { phAnim.cancel(); phAnim = null; } phJs = false; }
function startPhAnim() {
  stopPhAnim(); phHeld = false; clkT = 0;
  const now = audibleNow(), wait = Math.max(0, startCtx - now);
  const pos = startPos + Math.max(0, now - startCtx) / SEC_PER_BAR, left = BARS - pos;
  phAnimBarW = BAR_W;
  phEl.style.translate = (pos * BAR_W) + 'px 0';
  setPianoRollPlayhead((pos - prStartBar) * 4, left > 0 ? {perSec: 4 / SEC_PER_BAR, delay: wait} : undefined);
  if (left <= 0) return;
  phAnim = phEl.animate([{translate: (pos * BAR_W) + 'px 0'}, {translate: (BARS * BAR_W) + 'px 0'}], {duration: left * SEC_PER_BAR * 1000, delay: wait * 1000, easing: 'linear', fill: 'none'});
}
function renderStatic() { stopPhAnim(); phEl.style.translate = (posBars * BAR_W) + 'px 0'; setPianoRollPlayhead((posBars - prStartBar) * 4); }   // dipisah dari transform agar tidak ditimpa animasi masuk
function renderPlayhead() { if (playing && !phHeld) startPhAnim(); else renderStatic(); }
function syncTransportUI() {
  btnPlay.setAttribute('aria-label', playing ? 'Jeda' : 'Putar');
  btnPlay.querySelector('use').setAttribute('href', playing ? '#pause-icon' : '#play-icon');
  drumsSyncPlay();   // tombol play di jendela Drums ikut berubah
}
// Posisi playhead dihitung dari jam AudioContext (bukan jam rAF), jadi selalu sinkron dengan suara audio clip
function tick() {
  if (!playing) return;
  posBars = startPos + Math.max(0, smoothAudible() - startCtx) / SEC_PER_BAR;
  if (posBars >= BARS) { posBars = BARS; pausePlay(); return; }
  followPlayhead();
  if (!phHeld && !phJs && BAR_W !== phAnimBarW) startPhAnim();   // zoom timeline: lebar bar berubah -> buat ulang animasi (timeline tidak auto-scroll mengikuti playhead)
  const b = Math.floor(posBars * 4 + 1e-6);   // titik ketukan di panel metronome + kedip tombol M
  if (b !== lastBeat) { lastBeat = b; metroUI.beat(b % 4); if (metro.on) metroUI.flash(); }
  playRaf = requestAnimationFrame(tick);
}
// Scheduler metronome: tiap 25 ms menjadwalkan klik ketukan yang jatuh dalam 120 ms ke depan (pakai jam AudioContext)
// Nada synth dari piano roll: antrean terurut waktu, dijadwalkan bersama klik metronome (lookahead yang sama)
let synthQ = [], synthI = 0;
// Membuat voice (Supersaw: ~25 node per nada) memakan main thread. Lookahead dibuat lebih panjang dan kerja per pump dibatasi ~3 ms:
// nada yang masih jauh ditunda ke pump berikutnya (25 ms lagi), jadi banyak nada sekaligus tidak menahan satu frame pun.
const SYNTH_AHEAD = .35;
function synthPump(ctx, ahead) {
  fxRack.derizHeadPump(ahead);   // garis play DERIZ: hanya untuk nada yang sebentar lagi mulai (nada DERIZ sendiri sudah di worklet sejak Play)
  const t0 = performance.now();
  while (synthI < synthQ.length && synthQ[synthI].when <= ahead) {
    if (synthQ[synthI].when > ctx.currentTime + .1 && performance.now() - t0 > 3) break;
    const n = synthQ[synthI++];
    if (n.deriz) fxRack.derizPlay(n.track, n.p, n.when, n.dur, n.glides, n.fxId, n.vel); else playNote(ctx, master, n.track, n.p, n.when, n.dur, n.glides, n.vel);
  }
}
// Nada satu pattern (kunci nada = key) dijadwalkan ke instrumen track "track"; deriz = lewat sampler DERIZ track itu
function queueNotes(el, key, track, deriz, bs, fxId) {
  const notes = getPianoRollNotes(key); if (!notes.length) return;
  const b0 = pl(el) / BAR_W * 4, b1 = (pl(el) + pw(el)) / BAR_W * 4, from = startPos * 4;
  // slide: nada slide tidak dibunyikan ulang; suara nada sumber dipanjangkan sampai akhir nada slide dan tinggi nadanya meluncur
  notes.sort((a, b) => a.s - b.s);
  const ent = new Map(), list = [];
  notes.forEach(n => {
    const s = b0 + n.s, e = Math.min(s + n.l, b1);
    if (e <= from + 1e-6 || s >= b1) return;
    const src = slideSource(notes, n), en = src && ent.get(src);
    if (en) {
      ent.set(n, en); en.eb = Math.max(en.eb, e);
      if (s <= from) { en.p = n.p; en.cur = n.p; en.glides = []; }   // mulai main di tengah / setelah luncuran: langsung di tinggi nada akhir
      else { en.glides.push({b: s, from: en.cur, to: n.p, d: Math.min(glideBeats(n), e - s)}); en.cur = n.p; }
      return;
    }
    const e1 = {p: n.p, cur: n.p, sb: Math.max(s, from), eb: e, glides: [], vel: n.v};   // velocity nada sumber berlaku untuk seluruh luncuran
    ent.set(n, e1); list.push(e1);
  });
  list.forEach(en => synthQ.push({track, deriz, fxId, p: en.p, vel: en.vel, when: startCtx + (en.sb - from) * bs, dur: (en.eb - en.sb) * bs,
    glides: en.glides.length ? en.glides.map(g => ({when: startCtx + (g.b - from) * bs, from: g.from, to: g.to, dur: g.d * bs})) : undefined}));
}
function buildSynthQueue() {
  synthQ = []; synthI = 0;
  const bs = SEC_PER_BAR / 4;   // detik per ketukan
  const derizAll = fxRack.derizAll();
  lanesEl.querySelectorAll('.pattern[data-pr-id]').forEach(el => {
    const track = el.parentElement.dataset.track, id = el.dataset.prId;
    if (hasSynth(track)) queueNotes(el, id, track, false, bs);   // Supersaw milik track pattern ini
    for (const d of derizAll) queueNotes(el, patKey(id, d.id, track), d.track, true, bs, d.id);   // semua DERIZ (di track mana pun) yang mengisi pattern ini
  });
  // DERIZ: seluruh nada dikirim sekali ke worklet (dijalankan lewat jam audio, tidak bergantung pada pump main thread); sisanya (Supersaw) tetap lewat pump
  const dz = synthQ.filter(n => n.deriz); synthQ = synthQ.filter(n => !n.deriz);
  if (dz.length) fxRack.derizSchedule(dz.map(n => ({track: n.track, midi: n.p, when: n.when, dur: n.dur, glides: n.glides, fxId: n.fxId, vel: n.vel})));
  synthQ.sort((a, b) => a.when - b.when);
}
function metroPump() {
  if (!playing) return;
  const ctx = actx, ahead = ctx.currentTime + .12;
  synthPump(ctx, ctx.currentTime + SYNTH_AHEAD);
  autoPump(ctx);
  for (;;) {
    const t = startCtx + (nextBeat / 4 - startPos) * SEC_PER_BAR;
    if (t > ahead) break;
    if (metro.on && t >= ctx.currentTime - .01) metroClick(ctx, t, nextBeat % 4 === 0);
    nextBeat++;
  }
}
// Penempatan clip dalam satuan bar (bukan piksel): zoom mengubah piksel tapi tidak mengubah posisi bar, jadi tidak perlu jadwal ulang
const clipPlacements = () => [...lanesEl.querySelectorAll('.pattern[data-clip]')].map(p => ({
  track: p.parentElement.dataset.track, clip: +p.dataset.clip,
  startBar: pl(p) / BAR_W, endBar: (pl(p) + pw(p)) / BAR_W, offsetSec: +p.dataset.off || 0}));
const r3 = v => Math.round(v * 1000) / 1000;
const placementSig = () => JSON.stringify([
  clipPlacements().map(c => [c.track, c.clip, r3(c.startBar), r3(c.endBar), r3(c.offsetSec)]),
  [...lanesEl.querySelectorAll('.pattern[data-pr-id]')].map(p => [p.parentElement.dataset.track, p.dataset.prId, r3(pl(p) / BAR_W), r3(pw(p) / BAR_W)])
]);
let schedSig = '';
function scheduleClips(countIn) {
  const ctx = audio(), beat = 60 / BPM, lead = countIn ? 4 * beat : 0;
  document.querySelectorAll('.trkcard-wrap').forEach(c => {
    const sl = c.querySelector('input[type=range]'); if (sl) setTrackVolume(c.dataset.track, +sl.value);
  });
  const cold = fxRack.derizWarm();   // sampler DERIZ yang belum siap disiapkan lebih dulu; kalau ada yang dari nol, start ditunda sebentar supaya nada pertama tidak terlambat
  startPos = posBars; startCtx = ctx.currentTime + .05 + lead + (cold ? .4 : 0);   // jeda kecil supaya penjadwalan tidak telat (+ 1 bar count-in)
  metroCancel(ctx);                                                // klik lama (tempo lama) dibatalkan
  if (countIn) for (let i = 0; i < 4; i++) metroClick(ctx, startCtx - (4 - i) * beat, i === 0);
  nextBeat = Math.ceil(startPos * 4 - 1e-6); lastBeat = -1;
  clearInterval(metroTimer); metroTimer = setInterval(metroPump, 25); metroPump();
  const clips = clipPlacements();
  schedSig = placementSig();
  playClips(ctx, master, clips, posBars, SEC_PER_BAR, startCtx);
  stopAllSynth(ctx); fxRack.derizStop(); dbgRun(startCtx, ctx); buildSynthQueue(); synthPump(ctx, ctx.currentTime + SYNTH_AHEAD);   // dbgRun: hitungan Debug Audio mulai dari nol tiap Play
  startPhAnim();
}
function startPlay() {
  if (playing) return;
  if (posBars >= BARS) posBars = 0;
  startMark = posBars;   // titik start: tombol mundur akan kembali ke sini
  playing = true; holdSpec(true); scheduleClips(metro.countIn);
  userScrollUntil = 0;   // Auto Scroll: Play selalu mengikuti playhead lagi
  if (autoScroll) showPlayhead();   // playhead di luar layar: timeline dibawa ke dekatnya dulu
  playRaf = requestAnimationFrame(tick); syncTransportUI();
}
function pausePlay() {
  holdSpec(false);
  if (playing) posBars = Math.min(BARS, startPos + Math.max(0, audibleNow() - startCtx) / SEC_PER_BAR);   // posisi terakhir (yang terdengar) dari jam audio (playhead bergerak lewat animasi, bukan lewat tick)
  playing = false; cancelAnimationFrame(playRaf); playRaf = 0; stopClips(actx); stopAllSynth(actx); fxRack.derizStop(); synthQ = []; clearInterval(metroTimer); metroTimer = 0; metroCancel(actx, true); metroUI.beat(-1); syncTransportUI(); phHeld = false; renderStatic();
}
const togglePlay = () => playing ? pausePlay() : startPlay();
function toStart() {
  pausePlay(); posBars = 0; startMark = 0; renderPlayhead(); syncTransportUI();
  wsEl.scrollTo({left: 0, behavior: 'smooth'});
}
function seekBy(d) {
  posBars = Math.max(0, Math.min(BARS, posBars + d)); renderPlayhead();
  if (playing) scheduleClips();   // lompat saat sedang main: suara ikut pindah
  else startMark = posBars;       // playhead digeser manual saat berhenti: posisi barunya jadi titik start
}
// Tombol mundur: kembali ke titik tempat terakhir kali Play dimulai; kalau sudah di sana (atau di sebelum itu), klik lagi = ke awal (bar 1)
let startMark = 0;
// ===== Auto Scroll playlist =====
// Nyala: playhead berjalan sendiri sesuai tempo dari kiri sampai tepat di TENGAH area playlist yang terlihat. Mulai dari situ playhead diam di tengah
// dan timeline yang bergulir dengan kecepatan yang sama persis (posisi dihitung tiap frame dari jam audio yang sama dengan playhead, jadi ikut tempo / BPM).
// Penting: .workspace punya scroll-behavior:smooth, jadi geseran per-frame WAJIB behavior:'instant' (kalau tidak, tiap frame memulai animasi baru dan tertinggal).
// Kalau pengguna menggulir sendiri (wheel / sentuh), ikut-ikutan dijeda 2,5 detik lalu timeline menyusul lagi dengan halus.
// Pilihan disimpan di localStorage (AUTOSCROLL_KEY); bawaan = nyala.
const AUTOSCROLL_KEY = 'derizmp3.autoScroll';
let autoScroll = true, userScrollUntil = 0;
const FOLLOW_AT = .5, FOLLOW_PAUSE = 2500;   // letak playhead terkunci (porsi lebar area playlist yang terlihat; .5 = tengah) dan lama jeda setelah pengguna menggulir
try { autoScroll = localStorage.getItem(AUTOSCROLL_KEY) !== '0'; } catch { /* penyimpanan diblokir: bawaan nyala */ }
const autoScrollBtn = document.getElementById('autoScrollToggle');
function syncAutoScrollUI() {
  autoScrollBtn.setAttribute('aria-checked', String(autoScroll));
  autoScrollBtn.title = 'Auto scroll playlist: ' + (autoScroll ? 'nyala' : 'mati');
}
autoScrollBtn.addEventListener('click', () => {
  autoScroll = !autoScroll; syncAutoScrollUI();
  try { localStorage.setItem(AUTOSCROLL_KEY, autoScroll ? '1' : '0'); } catch { /* abaikan */ }
  userScrollUntil = 0;   // dinyalakan saat main: timeline langsung menyusul playhead
  toast('Auto scroll ' + (autoScroll ? 'nyala' : 'mati'));
});
syncAutoScrollUI();
// Saat terkunci di tengah, playhead TIDAK lagi memakai animasi CSS (jam compositor beda dengan scroll di main thread -> posisi relatifnya bergetar).
// Playhead dan scrollLeft dihitung dari satu nilai (posBars, jam halus) dan ditulis di frame yang sama, jadi playhead diam di layar dan timeline
// yang bergulir. Offset scroll di-snap ke piksel fisik (browser membulatkannya) dan playhead mengikuti nilai yang sama, jadi tidak ada getar sub-piksel.
function followPlayhead() {
  const idle = !autoScroll || phHeld || performance.now() < userScrollUntil;
  if (idle) { if (phJs) startPhAnim(); return; }                                      // keluar dari mode kunci: animasi CSS jalan lagi dari posisi sekarang
  const off = tlEl.offsetLeft, vw = wsEl.clientWidth - off, cur = wsEl.scrollLeft;   // vw = lebar area playlist yang terlihat (tanpa panel track)
  const sx = posBars * BAR_W - cur;                                                   // posisi playhead di dalam area itu
  if (sx < vw * FOLLOW_AT && !phJs) return;                                           // belum sampai tengah: playhead jalan sendiri
  const target = Math.max(0, posBars * BAR_W - vw * FOLLOW_AT), d = target - cur;     // scrollLeft yang menaruh playhead tepat di titik kunci
  if (!REDUCE && Math.abs(d) >= 40) {                                                 // jauh (mis. Play dari posisi di kanan): menyusul halus
    if (phJs) startPhAnim();
    progScrollAt = performance.now();
    wsEl.scrollTo({left: cur + d * .2, behavior: 'instant'});
    return;
  }
  const dpr = window.devicePixelRatio || 1, maxS = Math.max(0, wsEl.scrollWidth - wsEl.clientWidth);
  const sc = Math.min(maxS, Math.round(target * dpr) / dpr);
  if (!phJs) { stopPhAnim(); phJs = true; }
  progScrollAt = performance.now();
  wsEl.scrollTo({left: sc, behavior: 'instant'});
  phEl.style.translate = (target > maxS ? posBars * BAR_W : sc + vw * FOLLOW_AT) + 'px 0';   // di ujung timeline scroll mentok: playhead lanjut jalan sampai akhir
}
const userScrolled = () => { userScrollUntil = performance.now() + FOLLOW_PAUSE; };
wsEl.addEventListener('wheel', userScrolled, {passive: true});
wsEl.addEventListener('touchmove', userScrolled, {passive: true});
function showPlayhead() {   // geser timeline kalau playhead keluar dari layar
  const off = tlEl.offsetLeft, x = off + posBars * BAR_W, l = wsEl.scrollLeft, w = wsEl.clientWidth;
  if (x < l + off + 8 || x > l + w - 24) wsEl.scrollTo({left: Math.max(0, x - w * .3), behavior: REDUCE ? 'instant' : 'smooth'});
}
// Tap / seret penggaris piano roll: playhead pindah ke posisi itu (relatif awal pattern yang dibuka)
setPianoRollSeekHandler((beats, final) => {
  posBars = Math.max(0, Math.min(BARS, prStartBar + beats / 4));
  if (!final) { if (playing) phHeld = true; renderStatic(); return; }   // saat diseret: tahan playhead di jari (animasi berhenti), suara pindah saat dilepas
  phHeld = false; renderPlayhead();
  if (playing) scheduleClips();   // sedang main: suara ikut pindah (hanya saat jari dilepas)
  else startMark = posBars;       // berhenti: posisi baru jadi titik start
});
// Tap / seret penggaris timeline utama (sama seperti penggaris piano roll): playhead langsung pindah ke posisi jari, di mana pun.
// Saat diseret sambil main, playhead ditahan di jari; suara pindah saat jari dilepas. Dekat tepi layar, timeline ikut menggulir.
const rulerHd = document.querySelector('.tl-headwrap');
let rSeekId = -1, rSeekX = 0, rScrollRaf = 0;
function rulerSeek(clientX, final) {
  posBars = Math.max(0, Math.min(BARS, (clientX - tlEl.getBoundingClientRect().left) / BAR_W));
  if (!final) { if (playing) phHeld = true; renderStatic(); return; }
  phHeld = false; renderPlayhead();
  if (playing) scheduleClips();   // sedang main: suara ikut pindah
  else startMark = posBars;       // berhenti: posisi baru jadi titik start
}
function rulerEdgeScroll() {
  rScrollRaf = 0;
  if (rSeekId === -1) return;
  const r = wsEl.getBoundingClientRect(), l = r.left + tlEl.offsetLeft + 40, rt = r.right - 40;
  const v = rSeekX < l ? rSeekX - l : rSeekX > rt ? rSeekX - rt : 0;
  if (v) { wsEl.scrollBy({left: Math.max(-24, Math.min(24, v * .4)), behavior: 'instant'}); rulerSeek(rSeekX, false); }
  rScrollRaf = requestAnimationFrame(rulerEdgeScroll);
}
rulerHd.addEventListener('pointerdown', e => {
  if (rSeekId !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
  rSeekId = e.pointerId; rSeekX = e.clientX; rulerHd.setPointerCapture(e.pointerId);
  rulerSeek(e.clientX, false);
  if (!rScrollRaf) rScrollRaf = requestAnimationFrame(rulerEdgeScroll);
});
rulerHd.addEventListener('pointermove', e => { if (e.pointerId === rSeekId) { rSeekX = e.clientX; rulerSeek(e.clientX, false); } });
const rulerEnd = e => {
  if (e.pointerId !== rSeekId) return;
  rSeekId = -1; cancelAnimationFrame(rScrollRaf); rScrollRaf = 0;
  rulerSeek(e.clientX, true);
};
rulerHd.addEventListener('pointerup', rulerEnd);
rulerHd.addEventListener('pointercancel', rulerEnd);
function rewind() {
  const to = posBars > startMark + 1e-6 ? startMark : 0;
  startMark = to;
  posBars = to; renderPlayhead(); showPlayhead();
  if (playing) scheduleClips();   // sedang main: lanjut main dari titik tujuan
}
// ===== Metronome & BPM project =====
// Ganti BPM: 1 bar jadi lebih pendek / panjang. Posisi playhead (dalam bar) tetap; audio clip mempertahankan isi audionya,
// jadi lebarnya (dalam bar) ikut berubah (dipotong kalau menabrak clip berikutnya, timeline memanjang kalau perlu).
function setBpm(v) {
  v = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(v)));
  if (v === BPM) return;
  const ratio = SEC_PER_BAR / (240 / v);   // panjang bar lama / panjang bar baru
  BPM = v; SEC_PER_BAR = 240 / v;
  setHostBpm(v);   // Delay mode HOST ikut BPM project
  applySyncSamples();   // pattern dengan Sync all sample: Speed DERIZ ikut BPM baru
  const clips = [...lanesEl.querySelectorAll('.pattern[data-clip]')];
  if (clips.length) {
    const need = Math.max(...clips.map(p => (pl(p) + pw(p) * ratio) / BAR_W));
    if (need > BARS) growTimeline(Math.min(MAX_BARS, Math.ceil(need) + 1));
    clips.forEach(p => {
      const st = pl(p); let hi = W;
      otherPats(p).forEach(o => { if (pl(o) > st + 1) hi = Math.min(hi, pl(o)); });
      p.style.width = Math.max(Math.min(pw(p) * ratio, hi - st), Math.min(BAR_W / 2, hi - st)) + 'px';
    });
    if (selPat) { handleSide(selPat); patBarPlace(); }
  }
  if (playing) scheduleClips();                 // tempo baru langsung terdengar, posisi tidak loncat
  undoStack = []; redoStack = []; histCur = histCapture(); histSync();   // lebar clip berubah: riwayat undo dimulai ulang
}
btnPlay.addEventListener('click', togglePlay);
initPitchPanel(document.getElementById('btnPitch') as HTMLButtonElement);   // paling kiri: knob Pitch Project (DERIZ + Supersaw, audio clip tidak ikut)
initTransportMore(document.getElementById('btnMore') as HTMLButtonElement, () => {   // titik tiga di kiri tombol M
  const t = fxRack.lastTouched(), info = t && fxRack.paramInfo(t.track, t.fxId, t.key);   // ada knob yang baru diputar = muncul opsi Automation Clip
  return t && info ? [{label: 'Create Automation Clip', sub: info.fxName + ' · ' + info.label, run: createAutomationClip}] : [];
});
const metroUI = initMetronomePanel(btnMetro, {
  getBpm: () => BPM, setBpm,
  isOn: () => metro.on,
  setOn: on => {
    metro.on = on;
    if (on && !playing) metroClick(audio(), actx.currentTime + .02, true);   // contoh bunyi saat dinyalakan
    if (!on) metroCancel(actx);
  },
  isCountIn: () => metro.countIn, setCountIn: on => { metro.countIn = on; },
});
// mundur / maju: 1 bar per klik, tahan untuk terus bergeser
function holdSeek(btn, d) {
  let to = 0, iv = 0;
  const stop = () => { clearTimeout(to); clearInterval(iv); to = iv = 0; };
  btn.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    seekBy(d); stop();
    to = setTimeout(() => { iv = setInterval(() => seekBy(d), 90); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev => btn.addEventListener(ev, stop));
  btn.addEventListener('click', e => { if (e.detail === 0) seekBy(d); });   // aktivasi lewat keyboard (Enter/Space)
}
btnRew.addEventListener('click', rewind);   // juga menangani Enter / Space saat tombol difokus
holdSeek(btnFwd, 1);
// pintasan: Space = putar/jeda, panah kiri/kanan = mundur/maju
let spaceHandled = false;
document.addEventListener('keydown', e => {
  if (e.metaKey || e.altKey || typing(e.target) || (e.target.closest && e.target.closest('[role="slider"]') && e.key !== ' ')) return;
  if (e.key === ' ' || e.code === 'Space') {
    if (e.target.closest && e.target.closest('[role="slider"], input[type="range"]')) return;
    e.preventDefault(); spaceHandled = true;
    if (!e.repeat) togglePlay();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.shiftKey && !(e.target.matches && e.target.matches('input[type="range"]'))) {
    e.preventDefault(); e.key === 'ArrowLeft' ? rewind() : seekBy(1);
  }
});
document.addEventListener('keyup', e => {   // cegah Space ikut "mengklik" tombol yang sedang fokus
  if ((e.key === ' ' || e.code === 'Space') && spaceHandled) { e.preventDefault(); spaceHandled = false; }
});
renderPlayhead(); syncTransportUI();

// ===== Audio clip: upload -> decode -> masuk timeline -> bersuara =====
let toastEl = null, toastT = 0;
function toast(msg, ms = 3200) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'daw-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastT); if (ms) toastT = setTimeout(() => { toastEl.hidden = true; }, ms);
}
function growTimeline(n) {   // timeline memanjang supaya audio panjang (lagu) muat utuh
  if (DEMO) n = Math.min(n, LIMITS.bars);   // DEMO: timeline tidak melebihi batas
  BARS = n; sizeRuler(); paintRuler(true);
}
async function importAudio(trackId, file, dropX = null) {   // dropX = clientX tempat clip dilepas (dari MPCS); null = mulai dari bar 1
  const ctx = audio(), laneSel = '.lane[data-track="' + trackId + '"]';
  toast('Memuat audio…', 0);
  let buf;
  try { buf = await decodeFile(ctx, file); }
  catch (err) { console.error(err); toast('File audio tidak bisa dibaca / format tidak didukung'); return; }
  const lane = lanesEl.querySelector(laneSel);
  if (!lane) { toast('', 1); return; }   // track sudah dihapus selama decode
  if (DEMO && buf.duration > LIMITS.audioSec) { const n = Math.round(LIMITS.audioSec * buf.sampleRate), nb = new AudioBuffer({length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate}); for (let c = 0; c < buf.numberOfChannels; c++) nb.copyToChannel(buf.getChannelData(c).slice(0, n), c); buf = nb; }   // DEMO: audio dipotong
  const durBars = buf.duration / SEC_PER_BAR;
  const startBar = dropX == null ? 0 : Math.max(0, Math.floor((dropX - lanesEl.getBoundingClientRect().left) / BAR_W));   // dilepas di bar mana (dibulatkan ke bar)
  if (startBar + durBars > BARS) growTimeline(Math.min(MAX_BARS, Math.ceil(startBar + durBars) + 1));
  const start = Math.min(startBar * BAR_W, Math.max(0, W - BAR_W / 2));
  const width = Math.max(BAR_W / 2, Math.min(durBars * BAR_W, W - start));
  const el = createPattern(lane, {start, width}, {clip: addBuffer(buf), off: 0});
  el.querySelector('.pattern__title').textContent = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Audio';
  if (dropX == null) wsEl.scrollTo({left: 0, behavior: 'smooth'});
  toast(durBars > MAX_BARS ? 'Audio dipotong: timeline maksimum ' + MAX_BARS + ' bar' : 'Audio ditambahkan ke timeline');
}
// hasil olahan MPCS dilepas di timeline: bikin track Audio clip baru, clip-nya diletakkan di bar tempat dilepas
document.addEventListener('mpcs-audioclip', e => {
  const {file, x} = e.detail || {};
  if (!file) return;
  if (demoTrackFull('Audio clip')) return;
  addTrack(INSTRUMENTS.find(i => i.n === 'Audio clip'));
  const id = trackSeq;
  trackAudioFiles.set(id, file);
  importAudio(id, file, x);
});
// waveform digambar ulang hanya kalau jendela audio berubah (panjang / offset), bukan saat zoom
function syncWaves() {
  lanesEl.querySelectorAll('.pattern[data-clip]').forEach(p => {
    const off = +p.dataset.off || 0, dur = pw(p) / BAR_W * SEC_PER_BAR, key = off.toFixed(3) + '|' + dur.toFixed(3) + '|' + (document.documentElement.dataset.wfmode || 'mono');
    if (p.dataset.wk !== key) { p.dataset.wk = key; renderWave(p, +p.dataset.clip, off, dur); }
  });
}
document.addEventListener('wfmodechange', syncWaves);   // Pengaturan > Waveform audio clip diganti: gambar ulang semua clip
let waveRaf = 0, resyncT = 0;
new MutationObserver(ms => {
  const hit = ms.some(m => m.type === 'childList'
    ? [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && n.classList.contains('pattern'))
    : m.target.classList && m.target.classList.contains('pattern'));
  if (!hit) return;
  if (!waveRaf) waveRaf = requestAnimationFrame(() => { waveRaf = 0; syncWaves(); });
  // clip digeser/dihapus saat main -> jadwal ulang. Zoom hanya mengubah piksel, jadi dilewati (kalau tidak, suara putus-putus saat zoom)
  if (playing) { clearTimeout(resyncT); resyncT = setTimeout(() => { if (playing && placementSig() !== schedSig) scheduleClips(); }, 120); }
}).observe(lanesEl, {childList: true, subtree: true, attributes: true, attributeFilter: ['style']});
// switch on/off track (ungu = nyala): mati -> track hening (meter ikut nol), pattern di lane diredupkan
document.querySelector('.headers-list').addEventListener('click', e => {
  const sw = e.target.closest && e.target.closest('.trkcard__power'), c = sw && sw.closest('.trkcard-wrap');
  if (!c) return;
  const off = sw.getAttribute('aria-checked') === 'true';   // sebelumnya nyala -> sekarang mati
  sw.setAttribute('aria-checked', String(!off));
  c.classList.toggle('is-off', off);
  const lane = document.querySelector('.lane[data-track="' + c.dataset.track + '"]');
  if (lane) lane.classList.toggle('is-off', off);
  setTrackMuted(c.dataset.track, off);
});
// slider volume track -> volume audio clip (langsung terdengar saat diputar)
document.querySelector('.headers-list').addEventListener('input', e => {
  const sl = e.target.closest && e.target.closest('input[type=range]'), c = sl && sl.closest('.trkcard-wrap');
  if (c) setTrackVolume(c.dataset.track, +sl.value);
});

// ===== Zoom timeline =====
const LOGR = Math.log(BAR_MAX / BAR_MIN);
let paintRaf = 0;
wsEl.addEventListener('scroll', () => { if (!paintRaf) paintRaf = requestAnimationFrame(() => { paintRaf = 0; paintRuler(); }); }, {passive: true});
window.addEventListener('resize', () => paintRuler(true));
const zoomVarCache = {};
function setZoomVar(k, v) { if (zoomVarCache[k] !== v) { zoomVarCache[k] = v; lanesEl.style.setProperty(k, v); } }   // hanya tulis kalau berubah (ambang zoom jarang terlewati)
function setZoom(next, clientX) {
  next = Math.max(BAR_MIN, Math.min(BAR_MAX, next));
  if (Math.abs(next - BAR_W) < 0.01) return;
  const T0 = performance.now(); let T = T0; const lap = n => { const t = performance.now(); dbgZoom(n, t - T); T = t; };   // Debug Audio: waktu per tahap
  const ratio = next / BAR_W;
  if (clientX == null) {
    const r = wsEl.getBoundingClientRect(), tl = document.querySelector('.tracklist').offsetWidth;
    clientX = r.left + tl + (r.width - tl) / 2;
  }
  const x = clientX - tlEl.getBoundingClientRect().left;   // titik di timeline yang dijaga tetap diam
  lap('1 baca ukuran (bisa paksa layout)');
  dismissAdd(true);
  BAR_W = next;
  // Variabel zoom ditulis di #lanes, BUKAN :root: perubahan variabel yang diwariskan di akar memaksa hitung ulang gaya SELURUH halaman (piano roll, panel efek, overlay, menu).
  // Pemakainya (.lane, .pattern, mini piano-roll di pattern) semuanya ada di dalam #lanes; pattern-jelly menyalin --bar ke kartu yang diangkat.
  lanesEl.style.setProperty('--bar', BAR_W + 'px');
  setZoomVar('--beat-a', BAR_W >= 56 ? .08 : 0);
  setZoomVar('--sub-a', BAR_W >= 160 ? .045 : 0);
  setZoomVar('--mid-a', BAR_W >= 640 ? .035 : 0);
  setZoomVar('--fine-a', BAR_W >= 1280 ? .03 : 0);
  lap('2 variabel CSS');
  document.querySelectorAll('.pattern').forEach(p => {
    p.style.left = pl(p) * ratio + 'px';
    p.style.width = pw(p) * ratio + 'px';
  });
  lap('3 left/width semua pattern');
  sizeRuler(); lap('4 sizeRuler');
  void getComputedStyle(wsEl).display; lap('5a gaya dihitung ulang (paksa)');
  void wsEl.scrollWidth; lap('5b layout (paksa)');
  wsEl.scrollTo({left: wsEl.scrollLeft + x * (ratio - 1), behavior: 'instant'});
  lap('5c scrollTo');
  paintRuler(true); lap('6 paintRuler');
  if (selPat) handleSide(selPat);
  lap('7 handleSide');
  renderPlayhead(); lap('8 playhead');
  dbgZoom('0 setZoom total', performance.now() - T0);
}
// Zoom halus: target diperbarui, lalu BAR_W "mengejar" target tiap frame (interpolasi eksponensial)
const clampBar = v => Math.max(BAR_MIN, Math.min(BAR_MAX, v));
let zoomTarget = BAR_W, zoomAnchor = null, zoomRaf = 0;
function zoomStep() {
  const err = Math.log(zoomTarget / BAR_W);
  if (Math.abs(err) < 0.004) { setZoom(zoomTarget, zoomAnchor); zoomRaf = 0; return; }
  setZoom(BAR_W * Math.exp(err * 0.22), zoomAnchor);
  zoomRaf = requestAnimationFrame(zoomStep);
}
function zoomTo(target, clientX) {
  zoomTarget = clampBar(target); zoomAnchor = clientX;
  if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
}
function zoomNow(next, clientX) {   // langsung, tanpa animasi (slider & pinch jari)
  if (zoomRaf) { cancelAnimationFrame(zoomRaf); zoomRaf = 0; }
  setZoom(next, clientX); zoomTarget = BAR_W;
}
const ZSTEP = 1.2;
// Ctrl + scroll / pinch trackpad
wsEl.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (document.documentElement.classList.contains('is-pat-jelly')) return;   // pattern terangkat (Record Mode): zoom-nya milik pattern, bukan timeline
  e.preventDefault();
  // deltaY mouse wheel bisa ±100 per klik (terlalu besar) -> dibatasi; trackpad pinch nilainya kecil jadi tetap halus
  let dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  dy = Math.max(-24, Math.min(24, dy));
  zoomTo(zoomTarget * Math.exp(-dy * 0.008), e.clientX);
}, {passive: false});
// Pinch dua jari di layar sentuh.
// Selama jari bergerak, timeline HANYA diskalakan lewat CSS transform (tanpa hitung ulang layout / ruler / grid).
// BAR_W, left/width pattern, ruler, dan scroll diterapkan SEKALI saat jari dilepas (zoomNow), lalu transform dibuang di tugas yang sama (tidak ada frame antara).
let pinch = null;
const tdist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const tmid = t => (t[0].clientX + t[1].clientX) / 2;
wsEl.addEventListener('touchstart', e => {
  if (document.documentElement.classList.contains('is-pat-jelly')) return;   // pattern terangkat (Record Mode): cubit dua jari = zoom pattern, bukan timeline
  if (e.touches.length === 2) {
    const cx0 = tmid(e.touches), tl0 = tlEl.getBoundingClientRect().left;
    pinch = {d: tdist(e.touches), bar: BAR_W, cx0, cx: cx0, tl0, u0: cx0 - tl0, s: 1, on: false};   // u0 = titik timeline di bawah jari saat mulai
    wsEl.style.overflow = 'hidden'; dismissAdd(true);
  }
}, {passive: true});
wsEl.addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  if (document.documentElement.classList.contains('is-pat-jelly')) return;
  if (e.cancelable) e.preventDefault();
  const next = clampBar(pinch.bar * tdist(e.touches) / pinch.d);
  pinch.s = next / pinch.bar; pinch.cx = tmid(e.touches);
  if (!pinch.on) { pinch.on = true; tlEl.style.transformOrigin = '0 0'; tlEl.style.willChange = 'transform'; }
  tlEl.style.transform = 'translateX(' + (pinch.cx - pinch.tl0 - pinch.s * pinch.u0) + 'px) scaleX(' + pinch.s + ')';   // titik u0 tetap di bawah jari (ikut geser)
}, {passive: false});
function pinchCommit() {
  const p = pinch; if (!p) return; pinch = null;
  if (p.on) {
    const tc = performance.now();
    tlEl.style.transform = ''; tlEl.style.transformOrigin = ''; tlEl.style.willChange = '';   // harus dibuang dulu: setZoom membaca getBoundingClientRect
    zoomNow(p.bar * p.s, p.cx0);
    if (p.cx !== p.cx0) wsEl.scrollBy({left: p.cx0 - p.cx, behavior: 'instant'});   // ikut geseran jari selama cubit
    const te = performance.now(); dbgZoom('9 lepas jari: skrip commit', te - tc);
    queueMicrotask(() => dbgZoom('A observer (microtask) setelah commit', performance.now() - te));   // MutationObserver pattern jalan sebelum ini
    requestAnimationFrame(() => requestAnimationFrame(() => dbgZoom('B jeda total sampai 2 frame setelah lepas jari', performance.now() - tc)));
  }
  wsEl.style.overflow = '';
}
const endPinch = e => { if (pinch && e.touches.length < 2) pinchCommit(); };
wsEl.addEventListener('touchend', endPinch);
wsEl.addEventListener('touchcancel', endPinch);
// ===== Undo / Redo: riwayat pattern (buat, geser, panjangkan, salin, bagi, hapus, ubah nama) =====
const btnUndo = document.getElementById('btnUndo'), btnRedo = document.getElementById('btnRedo');
const HIST_MAX = 100, r4 = v => Math.round(v * 1e4) / 1e4;   // posisi disimpan dalam satuan bar, jadi zoom tidak dihitung sebagai perubahan
let undoStack = [], redoStack = [], histCur = null, histTimer = 0, histPressed = false;
function histCapture() {
  const ids = [], pats = {};
  lanesEl.querySelectorAll('.lane').forEach(l => {
    ids.push(l.dataset.track);
    pats[l.dataset.track] = [...l.querySelectorAll('.pattern')].map(p => ({s: r4(pl(p) / BAR_W), w: r4(pw(p) / BAR_W), t: p.querySelector('.pattern__title').textContent, c: p.dataset.clip || '', o: r4(+p.dataset.off || 0), a: p.dataset.auId || ''}))
      .sort((a, b) => a.s - b.s || a.w - b.w || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  });
  return {ids: ids.join(','), pats};
}
function histPulse(btn, cls) { btn.classList.remove('is-pop', 'is-tap'); void btn.offsetWidth; btn.classList.add(cls); }
function histSync() {
  const u = !undoStack.length, r = !redoStack.length;
  if (btnUndo.disabled && !u) histPulse(btnUndo, 'is-pop');   // baru jadi aktif
  if (btnRedo.disabled && !r) histPulse(btnRedo, 'is-pop');
  btnUndo.disabled = u; btnRedo.disabled = r;
}
function histCommit() {
  histTimer = 0;
  // tunggu sampai jari dilepas & pengeditan nama selesai, supaya satu gerakan = satu langkah
  if (histPressed || document.querySelector('.pattern__title[contenteditable="true"]')) { histTimer = setTimeout(histCommit, 200); return; }
  const now = histCapture();
  if (JSON.stringify(now) === JSON.stringify(histCur)) return;
  if (now.ids !== histCur.ids) { undoStack = []; redoStack = []; }   // track ditambah / dihapus: riwayat dimulai ulang
  else { undoStack.push(histCur); if (undoStack.length > HIST_MAX) undoStack.shift(); redoStack = []; }
  histCur = now; histSync();
}
const histSchedule = () => { clearTimeout(histTimer); histTimer = setTimeout(histCommit, 250); };
function histApply(st) {
  selectPattern(null); dismissAdd(true);
  lanesEl.querySelectorAll('.lane').forEach(l => {
    const want = (st.pats[l.dataset.track] || []).map(x => ({...x, used: false}));
    [...l.querySelectorAll('.pattern')].forEach(p => {   // pattern yang sudah cocok dibiarkan, hanya yang berbeda diganti
      const s = r4(pl(p) / BAR_W), w = r4(pw(p) / BAR_W), t = p.querySelector('.pattern__title').textContent;
      const m = want.find(x => !x.used && x.s === s && x.w === w && x.t === t && x.c === (p.dataset.clip || '') && x.o === r4(+p.dataset.off || 0) && x.a === (p.dataset.auId || ''));
      if (m) m.used = true; else p.remove();
    });
    want.filter(x => !x.used).forEach(x => {
      const n = createPattern(l, {start: x.s * BAR_W, width: x.w * BAR_W}, x.c ? {clip: +x.c, off: x.o} : null);
      n.querySelector('.pattern__title').textContent = x.t;
      if (x.a) setupAutoEl(n, x.a);   // Automation Clip yang dihapus lalu di-undo: kurvanya masih tersimpan
    });
  });
  histCur = st;   // sudah sama dengan keadaan sekarang, jadi tidak dicatat ulang
}
function histFlush() { if (histTimer) { clearTimeout(histTimer); histCommit(); } }
function histUndo() { histFlush(); if (!undoStack.length) return; redoStack.push(histCur); histApply(undoStack.pop()); histSync(); }
function histRedo() { histFlush(); if (!redoStack.length) return; undoStack.push(histCur); histApply(redoStack.pop()); histSync(); }
const histRelevant = m => {
  if (m.type === 'childList') return [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && (n.classList.contains('pattern') || n.classList.contains('lane')));
  const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
  return !!(t && t.closest('.pattern'));   // abaikan playhead & toolbar yang terus bergerak
};
new MutationObserver(ms => { if (ms.some(histRelevant)) histSchedule(); })
  .observe(lanesEl, {childList: true, subtree: true, attributes: true, attributeFilter: ['style'], characterData: true});
document.addEventListener('pointerdown', () => { histPressed = true; }, true);
['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => { histPressed = false; }, true));
btnUndo.addEventListener('click', () => { histPulse(btnUndo, 'is-tap'); histUndo(); });
btnRedo.addEventListener('click', () => { histPulse(btnRedo, 'is-tap'); histRedo(); });
document.addEventListener('keydown', e => { if (e.key === 'Home' && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toStart(); } });   // ke awal: tombolnya dihapus, pintasan Home tetap ada
document.addEventListener('keydown', e => {   // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z atau Ctrl+Y = redo (saat mengetik nama, biarkan undo bawaan browser)
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? histRedo() : histUndo(); }
  else if (k === 'y') { e.preventDefault(); histRedo(); }
});
histCur = histCapture(); histSync();

initTrackMeters();   // meter level stereo di card track

// ===== Simpan / buka file project (menu kanan atas) =====
// Disimpan: BPM, panjang timeline, track (jenis, nama, warna, volume, on/off), pattern (posisi, lebar, judul), nada piano roll
// (termasuk nada tiap DERIZ), audio clip di timeline, isi tiap plugin DERIZ (audio sample, garis start, zoom, knob, nyala/mati),
// dan sesi plugin MPCS (audio upload, hasil edit nada, knob).
// Juga disimpan: setelan efek tiap track (Reverb, EQ, Filter, Supersaw) dan Automation Clip (kurva + knob yang diotomasi).
const r3p = v => Math.round(v * 1e3) / 1e3;
function projectSnapshot() {
  const clips = {}, tracks = [], seenClips = new Set(), dKeys = new Map();   // dKeys: audio DERIZ -> kunci 'd1', 'd2', ... (audio yang sama dipakai bersama disimpan sekali)
  document.querySelectorAll('.trkcard-wrap').forEach(c => {
    const id = c.dataset.track, lane = lanesEl.querySelector('.lane[data-track="' + id + '"]');
    const sl = c.querySelector('input[type=range]'), pwr = c.querySelector('.trkcard__power');
    const pats = [...(lane ? lane.querySelectorAll('.pattern') : [])].map(p => {
      const o = {s: r3p(pl(p) / BAR_W), w: r3p(pw(p) / BAR_W), t: p.querySelector('.pattern__title').textContent};
      if (p.dataset.clip) {
        o.c = p.dataset.clip; o.o = +p.dataset.off || 0;
        if (!seenClips.has(o.c)) { seenClips.add(o.c); const b = getBuffer(+o.c); if (b) clips[o.c] = encodeWav(b); }
      }
      const pid = p.dataset.prId;
      if (pid) {
        const notes = getPianoRollNotes(pid); if (notes.length) o.n = notes;
        const extra = pianoRollExtraKeys(pid).map(k => {
          const fx = +k.slice(pid.length + 1), tr = fxRack.derizTrackOf(fx);
          return tr === undefined ? null : {tr, i: fxRack.derizIds(tr).indexOf(fx), n: getPianoRollNotes(k)};
        }).filter(Boolean);
        if (extra.length) o.x = extra;
      }
      if (p._sync) {   // Sync all sample: BPM saat sync + Speed catatan tiap DERIZ (id efek tidak tetap antar sesi: disimpan sebagai track + urutan)
        const d = [...p._sync.items].map(([fx, sp]) => { const tr = fxRack.derizTrackOf(fx); return tr === undefined ? null : {tr, i: fxRack.derizIds(tr).indexOf(fx), s: Math.round(sp * 1e4) / 1e4}; }).filter(Boolean);
        if (d.length) o.sy = {b: p._sync.bpm, d};
      }
      if (p.dataset.auId) {   // Automation Clip: titik kurva + knob target (id efek tidak tetap antar sesi, jadi disimpan sebagai jenis + urutan)
        const c = getClip(p.dataset.auId), ref = c && c.target ? fxRack.fxRef(c.target.track, c.target.fxId) : null;
        o.a = exportClip(p.dataset.auId);
        if (ref) o.a.t = {tr: c.target.track, ft: ref.type, fi: ref.i, k: c.target.key};
      }
      return o;
    });
    const dz = fxRack.derizExport(id).map(st => {
      const o = {on: st.on, v: st.v};
      if (st.z) {
        let k = dKeys.get(st.z.buf);
        if (!k) { k = 'd' + (dKeys.size + 1); dKeys.set(st.z.buf, k); clips[k] = encodeWav(st.z.buf); }
        o.z = {k, name: st.z.name, start: st.z.start, zoom: st.z.zoom, view: st.z.view};
      }
      return o;
    });
    const fxs = fxRack.fxExport(id);
    tracks.push({
      id, ins: c.dataset.ins || 'Audio clip', name: document.getElementById('track-name-' + id).textContent,
      color: c.style.getPropertyValue('--track-color'), vol: sl ? +sl.value : 100,
      off: !!pwr && pwr.getAttribute('aria-checked') === 'false', deriz: fxRack.derizIds(id).length, pats,
      ...(dz.some(x => x.z) ? {dz} : {}),
      ...(fxs.length ? {fx: fxs} : {}),
    });
  });
  const mp = mpcsExport();   // sesi plugin MPCS (audio upload + hasil edit nada + knob): satu per project
  if (mp) clips.mpcs = encodeWav(mp.buf);
  const mg = mgchordExport();   // sesi plugin MGCHORD (scale, voicing, progression): satu per project
  return {data: {v: 1, bpm: BPM, bars: BARS, ...(mp ? {mpcs: mp.data} : {}), ...(mg ? {mgchord: mg} : {}), ...(getMasterPitch() ? {mp: getMasterPitch()} : {}), ...(getNoteColor() ? {nc: getNoteColor()} : {}), tracks}, clips};
}
function clearProject() {
  if (playing) pausePlay();
  stopAllSynth(); stopClips(actx); selectPattern(null); dismissAdd(true); closeKbd();
  document.querySelectorAll('.trkcard-wrap').forEach(c => {
    const lane = lanesEl.querySelector('.lane[data-track="' + c.dataset.track + '"]');
    stopTrack(actx, c.dataset.track); fxRack.drop(c.dataset.track);
    if (lane) lane.remove(); c.remove();
  });
  selTrack = null;
}
async function projectRestore(rec) {
  const d = rec.data; if (!d || d.v !== 1) throw new Error('format project tidak dikenal');
  const ctx = audio(), clipMap = {}, dBufs = {};
  let mpcsBuf = null;
  for (const [k, blob] of Object.entries(rec.clips || {})) {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (k === 'mpcs') mpcsBuf = buf;   // audio sesi MPCS
    else if (k[0] === 'd') dBufs[k] = buf;   // audio sample DERIZ (bukan clip timeline)
    else clipMap[k] = addBuffer(buf);
  }
  clearProject();
  mpcsImport(mpcsBuf && d.mpcs ? mpcsBuf : null, d.mpcs).catch(console.error);
  mgchordImport(d.mgchord);   // null = bawaan (project tanpa MGCHORD)   // analisis jalan di latar; tidak menahan pembukaan project
  setBpm(d.bpm || 120);
  setMasterPitch(+d.mp || 0);   // Pitch Project ikut tersimpan di file project
  setNoteColor(typeof d.nc === 'string' ? d.nc : null);   // warna nada piano roll (pilihan Color) ikut tersimpan di file project
  if (d.bars > BARS) growTimeline(Math.min(MAX_BARS, d.bars));
  const trMap = {}, pending = [], pendingAuto = [];
  for (const t of d.tracks || []) {
    t.name = t.name || t.ins || 'Track'; t.vol = Number.isFinite(+t.vol) && t.vol !== null && t.vol !== '' ? +t.vol : 100;   // project lama / rusak: nama & volume tidak boleh jadi "undefined"
    addTrack({n: t.ins, c: t.color || COLORS[0]});
    const id = String(trackSeq); trMap[t.id] = id;
    const cont = document.querySelector('.trkcard-wrap[data-track="' + id + '"]'), lane = lanesEl.querySelector('.lane[data-track="' + id + '"]');
    document.getElementById('track-name-' + id).textContent = t.name;
    cont.querySelector('.trkcard__title-btn').title = t.name;
    const sl = cont.querySelector('input[type=range]');
    if (sl) { sl.setAttribute('aria-label', 'Volume, ' + t.name); sl.value = t.vol; sl.dispatchEvent(new Event('input', {bubbles: true})); }
    panTip.hidden = true;
    while (fxRack.derizIds(id).length < (t.deriz || 0)) { const n = fxRack.derizIds(id).length; if (n === 0) fxRack.addInstrument(id, 'deriz'); else fxRack.addDeriz(id); if (fxRack.derizIds(id).length === n) break; }   // DERIZ pertama = bawaan track, sisanya (hasil Duplicate / ditambah dari daftar efek) lewat addDeriz
    (t.dz || []).forEach((st, i) => {   // isi DERIZ: audio sample, garis start, zoom, knob
      const z = st.z && dBufs[st.z.k];
      fxRack.derizImport(id, i, {on: st.on !== false, v: st.v || {}, ...(z ? {z: {name: st.z.name, start: st.z.start || 0, zoom: st.z.zoom || 1, view: st.z.view || 0, buf: z}} : {})});
    });
    if (t.fx && t.fx.length) fxRack.fxImport(id, t.fx);   // Reverb / EQ / Filter / Supersaw: jenis, nyala, nilai knob
    if (t.off) cont.querySelector('.trkcard__power').click();
    for (const p of t.pats || []) {
      const el = createPattern(lane, {start: p.s * BAR_W, width: p.w * BAR_W}, p.c && clipMap[p.c] ? {clip: clipMap[p.c], off: p.o || 0} : null);
      el.querySelector('.pattern__title').textContent = p.t == null ? '' : p.t;
      if (p.a) pendingAuto.push({el, a: p.a});
      if (p.n || p.x) { el.dataset.prId = 'pat' + (++prSeq); pending.push({el, p}); }
    }
  }
  for (const {el, p} of pending) {
    const pid = el.dataset.prId;
    if (p.n) setPianoRollNotes(pid, p.n);
    for (const x of p.x || []) {
      const tr = trMap[x.tr], fx = tr && fxRack.derizIds(tr)[x.i];
      if (fx !== undefined) setPianoRollNotes(pid + '@' + fx, x.n);
    }
    renderPatNotes(el);
    if (p.sy && p.sy.d) {   // Sync all sample: pasang lagi catatan Speed ke DERIZ yang sudah dipulihkan
      const items = new Map();
      for (const x of p.sy.d) { const tr = trMap[x.tr], fx = tr && fxRack.derizIds(tr)[x.i]; if (fx !== undefined && x.s > 0) items.set(fx, x.s); }
      if (items.size && p.sy.b > 0) { el._sync = {bpm: p.sy.b, items}; el.dataset.sync = '1'; }
    }
  }
  for (const {el, a} of pendingAuto) {   // Automation Clip: knob target dicari lagi lewat track + jenis efek + urutannya
    const tr = a.t && trMap[a.t.tr], fx = tr !== undefined ? fxRack.fxFind(tr, a.t.ft, a.t.fi) : undefined;
    setupAutoEl(el, importClip(fx !== undefined ? {track: tr, fxId: fx, key: a.t.k} : null, a));
  }
  const first = document.querySelector('.trkcard-wrap');
  if (first) selectTrack(first);
  toStart(); syncWaves(); metroUI && metroUI.sync && metroUI.sync();
  undoStack = []; redoStack = []; histCur = histCapture(); histSync();
}
if (!DEMO) setProjectIO({snapshot: projectSnapshot, restore: projectRestore, toast});   // DEMO: tidak dipasang, jadi projectSnapshot / projectRestore tidak ikut di bundel demo

// ===== Export audio: merekam keluaran master selama project diputar dari bar 1 (lihat export-audio.ts) =====
const contentEndBar = () => {   // ujung kanan clip / pattern paling akhir di timeline, dalam bar
  let m = 0;
  lanesEl.querySelectorAll('.pattern[data-clip], .pattern[data-pr-id]').forEach(p => { m = Math.max(m, (pl(p) + pw(p)) / BAR_W); });
  return Math.min(m, BARS);
};
// SPECTRUM: membaca keluaran master yang sama (setelah pengaman clipping), jadi gambarnya persis yang terdengar
setSpectrumBridge({tap: () => { audio(); return guardOut; }});
restoreSpectrum();   // kalau terakhir dinyalakan di Pengaturan, strip muncul lagi setelah sentuhan pertama
let expSaved = null;
setExportIO({
  ctx: () => audio(),
  tap: () => guardOut,
  contentSec: () => contentEndBar() * SEC_PER_BAR,
  begin() {
    expSaved = {pos: posBars, mark: startMark, on: metro.on, ci: metro.countIn};
    pausePlay(); posBars = 0; metro.on = false; metro.countIn = false;   // tanpa metronome dan count-in
    startPlay();
    return startCtx;
  },
  isPlaying: () => playing,
  nowSec: () => actx.currentTime - startCtx,
  end() {   // aman dipanggil berulang
    if (playing) pausePlay();
    if (expSaved) { posBars = expSaved.pos; startMark = expSaved.mark; metro.on = expSaved.on; metro.countIn = expSaved.ci; expSaved = null; renderPlayhead(); }
  },
  toast,
});
initTutorial();   // tombol gelembung chat + tutorial langkah demi langkah (semua menu)
demoMount();   // DEMO: lencana + jendela info (tidak ada efek di build penuh)
