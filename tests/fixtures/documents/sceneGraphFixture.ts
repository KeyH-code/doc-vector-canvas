import type { BoxObject, CanvasScene, LineObject } from '../../../src/core/scene'
import { pdfFixture } from './pdfFixture'

export function graphFixture(): CanvasScene {
  const node = (id: string, x: number, y: number): BoxObject => ({ type: 'rectangle', id, x, y, width: 36, height: 32,
    rotation: 0, fill: '#e0eaf3', stroke: '#355985', strokeWidth: 2 })
  const main = (direction: 'start' | 'end'): LineObject => {
    const incoming = direction === 'end'
    return { type: 'arrow', id: incoming ? 'incoming' : 'main', x: 100, y: 0, dx: 0, dy: 110, rotation: 0, stroke: '#243f70', strokeWidth: 3,
      startBinding: { targetId: incoming ? 'input' : 'process', kind: 'edge', edge: 2, t: .5 },
      endBinding: { targetId: incoming ? 'process' : 'output', kind: 'edge', edge: 0, t: .5 },
      ...(!incoming && { path: { kind: 'polyline', start: { x: 0, y: 156 }, segments: [{ id: 0, to: { x: 0, y: 206 } }, { id: 1, to: { x: 0, y: 244 } }] } }) }
  }
  const branch: LineObject = { type: 'line', id: 'branch', x: 100, y: 190, dx: 70, dy: 30, rotation: 0, stroke: '#187f79', strokeWidth: 2,
    startBinding: { targetId: 'main', kind: 'path', segment: 0, t: .5 },
    path: { kind: 'curve', start: { x: 0, y: 0 }, segments: [{ id: 0, c1: { x: 25, y: -25 }, c2: { x: 50, y: 5 }, to: { x: 70, y: 30 } }] } }
  return { id: 'e8-demo', objects: [], document: { source: { kind: 'pdf', data: pdfFixture().toString('base64') },
    pages: [
      { id: 'p1', width: 200, height: 300, text: 'FIRST BASE TEXT', scene: { id: 'p1', objects: [node('process', 85, 95)] } },
      { id: 'p2', width: 200, height: 320, text: 'SECOND BASE TEXT', scene: { id: 'p2', objects: [
        node('input', 100, 45), node('process', 100, 140), node('output', 100, 260), main('end'), main('start'), branch,
        { type: 'line', id: 'crossing', x: 100, y: 140, dx: 170, dy: 0, rotation: 0, stroke: '#998877', strokeWidth: 1 },
        node('draft', 230, 260), node('part', 194, 285),
      ] } },
    ],
  } }
}
