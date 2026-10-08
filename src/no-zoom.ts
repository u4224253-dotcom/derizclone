// Mengunci zoom halaman di seluruh aplikasi (zoom bawaan browser), supaya layout DAW tidak bergeser / membesar sendiri:
//   - pinch dua jari di layar sentuh (iOS Safari lewat event gesture*, browser lain lewat meta viewport + touch-action di styles.css)
//   - Ctrl + roda mouse dan pinch di trackpad (browser desktop mengirimnya sebagai wheel + ctrlKey)
//   - pintasan keyboard Ctrl/Cmd + / - / 0
// Zoom di dalam fitur (mis. canvas CUTE, piano roll) tidak terpengaruh: itu ditangani handler masing-masing, bukan zoom halaman.

for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e: Event) => e.preventDefault(), { passive: false });

window.addEventListener('wheel', (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0')) e.preventDefault();
}, true);
