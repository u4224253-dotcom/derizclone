// Pengganti src/automation.ts HANYA di build demo (plugin `demoStubs` di vite.config.ts).
// Automation Clip adalah fitur versi penuh: di demo tombolnya hanya menampilkan pemberitahuan (lihat createAutomationClip di main.ts),
// jadi tidak ada clip yang pernah dibuat. Modul asli (kurva, editor, gambar mini) tidak ikut masuk ke bundel demo.
// Nama dan bentuk ekspor sengaja sama dengan modul asli.
import type { AutoParamInfo } from '../fx-rack';

export interface AutoPoint { x: number; y: number }
export interface AutoTargetRef { track: string; fxId: number; key: string }
export interface AutoClip { target: AutoTargetRef | null; pts: AutoPoint[] }
export interface AutoSaved { p: Array<[number, number]> }
export interface AutoEditorOpts {
  id: string;
  len: number;
  title: string;
  color: string;
  info: AutoParamInfo | null;
  onChange(): void;
  onClose?(): void;
}

export const getClip = (_id: string): AutoClip | undefined => undefined;
export const hasClip = (_id: string): boolean => false;
export const createClip = (_target: AutoTargetRef | null, _value: number, _lenBeats: number): string => '';
export const importClip = (_target: AutoTargetRef | null, _saved: AutoSaved): string => '';
export const exportClip = (_id: string): AutoSaved => ({ p: [] });
export const valueAt = (_id: string, _beat: number): number | undefined => undefined;
export const setTarget = (_id: string, _target: AutoTargetRef | null): void => {};
export const cloneClip = (_id: string): string => '';
export const splitClip = (_id: string, _cut: number): string => '';
export const shiftClip = (_id: string, _delta: number, _base?: AutoSaved): void => {};
export const renderMini = (_el: HTMLElement, _id: string, _lenBeats: number): void => {};
export const closeAutoEditor = (): void => {};
export const openAutoEditor = (_o: AutoEditorOpts): void => {};
