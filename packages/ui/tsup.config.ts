import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/tokens/index.ts'],
  format: ['esm', 'cjs'],
  dts: { compilerOptions: { composite: false } },
  clean: true,
  sourcemap: true,
  target: 'es2020',
  // Built output keeps the source layout (dist/index.js, dist/tokens/index.js).
  outDir: 'dist',
});
