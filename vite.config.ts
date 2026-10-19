import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({ base: './', plugins: [react()], define: { __MOYE_VERSION__: JSON.stringify(version) }, build: { outDir: 'dist', chunkSizeWarningLimit: 1600 } })
