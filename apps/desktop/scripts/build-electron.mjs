import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

await Promise.all([
  esbuild.build({
    entryPoints: [path.join(desktopRoot, 'electron/main.ts')],
    outfile: path.join(desktopRoot, 'dist-electron/main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true
  }),
  esbuild.build({
    entryPoints: [path.join(desktopRoot, 'electron/preload.ts')],
    outfile: path.join(desktopRoot, 'dist-electron/preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true
  })
]);

console.log('Bundled electron main & preload into dist-electron/');
