import type { RectangleObject, TextObject } from '../../../src/core/scene'

export const rectangle = (id = 'rect-b'): RectangleObject => ({
  id, type: 'rectangle', x: 120, y: 92, rotation: 0,
  width: 78, height: 48, fill: '#0f766e', stroke: '#144553', strokeWidth: 2,
})

export const text = (id = 'text-a'): TextObject => ({
  id, type: 'text', x: 225, y: 165, rotation: 0,
  text: '帧数增加 & 预算不变\n继续编辑', fontFamily: 'Microsoft YaHei', fontSize: 22, color: '#182230',
})
