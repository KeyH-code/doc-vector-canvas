declare module 'virtual:bundled-pdf-assets' {
  const assets: Readonly<Record<string, string>>
  export const workerSource: string
  export default assets
}
