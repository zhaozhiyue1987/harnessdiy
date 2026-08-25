import { defineConfig } from 'tsdown'

/** Builds the published marker and invariant entrypoints. */
export default defineConfig([
  { entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false },
  { entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false },
])
