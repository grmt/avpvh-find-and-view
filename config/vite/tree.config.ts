import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	build: {
		lib: {
			entry:   resolve(__dirname, '../../src/ts/admin/tree.ts'),
			name:    'FavTree',
			fileName: 'tree',
			formats: ['iife'],
		},
		outDir:     resolve(__dirname, '../../dist'),
		emptyOutDir: false,
		minify:     true,
		rollupOptions: {
			output: {
				entryFileNames: 'js/[name].iife.js',
				assetFileNames: 'css/[name][extname]',
			},
		},
	},
});
