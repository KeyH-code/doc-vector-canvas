export type PageReader = {
  close: () => Promise<void>
  render: (index: number, longSide: number, signal?: AbortSignal) => Promise<HTMLCanvasElement>
}
