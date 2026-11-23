import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pdfRoot = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
const pdfAssets = '\0virtual:bundled-pdf-assets'

export default defineConfig({
  plugins: [react(), {
    name: 'bundled-pdf-assets',
    resolveId: id => id === 'virtual:bundled-pdf-assets' ? pdfAssets : undefined,
    load(id) {
      if (id !== pdfAssets) return
      const assets: Record<string, string> = {}
      for (const [dir, kind, extension] of [['cmaps', 'cMapUrl', /\.bcmap$/],
        ['standard_fonts', 'standardFontDataUrl', /\.(pfb|ttf)$/], ['wasm', 'wasmUrl', /^(jbig2|openjpeg|qcms_bg)\.wasm$/]] as const) {
        for (const name of readdirSync(join(pdfRoot, dir))) {
          if (extension.test(name)) assets[`${kind}/${name}`] = readFileSync(join(pdfRoot, dir, name)).toString('base64')
        }
      }
      const worker = readFileSync(join(pdfRoot, 'build', 'pdf.worker.min.mjs'), 'utf8')
      return `export const workerSource = ${JSON.stringify(worker)}; export default ${JSON.stringify(assets)}`
    },
    generateBundle() {
      for (const directory of ['.', 'cmaps', 'standard_fonts', 'wasm']) {
        for (const file of readdirSync(join(pdfRoot, directory))) if (file.startsWith('LICENSE')) {
          this.emitFile({ type: 'asset', fileName: `licenses/pdfjs/${directory === '.' ? '' : `${directory}/`}${file}`,
            source: readFileSync(join(pdfRoot, directory, file)) })
        }
      }
      this.emitFile({ type: 'asset', fileName: 'licenses/pdf-lib/LICENSE.md',
        source: readFileSync(new URL('./node_modules/pdf-lib/LICENSE.md', import.meta.url)) })
    },
  }],
})
