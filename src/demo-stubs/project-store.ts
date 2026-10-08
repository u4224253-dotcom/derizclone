// Pengganti src/project-store.ts HANYA di build demo (plugin `demoStubs` di vite.config.ts).
// Menyimpan / membuka file project adalah fitur versi penuh. Di demo semua tombolnya berhenti di pemberitahuan (menu-panel.ts),
// jadi tidak ada yang pernah dituliskan ke IndexedDB. Kalau tetap terpanggil, ditolak dengan pesan yang jelas.
export interface ProjectRecord { name: string; savedAt: number; data: unknown; clips: Record<string, Blob> }
export interface ProjectInfo { name: string; savedAt: number }

const NO = (): Promise<never> => Promise.reject(new Error('Simpan / buka project ada di versi penuh'));

export const saveProject = (_rec: ProjectRecord): Promise<never> => NO();
export const loadProject = (_name: string): Promise<ProjectRecord | undefined> => Promise.resolve(undefined);
export const deleteProject = (_name: string): Promise<never> => NO();
export const listProjects = (): Promise<ProjectInfo[]> => Promise.resolve([]);
export const projectExists = (_name: string): Promise<boolean> => Promise.resolve(false);
export const recordToJson = (_rec: ProjectRecord): Promise<string> => NO();
export const jsonToRecord = (_text: string): Promise<ProjectRecord> => NO();
