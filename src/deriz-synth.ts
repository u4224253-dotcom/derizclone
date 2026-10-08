// Sampler DERIZ: nada (tuts + knob Pitch) dan kecepatan (knob Speed) dikendalikan TERPISAH.
// Tuts apa pun tetap memutar sample dengan kecepatan yang sama; hanya knob Speed yang mengubah kecepatan.
//
// Algoritma (jalan di AudioWorklet, polifonik):
//   1. Time-stretch WSOLA (waveform similarity overlap-add) dengan overlap 75%, jendela Hann ternormalisasi.
//      Posisi tiap frame dicari (kasar -> halus -> SUB-SAMPEL, korelasi silang ternormalisasi pada mono, templat 3 hop)
//      yang paling nyambung dengan lanjutan alami frame sebelumnya. Penyelarasan pecahan sampel penting untuk nada tinggi:
//      periode gelombang jarang bulat, dan galat pembulatan membuat harmonik atas bergeser fase di tiap sambungan (terdengar kasar / robot).
//      Panjang frame menyesuaikan nada: rendah = lebih panjang (memuat beberapa periode); tinggi = lebih panjang juga
//      (hop frame setelah di-resample naik tidak menjadi dengung).
//   2. Penjaga transien: awal ketukan / petikan (onset) dideteksi dari lonjakan energi. Saat stretch, onset TIDAK ikut
//      diulang atau melebar: frame dipotong tepat sebelum onset, lalu dimulai ulang tepat di onset dengan crossfade 2 ms.
//   3. Pitch shift: hasil stretch dibaca ulang pada laju = rasioNada (rasioNada = 2^((tuts - C4 + Pitch) / 12)).
//      Nada turun: interpolasi Hermite 4 titik. Nada NAIK: kernel sinc berjendela Blackman (16 lobus) dengan frekuensi potong
//      0.85/rasio, jadi low-pass terjadi SEBELUM decimate dan harmonik atas tidak terlipat (aliasing) melewati Nyquist.
//   4. Limiter lembut di keluaran supaya akor (banyak nada sekaligus) tidak pecah.
//
// Pesan ke prosesor: buf (data sample), on / off (nada), p (parameter live), kill (hentikan semua).

export const WORKLET_SRC = `
// Scope worklet dipakai bersama oleh SEMUA plugin DERIZ dalam satu AudioContext, jadi tiga variabel ini berlaku lintas plugin.
// FULL_FRAMES: jatah frame WSOLA berkualitas penuh per blok audio (semua plugin digabung). Di atas jatah, frame yang tetap wajib dibuat
// memakai pencarian ringan (tanpa penyelarasan sub-sampel, ~40% lebih murah) dan prefetch dilewati: kualitas turun sedikit,
// bukan gresek / putus. Di bawah jatah hasilnya identik dengan sebelumnya.
// MAX_VOICES: batas nada aktif per plugin (nada paling tua / yang sudah dilepas dilepas cepat 4 ms bila terlampaui).
const FULL_FRAMES = 4, MAX_VOICES = 12;
let gT = -1, gUsed = 0;
// ---- Statistik debug (Pengaturan > Debug Audio). Mati = hanya satu cek boolean per blok, hasil suara TIDAK berubah. ----
// Satu objek G untuk semua plugin DERIZ dalam AudioContext ini; dikirim ke main thread tiap 0,5 detik (selisihnya saja, lalu direset).
// Waktu: performance.now() kalau ada di scope worklet; kalau tidak, Date.now() (resolusi 1 ms, CLK_RES = 1) dan 'telat' hanya dihitung bila PASTI lewat jatah.
const HAS_PERF = typeof performance !== 'undefined' && !!performance.now, CLK_RES = HAS_PERF ? 0 : 1;
const clk = HAS_PERF ? () => performance.now() : () => Date.now();
const G = { on: false, cur: 0, act: false, vc: 0, ia: 0, nextRep: 0 };
function gClear() {
  G.n = 0; G.sum = 0; G.max = 0; G.maxAt = 0; G.late = 0; G.vmax = 0; G.iamax = 0;   // blok: jumlah aktif, total ms, terberat (ms + waktu), jumlah > jatah, voice / plugin aktif tertinggi
  G.full = 0; G.light = 0; G.hit = 0;                                                  // frame WSOLA: penuh / ringan / dari cache
  G.nOn = 0; G.nLate = 0; G.ltSum = 0; G.ltMax = 0;                                    // nada terjadwal: total, telat (> 6 ms), jumlah + terlama
  G.stealH = 0; G.stealT = 0; G.noBuf = 0; G.penDrop = 0;                              // nada ditahan yang dipotong, ekor yang dipercepat, nada tanpa sample, jadwal terhapus
  G.trN = 0; G.trSlow = 0; G.trMax = 0; G.lateSkip = 0;
  G.spK = 0; G.spO = 0; G.pcK = 0; G.pcO = 0; G.spFrom = 0; G.spTo = 0;               // Speed / Pitch di worklet berubah nilainya: K = lewat knob (pesan p), O = dibawa nada (on); O = tidak diharapkan kalau knob tidak disentuh
                                             // pesan nada main thread -> worklet: jumlah, yang tiba > 100 ms setelah dikirim, tertunda terlama (ms)
}
gClear();
function finBlock(self) {
  if (G.act) {
    const bud = 128 / sampleRate * 1000;
    G.n++; G.sum += G.cur;
    if (G.cur > G.max) { G.max = G.cur; G.maxAt = gT; }
    if (G.cur - CLK_RES > bud) G.late++;
    if (G.vc > G.vmax) G.vmax = G.vc;
    if (G.ia > G.iamax) G.iamax = G.ia;
  }
  G.cur = 0; G.act = false; G.vc = 0; G.ia = 0;
  if (gT >= G.nextRep) {
    G.nextRep = gT + 0.5;
    if (G.n || G.nOn || G.noBuf || G.penDrop || G.stealH || G.stealT || G.trN || G.lateSkip || G.spK || G.spO || G.pcK || G.pcO) {
      self.port.postMessage({ t: 'st', ct: gT, tr: CLK_RES, bud: 128 / sampleRate * 1000, n: G.n, sum: G.sum, max: G.max, maxAt: G.maxAt, late: G.late, vmax: G.vmax, iamax: G.iamax,
        full: G.full, light: G.light, hit: G.hit, nOn: G.nOn, nLate: G.nLate, ltSum: G.ltSum, ltMax: G.ltMax, stealH: G.stealH, stealT: G.stealT, noBuf: G.noBuf, penDrop: G.penDrop, trN: G.trN, trSlow: G.trSlow, trMax: G.trMax, lateSkip: G.lateSkip, spK: G.spK, spO: G.spO, pcK: G.pcK, pcO: G.pcO, spFrom: G.spFrom, spTo: G.spTo });
      gClear();
    }
  }
}
class DerizSampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pStamp = 0; this.seq = 0; this.fastK = Math.exp(-1 / (0.004 * sampleRate));   // pStamp: nomor versi parameter live (lihat msg / apply)
    this.ch = null; this.mono = null; this.len = 0; this.bufRate = sampleRate; this.ons = [];
    this.wins = new Map();
    // tabel kernel sinc berjendela Blackman (HW lobus tiap sisi, TR entri per lobus) untuk resampling anti-alias saat nada naik
    this.HW = 8; this.TR = 512;
    const tn = this.HW * this.TR + 2; this.sinc = new Float32Array(tn);
    for (let i = 0; i < tn; i++) {
      const x = i / this.TR, px = Math.PI * x, sc = x < 1e-9 ? 1 : Math.sin(px) / px, u = x / this.HW;
      this.sinc[i] = u >= 1 ? 0 : sc * (0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u));
    }
    this.voices = [];
    this.sq = []; this.si = 0; this.lag = new Map();   // jadwal lengkap dari main thread (pesan 'sched'): terurut waktu, dijalankan lewat jam audio; lag: id nada -> telat berapa detik saat mulai
    this.pend = [];   // perintah on / off yang dijadwalkan di waktu AudioContext tertentu (piano roll)
    this.speed = 1; this.pitch = 0; this.vol = 0.9; this.volS = 0.9;
    this.PF = 2;   // jatah frame prefetch per blok audio (di luar frame yang wajib)
    this.clean = []; this.dirty = []; this.POOL = 16;   // kolam ring buffer voice: disiapkan di blok senggang, bukan saat nada ditekan
    this.st = new Float64Array(65536 * 5);   // cache hasil search()
    this.port.onmessage = e => this.msg(e.data);
  }
  msg(m) {
    if (m.t === 'dbg') { G.on = !!m.on; gClear(); G.cur = 0; G.act = false; G.nextRep = 0; }
    else if (m.t === 'buf') { if (G.on) G.penDrop += this.pend.length + (this.sq.length - this.si); this.pend = []; this.sq = []; this.si = 0; this.lag.clear(); this.setBuf(m); }
    else if (m.t === 'sched') {   // seluruh jadwal nada sekaligus: tidak ada lagi pesan per nada yang bisa nyangkut di jalan
      const ev = m.ev; for (let i = 0; i < ev.length; i++) if (ev[i].t === 'on') ev[i].ps = this.pStamp;
      if (G.on && m.sent !== undefined) { const tr = (currentTime - m.sent) * 1000; G.trN++; if (tr > 100) G.trSlow++; if (tr > G.trMax) G.trMax = tr; }
      this.sq = ev; this.si = 0; this.lag.clear();
    }
    else if (m.t === 'on' || m.t === 'off' || m.t === 'glide') {
      if (m.t === 'on') m.ps = this.pStamp;   // versi parameter saat nada ini diterima
      if (G.on && m.t === 'on' && m.sent !== undefined) { const tr = (currentTime - m.sent) * 1000; G.trN++; if (tr > 100) G.trSlow++; if (tr > G.trMax) G.trMax = tr; }   // berapa lama pesan ini di jalan dari main thread sampai diproses worklet (jam AudioContext yang sama)
      if (m.at && m.at > currentTime) this.pend.push(m); else this.apply(m);
    }
    else if (m.t === 'p') { this.pStamp++; this.setPar(m, 0); }
    else if (m.t === 'relall') { this.pend = []; this.sq = []; this.si = 0; this.lag.clear(); for (const v of this.voices) v.rel = true; }
    else if (m.t === 'kill') { this.recycleAll(); this.pend = []; this.sq = []; this.si = 0; this.lag.clear(); }
  }
  // satu-satunya tempat Speed / Pitch / Volume worklet berubah (statistik Debug Audio: siapa yang mengubahnya, knob atau nada)
  setPar(m, viaNote) {
    if (G.on && this.seen) {
      if (m.speed !== this.speed) { if (viaNote) G.spO++; else G.spK++; G.spFrom = this.speed; G.spTo = m.speed; }
      if (m.pitch !== this.pitch) { if (viaNote) G.pcO++; else G.pcK++; }
    }
    this.seen = true; this.speed = m.speed; this.pitch = m.pitch; this.vol = m.vol;
  }
  apply(m) {
    if (m.t === 'on') {
      // parameter yang dibawa nada ini sudah usang kalau knob diputar (pesan 'p') setelah nada diterima: jangan menimpa nilai yang lebih baru
      if (m.ps === this.pStamp) this.setPar(m, 1);
      if (G.on && m.at) { G.nOn++; const lt = (currentTime - m.at) * 1000; if (lt > 6) { G.nLate++; G.ltSum += lt; if (lt > G.ltMax) G.ltMax = lt; } }   // nada terjadwal baru diproses > 6 ms setelah waktunya
      this.start(m);
    }
    else if (m.t === 'glide') { for (const v of this.voices) if (v.id === m.id) { v.gf = v.semis; v.gt = m.semis; v.g0 = m.at || currentTime; v.gd = Math.max(0.005, m.dur); } }
    else { for (const v of this.voices) if (v.id === m.id) v.rel = true; }
  }
  // jalankan perintah terjadwal yang jatuh tempo di blok audio ini (ketelitian satu blok = 128 sampel, sekitar 2,7 ms)
  flush() {
    if (this.si < this.sq.length) {
      const lim = currentTime + 128 / sampleRate, sq = this.sq;
      while (this.si < sq.length && sq[this.si].at <= lim) this.fire(sq[this.si++]);
      if (this.si >= sq.length) { this.sq = []; this.si = 0; }
    }
    if (!this.pend.length) return;
    const lim = currentTime + 128 / sampleRate, due = [], rest = [];
    for (const m of this.pend) (m.at <= lim ? due : rest).push(m);
    if (due.length) { this.pend = rest; for (const m of due) this.apply(m); }
  }
  // nada dari jadwal lengkap. Telat (blok terlewat / thread audio tersendat): nada tetap dimainkan tapi lepas-nya ikut bergeser sebesar telatnya,
  // jadi panjang nada terjaga (tidak 'dimulai dan langsung dilepas' = tidak bunyi, dan tidak menumpuk di satu titik). Telat >= panjang nada: dilewati.
  fire(m) {
    const lt = currentTime - m.at;
    if (m.t === 'on') {
      if (lt > 0.006) { if (lt >= m.dur) { if (G.on) G.lateSkip++; return; } this.lag.set(m.id, lt); }
      this.apply(m); return;
    }
    const sh = this.lag.get(m.id);
    if (sh && !m.sh) {
      if (m.t === 'off') this.lag.delete(m.id);
      const m2 = Object.assign({}, m, { at: m.at + sh, sh: 1 });
      if (m2.at > currentTime + 128 / sampleRate) { let i = this.sq.length; while (i > this.si && this.sq[i - 1].at > m2.at) i--; this.sq.splice(i, 0, m2); return; }
      m = m2;
    }
    this.apply(m);
  }
  setBuf(m) {
    // Semua pekerjaan berat (padding, mix mono, deteksi onset) sudah dikerjakan di main thread (DerizSynth.setBuffer): di sini hanya menyimpan,
    // supaya memuat sample tidak menahan thread audio puluhan ms (yang dulu membuat SEMUA suara putus).
    this.bufRate = m.rate; this.wins.clear(); this.st.fill(0); this.recycleAll();
    this.ch = m.ch; this.len = this.ch[0].length; this.mono = m.mono; this.ons = m.ons;
  }
  // jendela per ukuran frame: W = Hann ternormalisasi (jumlah 4 geseran = 1), S = jendela awal (sama dengan kondisi tunak tapi tanpa frame sebelumnya)
  getWin(N) {
    let w = this.wins.get(N);
    if (w) return w;
    const Hs = N >> 2, W = new Float32Array(N), S = new Float32Array(N);
    for (let i = 0; i < N; i++) W[i] = (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)) * 0.5;
    for (let k = 0; k < 4; k++) for (let j = 0; j < Hs; j++) { let s = 0; for (let m = k; m < 4; m++) s += W[m * Hs + j]; S[k * Hs + j] = s; }
    w = { W, S }; this.wins.set(N, w); return w;
  }
  start(m) {
    if (!this.ch) { if (G.on) G.noBuf++; return; }   // sample belum sampai: nada ini hilang
    const rate = this.bufRate, size = 1 << 15;
    const P0 = Math.pow(2, (m.semis + this.pitch) / 12);
    const dur = P0 < 1 ? 0.04 / Math.sqrt(P0) : 0.04 * Math.pow(P0, 0.35);   // rendah: muat beberapa periode; tinggi: hop lebih panjang supaya modulasi frame (x rasio nada) tidak jadi dengung
    const N = 4 * Math.max(8, Math.round(Math.min(0.085, Math.max(0.03, dur)) * rate / 4));
    const start = Math.max(0, m.start);
    let oi = 0; while (oi < this.ons.length && this.ons[oi] < start + 0.01 * rate) oi++;   // onset persis di awal = bagian dari frame pertama
    // batas polifoni: lewat MAX_VOICES, nada yang sudah dilepas (lalu yang paling tua) dilepas cepat (4 ms) supaya tidak klik dan tidak ikut membebani
    let live = 0; for (const x of this.voices) if (!x.fast) live++;
    while (live >= MAX_VOICES) {
      let vic = null;
      for (const x of this.voices) if (!x.fast && (!vic || (x.rel && !vic.rel) || (x.rel === vic.rel && x.age < vic.age))) vic = x;
      if (!vic) break;
      if (G.on) { if (vic.rel) G.stealT++; else G.stealH++; }   // H = nada yang masih ditahan terpotong (terdengar 'tidak bunyi'), T = ekor nada yang sudah dilepas
      vic.rel = true; vic.fast = true; vic.relK = this.fastK; live--;
    }
    this.voices.push({
      id: m.id, semis: m.semis, N: N, nom: start, prev: 0, first: true, last: false, oi: oi, age: ++this.seq, fast: false,
      w: 0, cEnd: 0, vEnd: 0, rd: 0, rho: P0 * rate / sampleRate, size: size,
      T: this.takeRing(size),
      env: 0, rel: false, atk: 1 / (0.002 * sampleRate), relK: Math.exp(-1 / (0.04 * sampleRate)),
      vel: m.vel === undefined ? 1 : m.vel   // velocity per nada (penguatan 0..1), terpisah dari knob Volume yang berlaku untuk semua nada
    });
  }
  // interpolasi kubik (Catmull-Rom) pada array x di posisi pecahan pos (batas dijaga)
  cub(x, pos) {
    const L = x.length, i = Math.floor(pos), f = pos - i;
    const xm = x[i > 0 ? i - 1 : 0], x0 = x[i], x1 = x[i + 1 < L ? i + 1 : L - 1], x2 = x[i + 2 < L ? i + 2 : L - 1];
    return ((((x2 - xm) * 0.5 + (x0 - x1) * 1.5) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + (x1 - xm) * 0.5) * f + x0;
  }
  // cari posisi frame terbaik di sekitar c0: kasar (langkah 16, stride 8) lalu halus (langkah 1, stride 4), korelasi silang ternormalisasi,
  // lalu SUB-SAMPEL (parabola di puncak korelasi). Hasil: this.fr = bagian pecahan (-0.5..0.5), return = bagian bulat.
  // Templat = lanjutan alami frame sebelumnya (posisi pecahan tp) sepanjang 3 hop; ada sedikit bias ke posisi nominal
  // supaya posisi tidak melompat antar periode yang sama bagusnya (mengurangi flutter).
  // Cache hasil pencarian: search0 adalah fungsi MURNI dari (c0, tp, N) dan sample, jadi nada yang sama diputar ulang
  // (pola berulang / loop) menghasilkan urutan frame yang persis sama dan tidak perlu mencari lagi. Hasil identik bit-per-bit.
  // Tabel hash langsung (direct-mapped) di typed array: tanpa alokasi di thread audio. Per slot: [tp, c0, c, fr, N].
  // light = true (anggaran frame penuh blok ini habis): pencarian tanpa langkah sub-sampel, dan hasilnya TIDAK disimpan di cache
  // (cache hanya berisi hasil kualitas penuh, jadi nada yang sama kelak tetap mendapat hasil penuh yang identik).
  search(c0, tp, N, Hs, light) {
    const t = this.st, h = (((Math.imul(c0, 73856093) ^ Math.imul((tp * 64) | 0, 19349663) ^ Math.imul(N, 83492791)) >>> 0) & 65535) * 5;
    if (t[h + 4] === N && t[h] === tp && t[h + 1] === c0) { if (G.on) G.hit++; this.fr = t[h + 3]; return t[h + 2]; }   // cache kena: hampir gratis, tidak memakai anggaran
    gUsed++;
    if (light) { if (G.on) G.light++; return this.search0(c0, tp, N, Hs, true); }
    if (G.on) G.full++;
    const c = this.search0(c0, tp, N, Hs, false);
    t[h] = tp; t[h + 1] = c0; t[h + 2] = c; t[h + 3] = this.fr; t[h + 4] = N;
    return c;
  }
  search0(c0, tp, N, Hs, light) {
    const x = this.mono, L = this.len, maxC = L - N, W = Hs;
    this.fr = 0;
    const tI = Math.floor(tp), tf = tp - tI;
    let M = 3 * Hs; if (tI + M + 3 > L) M = L - tI - 3;
    const cc = Math.max(0, Math.min(maxC, c0));
    if (M < Hs) return cc;
    if (!this.tm || this.tm.length < M) this.tm = new Float32Array(M + 64);
    const tm = this.tm;
    if (tf < 1e-4) for (let j = 0; j < M; j++) tm[j] = x[tI + j];
    else for (let j = 0; j < M; j++) { const q = tI + j; tm[j] = this.cub(x, q + tf); }
    const lo = Math.max(0, c0 - W), hi = Math.min(maxC, c0 + W);
    const score = (cand, step) => {
      let dot = 0, en = 1e-9;
      for (let j = 0; j < M; j += step) { const s = x[cand + j]; dot += s * tm[j]; en += s * s; }
      return dot / Math.sqrt(en);
    };
    const bias = (cand) => 1 - 0.06 * Math.abs(cand - c0) / W;
    let best = -1e30, bc = cc;
    for (let cand = lo; cand <= hi; cand += 16) { const sc = score(cand, 8) * bias(cand); if (sc > best) { best = sc; bc = cand; } }
    best = -1e30; let fc = bc;
    for (let cand = Math.max(lo, bc - 16); cand <= Math.min(hi, bc + 16); cand++) { const sc = score(cand, 4) * bias(cand); if (sc > best) { best = sc; fc = cand; } }
    if (!light && fc > 1 && fc < maxC - 3) {
      // sub-sampel: skor langsung di posisi pecahan (interpolasi kubik), bagi dua lima kali (resolusi akhir ~1/32 sampel)
      const scoreF = (pos, st) => {
        const b0 = Math.floor(pos), f = pos - b0, f2 = f * f, f3 = f2 * f;
        const k0 = -0.5 * f3 + f2 - 0.5 * f, k1 = 1.5 * f3 - 2.5 * f2 + 1, k2 = -1.5 * f3 + 2 * f2 + 0.5 * f, k3 = 0.5 * f3 - 0.5 * f2;
        let dot = 0, en = 1e-9;
        for (let j = 0; j < M; j += st) { const q = b0 + j, s = k0 * x[q - 1] + k1 * x[q] + k2 * x[q + 1] + k3 * x[q + 2]; dot += s * tm[j]; en += s * s; }
        return dot / Math.sqrt(en);
      };
      let pc = fc, ps = scoreF(fc, 2), step = 0.5;
      for (let it = 0; it < 5; it++) {
        const st = it < 3 ? 2 : 1;
        if (it === 3) ps = scoreF(pc, 1);
        const a1 = scoreF(pc - step, st), a2 = scoreF(pc + step, st);
        if (a1 > ps && a1 >= a2) { ps = a1; pc -= step; } else if (a2 > ps) { ps = a2; pc += step; }
        step *= 0.5;
      }
      const fr = pc - fc; if (fr > -0.75 && fr < 0.75) this.fr = fr;
    }
    return fc;
  }
  // ---- kolam ring buffer voice: tanpa alokasi 256 KB per nada di tengah audio ----
  takeRing(size) {
    const r = this.clean.length ? this.clean.pop() : null;
    return r && r[0].length === size ? r : [new Float32Array(size), new Float32Array(size)];   // kolam kosong: alokasi seperti dulu
  }
  recycle(v) { if (this.clean.length + this.dirty.length < 2 * this.POOL) this.dirty.push(v.T); }
  recycleAll() { for (const v of this.voices) this.recycle(v); this.voices = []; }
  // satu langkah perawatan per blok senggang: bersihkan satu buffer bekas (harus nol lagi: ujung kiri sinc dibaca sebagai nol), atau isi kolam sampai POOL
  idle() {
    if (this.dirty.length) { const r = this.dirty.pop(); r[0].fill(0); r[1].fill(0); this.clean.push(r); }
    else if (this.clean.length < this.POOL) this.clean.push([new Float32Array(1 << 15), new Float32Array(1 << 15)]);
  }
  // apakah frame berikutnya voice ini adalah "mulai ulang di onset"? Frame itu bergantung pada posisi pembaca (v.rd),
  // jadi tidak boleh disiapkan lebih awal supaya hasilnya sama persis dengan penghitungan tepat waktu.
  restartNext(v) {
    if (v.first) return false;
    const ons = this.ons, pre = Math.round(0.0015 * this.bufRate);
    const nom = v.nom + (v.N >> 2) * (this.speed / Math.pow(2, (v.semis + this.pitch) / 12));
    let oi = v.oi;
    while (oi + 1 < ons.length && ons[oi + 1] - pre <= nom) oi++;
    return oi < ons.length && ons[oi] - pre <= nom;
  }
  frameBuf(N) {
    if (!this.fbs || this.fbs[0].length < N) this.fbs = [new Float32Array(N), new Float32Array(N)];
    return this.fbs;
  }
  // satu frame WSOLA ke buffer T milik voice
  gen(v) {
    const N = v.N, Hs = N >> 2, L = this.len, ons = this.ons, mask = v.size - 1;
    const rate = this.bufRate, pre = Math.round(0.0015 * rate), K = Math.round(0.002 * rate);
    const { W, S } = this.getWin(N);
    const P = Math.pow(2, (v.semis + this.pitch) / 12), a = this.speed / P;   // a = maju di sample per frame sintesis (satuan sample)
    const maxC = L - N;
    let c, fr = 0, mode = 0;   // 0 normal, 1 frame pertama, 2 mulai ulang di onset
    if (v.first) { c = Math.min(maxC, Math.round(v.nom)); mode = 1; }
    else {
      v.nom += Hs * a;
      while (v.oi + 1 < ons.length && ons[v.oi + 1] - pre <= v.nom) v.oi++;   // onset yang terlewati sekaligus: ambil yang terakhir
      if (v.oi < ons.length && ons[v.oi] - pre <= v.nom) {
        c = Math.max(0, Math.min(maxC, ons[v.oi] - pre)); v.nom = c; v.oi++; mode = 2;
      } else {
        c = this.search(Math.round(v.nom), v.prev + Hs, N, Hs, gUsed >= FULL_FRAMES); fr = this.fr;   // anggaran frame penuh per blok dibagi semua plugin
        if (v.oi < ons.length) { const cm = ons[v.oi] - pre - 1; if (c + (fr < 0 ? -1 : 0) + N + 3 > cm + N) { /* dekat onset */ } if (c > cm) { c = cm; fr = 0; } }
        if (c < 0) { c = 0; fr = 0; }
        if (c < 3 || c + N + 4 >= L) fr = 0;   // pinggir sample: tanpa pecahan
      }
    }
    // frame sumber dengan posisi pecahan c+fr (interpolasi kubik); tanpa pecahan = salinan langsung
    const fb = this.frameBuf(N);
    for (let q = 0; q < 2; q++) {
      const src = this.ch[q] || this.ch[0], o = fb[q];
      if (fr === 0) { for (let i = 0; i < N; i++) o[i] = src[c + i]; }
      else {
        const b0 = fr < 0 ? c - 1 : c, f = fr < 0 ? 1 + fr : fr, f2 = f * f, f3 = f2 * f;
        const k0 = -0.5 * f3 + f2 - 0.5 * f, k1 = 1.5 * f3 - 2.5 * f2 + 1, k2 = -1.5 * f3 + 2 * f2 + 0.5 * f, k3 = 0.5 * f3 - 0.5 * f2;
        for (let i = 0; i < N; i++) { const j = b0 + i; o[i] = k0 * src[j - 1] + k1 * src[j] + k2 * src[j + 1] + k3 * src[j + 2]; }
      }
    }
    // potong frame tepat sebelum onset berikutnya supaya serangan tidak bocor lebih awal / terulang
    let lim = N;
    if (v.oi < ons.length && ons[v.oi] - pre > c && ons[v.oi] - pre < c + N) lim = ons[v.oi] - pre - c;
    const taper = (i) => (lim >= N || i < lim - K) ? 1 : (i >= lim ? 0 : (lim - i) / K);
    let wpos = v.w;
    if (mode === 2) {
      // posisi tulis: sambung tepat di ujung isi valid (tanpa celah), tapi tidak mundur melewati pembaca
      const rdC = Math.min(v.w, Math.ceil(v.rd));
      wpos = Math.max(Math.min(v.w, v.vEnd - K), rdC);
      const oldEnd = Math.max(wpos + N, v.w - Hs + N);
      for (let q = 0; q < 2; q++) {
        const T = v.T[q];
        for (let i = 0; i < K; i++) T[(wpos + i) & mask] *= 1 - i / K;
        for (let i = K; i < oldEnd - wpos; i++) T[(wpos + i) & mask] = 0;
      }
      v.vEnd = 0;
    }
    for (let q = 0; q < 2; q++) {
      const src = fb[q], T = v.T[q];
      if (mode === 1) {
        for (let i = 0; i < N; i++) T[(wpos + i) & mask] = src[i] * S[i] * taper(i);
      } else if (mode === 2) {
        for (let i = 0; i < K; i++) T[(wpos + i) & mask] += src[i] * S[i] * taper(i) * (i / K);
        for (let i = K; i < N; i++) T[(wpos + i) & mask] = src[i] * S[i] * taper(i);
      } else {
        const add = N - Hs;
        for (let i = 0; i < add; i++) T[(wpos + i) & mask] += src[i] * W[i] * taper(i);
        for (let i = add; i < N; i++) T[(wpos + i) & mask] = src[i] * W[i] * taper(i);
      }
    }
    v.prev = c + fr; v.first = false;
    v.vEnd = Math.max(v.vEnd, wpos + Math.min(N, lim));
    v.w = wpos + Hs; v.cEnd = wpos + Hs;
    if (c >= maxC || v.nom >= maxC) { v.last = true; v.cEnd = wpos + N; }   // sample habis: sisa ekor ikut dimainkan (sudah memudar)
  }
  process(inputs, outputs) {
    if (!G.on) return this.run(inputs, outputs);
    if (currentTime !== gT) finBlock(this);   // blok baru: tutup hitungan blok sebelumnya (dan kirim laporan kalau sudah 0,5 detik)
    const had = this.voices.length > 0, t0 = clk();
    const r = this.run(inputs, outputs);
    if (had || this.voices.length) { G.cur += clk() - t0; G.act = true; G.vc += this.voices.length; G.ia++; }
    return r;
  }
  run(inputs, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    if (currentTime !== gT) { gT = currentTime; gUsed = 0; }   // blok baru: anggaran frame penuh direset (dibagi semua plugin DERIZ)
    this.flush();
    if (!this.voices.length) { this.idle(); return true; }
    const g0 = this.volS; this.volS += (this.vol - this.volS) * 0.25; const g1 = this.volS;
    // Tahap A: perbarui laju baca tiap voice, lalu pastikan frame yang DIPERLUKAN blok ini sudah ada (wajib).
    // Satu frame WSOLA mahal (search korelasi silang). Kalau dihitung hanya saat dibutuhkan, banyak voice yang butuh
    // frame baru di blok yang sama menumpuk jadi satu lonjakan > 2,7 ms -> gresek. Jadi setelah yang wajib, frame
    // berikutnya disiapkan LEBIH AWAL (maks PF per blok, voice dengan sisa terpendek duluan). Hasil per voice tetap sama:
    // urutan dan isi frame tidak berubah, hanya waktu penghitungannya yang disebar.
    const vs = this.voices, nv = vs.length, HWf = this.HW;
    let made = 0;
    for (let vi = 0; vi < nv; vi++) {
      const v = vs[vi];
      if (v.gd) { const f = Math.min(1, Math.max(0, (currentTime - v.g0) / v.gd)); v.semis = v.gf + (v.gt - v.gf) * f; if (f >= 1) v.gd = 0; }   // slide: tinggi nada meluncur linear (dalam semiton)
      const rhoT = Math.pow(2, (v.semis + this.pitch) / 12) * this.bufRate / sampleRate;
      v.rho += (rhoT - v.rho) * 0.3;
      const hhA = v.rho > 1 ? Math.ceil(HWf / (0.85 / Math.min(v.rho, 8))) : 2;
      v.need = v.rd + v.rho * n + hhA + 4;
      while (!v.last && v.cEnd < v.need) { this.gen(v); made++; }
    }
    // prefetch: sisa jatah dipakai voice yang cadangan frame-nya kurang dari 2 hop (ring buffer 32768 jauh lebih besar dari itu)
    while (made < this.PF && gUsed < FULL_FRAMES) {   // anggaran habis: prefetch dilewati (tidak wajib), frame wajib sudah dibuat di atas
      let bv = null, bm = 0;
      for (let vi = 0; vi < nv; vi++) {
        const v = vs[vi];
        if (v.last || this.restartNext(v)) continue;
        const m = v.cEnd - v.need - 2 * (v.N >> 2);
        if (m < bm) { bm = m; bv = v; }
      }
      if (!bv) break;
      this.gen(bv); made++;
    }
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi], mask = v.size - 1, TL = v.T[0], TR = v.T[1];
      // (glide dan laju baca rho sudah diperbarui di tahap A, di atas)
      // rho > 1 (nada naik): baca dengan kernel sinc yang frekuensi potongnya 0.85/rho (pita transisi filter muat di bawah Nyquist keluaran) (low-pass sebelum decimate) -> tidak ada aliasing
      // rho <= 1: Hermite 4 titik (tidak perlu filter)
      const rr = v.rho, aa = rr > 1, fc = aa ? 0.85 / Math.min(rr, 8) : 1, hh = aa ? Math.ceil(this.HW / fc) : 2, sk = this.sinc, TRf = this.TR * fc, lim = this.HW * this.TR;
      // (frame yang diperlukan sudah disiapkan di tahap A)
      let dead = false;
      for (let i = 0; i < n; i++) {
        const pos = v.rd, i0 = Math.floor(pos);
        if (pos >= v.cEnd - hh - 1) { dead = true; break; }
        const f = pos - i0;
        let sl, sr;
        if (aa) {
          // kernel simetris: sisi kiri (t <= 0) dan kanan (t >= 1), jarak bertambah TRf per tap; bobot dari tabel (terdekat), gain pita lolos = fc
          sl = 0; sr = 0;
          let d = f * TRf, k;
          for (let t = 0; t >= 1 - hh; t--) { k = (d + 0.5) | 0; if (k >= lim) break; const w = sk[k], j = (i0 + t) & mask; sl += w * TL[j]; sr += w * TR[j]; d += TRf; }
          d = (1 - f) * TRf;
          for (let t = 1; t <= hh; t++) { k = (d + 0.5) | 0; if (k >= lim) break; const w = sk[k], j = (i0 + t) & mask; sl += w * TL[j]; sr += w * TR[j]; d += TRf; }
          sl *= fc; sr *= fc;
        } else {
          const jm = (i0 - 1) & mask, j0 = i0 & mask, j1 = (i0 + 1) & mask, j2 = (i0 + 2) & mask;
          let xm = TL[jm], x0 = TL[j0], x1 = TL[j1], x2 = TL[j2];
          sl = ((((x2 - xm) * 0.5 + (x0 - x1) * 1.5) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + (x1 - xm) * 0.5) * f + x0;
          xm = TR[jm]; x0 = TR[j0]; x1 = TR[j1]; x2 = TR[j2];
          sr = ((((x2 - xm) * 0.5 + (x0 - x1) * 1.5) * f + (xm - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + (x1 - xm) * 0.5) * f + x0;
        }
        if (!v.rel) { if (v.env < 1) v.env = Math.min(1, v.env + v.atk); } else v.env *= v.relK;
        const g = v.env * v.vel * (g0 + (g1 - g0) * i / n);
        oL[i] += sl * g; oR[i] += sr * g;
        v.rd += v.rho;
      }
      if (dead || (v.rel && v.env < 1e-4)) { this.voices.splice(vi, 1); this.recycle(v); }
    }
    // limiter lembut: sampai 0.9 lurus (satu nada di volume normal tidak tersentuh), di atasnya melengkung halus menuju 1.0 (hanya akor yang keras)
    for (let i = 0; i < n; i++) {
      const l = oL[i];
      if (l > 0.9 || l < -0.9) oL[i] = Math.sign(l) * (0.9 + 0.1 * Math.tanh((Math.abs(l) - 0.9) / 0.1));
      if (oR !== oL) { const r = oR[i]; if (r > 0.9 || r < -0.9) oR[i] = Math.sign(r) * (0.9 + 0.1 * Math.tanh((Math.abs(r) - 0.9) / 0.1)); }
    }
    if (made < this.PF) this.idle();   // blok ini ringan: sempatkan merawat kolam buffer
    return true;
  }
}
registerProcessor('deriz-sampler', DerizSampler);
`;

const loaded = new WeakSet<BaseAudioContext>();

// Deteksi onset (dulu di worklet): lonjakan energi blok 4 ms terhadap rata-rata ~32 ms sebelumnya, lalu cari titik serangan di dalam blok.
// Dikerjakan di main thread supaya memuat sample tidak menahan thread audio; hasilnya identik dengan versi worklet sebelumnya.
export function detectOnsets(x: Float32Array, rate: number): number[] {
  const B = Math.max(32, Math.round(0.004 * rate)), nb = Math.floor(x.length / B), e = new Float32Array(nb);
  let emax = 0;
  for (let j = 0; j < nb; j++) { let s = 0; for (let k = 0; k < B; k++) { const v = x[j * B + k]; s += v * v; } e[j] = s / B; if (e[j] > emax) emax = e[j]; }
  const floor = emax * 0.003, ons: number[] = [], gap = 0.06 * rate;
  let last = -1e9;
  for (let j = 3; j < nb; j++) {
    let avg = 0, cnt = 0;
    for (let q = 2; q <= 9 && j - q >= 0; q++) { avg += e[j - q]; cnt++; }
    avg /= cnt;
    if (e[j] > 5 * avg + 1e-12 && e[j] > floor && j * B - last > gap) {
      const a0 = Math.max(0, (j - 1) * B), a1 = Math.min(x.length, (j + 1) * B);
      let pk = 0; for (let i = a0; i < a1; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
      let s = a0; while (s < a1 && Math.abs(x[s]) < 0.35 * pk) s++;
      ons.push(s); last = s;
    }
  }
  return ons;
}
const onsetCache = new WeakMap<AudioBuffer, number[]>();   // buffer yang dipakai beberapa DERIZ: deteksi onset cukup sekali

// ---- Debug audio (Pengaturan > Debug Audio): statistik dari worklet dikirim lewat hook ini (modul ini sengaja tanpa import supaya bisa dites di Node) ----
export interface DerizStat {
  t: 'st'; ct: number; tr: number; bud: number;   // ct: waktu AudioContext saat laporan; tr: resolusi timer worklet (ms; 0 = performance.now); bud: jatah per blok (ms)
  n: number; sum: number; max: number; maxAt: number; late: number; vmax: number; iamax: number;
  full: number; light: number; hit: number;
  nOn: number; nLate: number; ltSum: number; ltMax: number;
  stealH: number; stealT: number; noBuf: number; penDrop: number;
  trN: number; trSlow: number; trMax: number;   // pesan nada main thread -> worklet: jumlah, tiba > 100 ms setelah dikirim, tertunda terlama (ms)
  spK: number; spO: number; pcK: number; pcO: number; spFrom: number; spTo: number;   // Speed / Pitch berubah di worklet: lewat knob (K) atau dibawa nada (O)
  lateSkip: number;   // nada jadwal yang telat lebih dari panjangnya sehingga dilewati
}
export const derizHooks: { on: boolean; stat: ((m: DerizStat, ctx: BaseAudioContext) => void) | null } = { on: false, stat: null };
const liveSynths = new Set<DerizSynth>();
export function setDerizDebug(on: boolean): void {   // nyalakan / matikan pencatatan di semua worklet DERIZ (yang dibuat sesudahnya ikut)
  derizHooks.on = on;
  for (const s of liveSynths) s.node.port.postMessage({ t: 'dbg', on });
}

export class DerizSynth {
  private sent: AudioBuffer | null = null;
  private target: AudioNode | null = null;
  private constructor(readonly ctx: AudioContext, readonly node: AudioWorkletNode) {
    node.port.onmessage = (e: MessageEvent) => { const m = e.data; if (m && m.t === 'st') derizHooks.stat?.(m as DerizStat, ctx); };
    liveSynths.add(this);
    if (derizHooks.on) node.port.postMessage({ t: 'dbg', on: true });
  }

  static async create(ctx: AudioContext): Promise<DerizSynth> {
    if (!loaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      loaded.add(ctx);
    }
    return new DerizSynth(ctx, new AudioWorkletNode(ctx, 'deriz-sampler', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }));
  }

  routeTo(dest: AudioNode): void {   // sambungkan keluaran ke jalur track (pindah kalau track berbeda)
    if (this.target === dest) return;
    this.node.disconnect(); this.node.connect(dest); this.target = dest;
  }

  hasBuffer(buf: AudioBuffer): boolean { return this.sent === buf; }   // sample ini sudah dikirim ke worklet (nada pertama tidak perlu menunggu)

  setBuffer(buf: AudioBuffer): void {   // kirim data sample sekali per buffer; semua persiapan berat dikerjakan di sini (main thread), bukan di worklet
    if (this.sent === buf) return;
    this.sent = buf;
    const minLen = Math.ceil(0.09 * buf.sampleRate) + 8;   // sample lebih pendek dari satu frame: tambah nol supaya aman dibaca
    const ch: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
      let a = buf.getChannelData(c).slice();
      if (a.length < minLen) { const p = new Float32Array(minLen); p.set(a); a = p; }
      ch.push(a);
    }
    const len = ch[0].length, mono = new Float32Array(len), l = ch[0], r = ch[1];
    for (let i = 0; i < len; i++) mono[i] = r ? (l[i] + r[i]) * 0.5 : l[i];
    let ons = onsetCache.get(buf);
    if (!ons) { ons = detectOnsets(mono, buf.sampleRate); onsetCache.set(buf, ons); }
    this.node.port.postMessage({ t: 'buf', ch, mono, ons, rate: buf.sampleRate }, [...ch.map(a => a.buffer), mono.buffer]);
  }

  // at (opsional) = waktu AudioContext tempat nada mulai / dilepas; kosong = sekarang
  // vel (opsional) = penguatan nada ini 0..1 (1 = tidak berubah)
  noteOn(id: number, semis: number, start: number, speed: number, pitch: number, vol: number, at = 0, vel = 1): void {
    this.node.port.postMessage({ t: 'on', id, semis, start, speed, pitch, vol, at, vel, sent: this.ctx.currentTime });   // sent: untuk statistik Debug Audio (waktu pesan di jalan)
  }
  noteOff(id: number, at = 0): void { this.node.port.postMessage({ t: 'off', id, at }); }
  glide(id: number, semis: number, at: number, dur: number): void { this.node.port.postMessage({ t: 'glide', id, semis, at, dur }); }   // slide: meluncur ke `semis` mulai `at` selama `dur` detik
  // Seluruh jadwal satu Play dikirim SEKALI (waktu AudioContext absolut): worklet menjalankannya sendiri lewat jam audio.
  schedule(notes: Array<{ id: number; semis: number; start: number; speed: number; pitch: number; vol: number; at: number; dur: number; vel: number; glides?: Array<{ semis: number; at: number; dur: number }> }>): void {
    const ev: Array<Record<string, number | string>> = [];
    for (const n of notes) {
      ev.push({ t: 'on', id: n.id, semis: n.semis, start: n.start, speed: n.speed, pitch: n.pitch, vol: n.vol, at: n.at, vel: n.vel, dur: n.dur });
      if (n.glides) for (const g of n.glides) ev.push({ t: 'glide', id: n.id, semis: g.semis, at: g.at, dur: g.dur });
      ev.push({ t: 'off', id: n.id, at: n.at + n.dur });
    }
    const rank: Record<string, number> = { on: 0, glide: 1, off: 2 };
    ev.sort((a, b) => (a.at as number) - (b.at as number) || rank[a.t as string] - rank[b.t as string]);
    this.node.port.postMessage({ t: 'sched', ev, sent: this.ctx.currentTime });
  }
  releaseAll(): void { this.node.port.postMessage({ t: 'relall' }); }   // lepas semua nada (peluruhan halus) dan batalkan yang terjadwal
  params(speed: number, pitch: number, vol: number): void { this.node.port.postMessage({ t: 'p', speed, pitch, vol }); }

  dispose(): void {
    liveSynths.delete(this);
    this.node.port.postMessage({ t: 'kill' });
    this.node.disconnect(); this.target = null;
  }
}
