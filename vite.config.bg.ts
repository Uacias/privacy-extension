import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	build: {
		target: 'esnext',
		outDir: 'static',
		emptyOutDir: false,
		rollupOptions: {
			input: {
				background: resolve(__dirname, 'src/background/background.ts'),
				content: resolve(__dirname, 'src/background/content.ts'),
				inject: resolve(__dirname, 'src/background/inject.ts'),
				offscreen: resolve(__dirname, 'src/background/offscreen.ts') // 👈
			},
			output: {
				entryFileNames: '[name].js' // 👈 creates background.js and content.js
			}
		}
	}
});
