declare module 'virtual:bundled-pdf-assets' {
  const assets: Readonly<Record<string, string>>
  export const workerSource: string
  export default assets
}

declare module 'virtual:pptx-render-frame' {
  const script: string
  export default script
}
