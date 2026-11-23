import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { build, defineConfig } from 'vite'

const pdfRoot = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
const pdfAssets = '\0virtual:bundled-pdf-assets'
const pptxFrame = '\0virtual:pptx-render-frame'
const pptxFrameSources = new Set(['/src/document/pptxRenderFrame.ts', '/src/document/pptxPackage.ts', '/src/core/document.ts',
  '/src/core/base64.ts', '/src/core/imageAssets.ts', '/src/core/scene.ts'].map(path => fileURLToPath(new URL(`.${path}`, import.meta.url)).replaceAll('\\', '/')))
let frameBuild: Promise<string> | undefined

export default defineConfig({
  plugins: [react(), {
    name: 'isolated-pptx-frame',
    resolveId: id => id === 'virtual:pptx-render-frame' ? pptxFrame : undefined,
    configureServer(server) {
      server.watcher.on('change', file => {
        if (!pptxFrameSources.has(file.replaceAll('\\', '/'))) return
        frameBuild = undefined
        const graph = server.environments.client.moduleGraph
        const frame = graph.getModuleById(pptxFrame)
        if (!frame) return
        graph.invalidateModule(frame)
        server.ws.send({ type: 'full-reload' })
      })
    },
    async load(id) {
      if (id !== pptxFrame) return
      // One self-contained script can run inside a sandbox without authorizing script/network fetches.
      frameBuild ??= build({ configFile: false, logLevel: 'error', build: { write: false, target: 'es2022',
        lib: { entry: fileURLToPath(new URL('./src/document/pptxRenderFrame.ts', import.meta.url)), formats: ['iife'], name: 'PptxRenderFrame' },
      } }).then(result => {
        const chunks = (Array.isArray(result) ? result : [result]).flatMap(entry => 'output' in entry ? entry.output : [])
        if (chunks.length !== 1 || chunks[0].type !== 'chunk' || chunks[0].imports.length || chunks[0].dynamicImports.length) {
          throw new Error('Expected one self-contained PPTX renderer script.')
        }
        return chunks[0].code
      }).catch(error => { frameBuild = undefined; throw error })
      return `export default ${JSON.stringify(await frameBuild)}`
    },
    generateBundle() {
      for (const [name, entry] of [['web-ppt', '@web-ppt/core'], ['fflate', 'fflate']]) {
        this.emitFile({ type: 'asset', fileName: `licenses/${name}/LICENSE`, source: readFileSync(new URL(`./node_modules/${entry}/LICENSE`, import.meta.url)) })
      }
    },
  }, {
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
      this.emitFile({ type: 'asset', fileName: 'licenses/pptxgenjs/LICENSE',
        source: readFileSync(new URL('./node_modules/pptxgenjs/LICENSE', import.meta.url)) })
      this.emitFile({ type: 'asset', fileName: 'licenses/jszip/LICENSE.markdown',
        source: readFileSync(new URL('./node_modules/jszip/LICENSE.markdown', import.meta.url)) })
    },
  }],
})
