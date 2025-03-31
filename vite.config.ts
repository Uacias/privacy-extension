import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    sveltekit(),
    viteStaticCopy({
      targets: [
        { src: 'static/manifest.json', dest: '.' }
      ]
    })
  ],
  build: {
    target: 'esnext', 
    rollupOptions: {
    },
    outDir: 'build',
    emptyOutDir: true
  }
});
