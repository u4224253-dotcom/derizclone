// Pengganti src/audio-debug.ts HANYA di build demo (plugin `demoStubs` di vite.config.ts).
// Panel Debug Audio tidak ada di demo (menunya disembunyikan), jadi semua hook-nya tidak melakukan apa-apa.
export function dbgSched(_leadSec: number): void {}
export function dbgSent(_waitMs: number, _lateSec: number): void {}
export function dbgZoom(_stage: string, _ms: number): void {}
export function dbgSpec(_sliceMs: number, _held: boolean): void {}
export function dbgRun(_startCtx: number, _ctx?: BaseAudioContext): void {}
export function dbgReport(): string { return ''; }
export function setAudioDebug(_v: boolean, _save = true): void {}
export function loadAudioDebug(): boolean { return false; }
