import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const hash = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();   // nomor versi build, tampil di panel Debug Audio
const stamp = hash + ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// PWA: setelah build, isi daftar semua file hasil build ke dist/sw.js supaya seluruh aplikasi
// (termasuk worker dan font) tersimpan di cache saat pertama dibuka dan bisa jalan offline.
function pwaPrecache(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string, base = ''): string[] =>
    readdirSync(dir).flatMap((name) => {
      const rel = base ? base + '/' + name : name;
      return statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), rel) : [rel];
    });
  return {
    name: 'pwa-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      const files = walk(outDir).filter((f) => f !== 'sw.js' && f !== 'login.html' && f !== 'admin.html' && !f.endsWith('.map')).map((f) => './' + f);
      const src = readFileSync(swPath, 'utf8')
        .replace('/*__PRECACHE__*/[]', JSON.stringify(files))
        .replace('__VERSION__', hash + '-' + Date.now().toString(36));
      writeFileSync(swPath, src);
    },
  };
}

// Build demo: modul fitur versi penuh DIGANTI stub di src/demo-stubs/ (nama ekspor sama, isinya kosong), jadi kodenya tidak ada di dist-demo.
// Menambah fitur penuh-saja yang berupa modul sendiri: buat stub-nya di src/demo-stubs/ dan tambahkan namanya di daftar ini.
const DEMO_STUBBED = ['automation', 'audio-debug', 'project-store'];
function demoStubs(): Plugin {
  const src = resolve('src');
  return {
    name: 'demo-stubs',
    enforce: 'pre',
    apply: (_config, env) => env.mode === 'demo',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('./')) return null;
      const name = source.slice(2);
      if (!DEMO_STUBBED.includes(name) || resolve(dirname(importer.split('?')[0])) !== src) return null;
      return join(src, 'demo-stubs', name + '.ts');
    },
  };
}

// Build demo: judul tab, nama saat di-install (PWA) dan nama di layar utama iOS diberi tanda "Demo", supaya tidak tertukar dengan versi penuh.
function demoBranding(): Plugin {
  let outDir = 'dist-demo';
  return {
    name: 'demo-branding',
    apply: (_config, env) => env.mode === 'demo',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml(html) {
      return html
        .replace('<title>Melvox</title>', '<title>Melvox (Demo)</title>')
        .replace('<meta name="apple-mobile-web-app-title" content="Melvox">', '<meta name="apple-mobile-web-app-title" content="Melvox Demo">');
    },
    closeBundle() {
      const mp = join(outDir, 'manifest.webmanifest');
      const m = JSON.parse(readFileSync(mp, 'utf8'));
      m.name = 'Melvox (Demo)'; m.short_name = 'Melvox Demo';
      writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: { __BUILD__: JSON.stringify(stamp), __DEMO__: JSON.stringify(mode === 'demo'), __FULL__: JSON.stringify(mode === 'full') },   // mode demo: vite build --mode demo -> dist-demo/ ; mode full: vite build --mode full -> dist-full/ (berlisensi, lewat gerbang login)
  plugins: [demoStubs(), demoBranding(), pwaPrecache()],
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : mode === 'full' ? 'dist-full' : 'dist',
    // build full memuat 2 halaman: aplikasi (index.html) dan halaman login (login.html)
    rollupOptions: mode === 'full' ? { input: { main: resolve('index.html'), login: resolve('login.html'), admin: resolve('admin.html') } } : undefined,
    // CSS dibiarkan apa adanya (tidak di-minify) supaya tampilan identik dengan versi HTML
    cssMinify: false,
  },
}));
