import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { DocumentPage } from '../core/document'
import type { PageReader } from '../document/pageReader'
import { Icon } from './Icon'

function PageThumb({ reader, index }: { reader: PageReader; index: number }) {
  const element = useRef<HTMLSpanElement>(null)
  const [source, setSource] = useState<string>()
  useEffect(() => {
    setSource(undefined)
    const controller = new AbortController()
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void reader.render(index, 100, controller.signal).then(canvas => {
        if (!controller.signal.aborted) setSource(canvas.toDataURL('image/png'))
      }).catch(() => undefined) // Keep the page number available if only its thumbnail fails.
    })
    observer.observe(element.current!)
    return () => { observer.disconnect(); controller.abort() }
  }, [reader, index])
  return <span ref={element} className="page-thumb">{source && <img src={source} alt="" />}</span>
}

type PageMenu = { id: string; label: string; x: number; y: number; trigger: HTMLButtonElement }

export function PageNavigator({ pages, active, hiddenBackgrounds, onPage, onToggleBackground, reader, children }: {
  pages: readonly DocumentPage[]; active?: string; hiddenBackgrounds: ReadonlySet<string>
  onPage: (id: string) => void; onToggleBackground: (id: string) => void; reader?: PageReader; children: ReactNode
}) {
  const objectRegion = useId()
  const [collapsed, setCollapsed] = useState(false)
  const [menu, setMenu] = useState<PageMenu>()
  const popup = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { setCollapsed(false); setMenu(undefined) }, [active, reader])
  useLayoutEffect(() => {
    if (!menu || !popup.current) return
    const node = popup.current
    const { width, height } = node.getBoundingClientRect()
    const { clientWidth, clientHeight } = document.documentElement
    node.style.left = `${Math.max(4, Math.min(menu.x, clientWidth - width - 4))}px`
    node.style.top = `${Math.max(4, Math.min(menu.y, clientHeight - height - 4))}px`
    // Mouse actions should not blur an input and commit an unrelated edit.
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement && (focused.matches('input, textarea, select') || focused.isContentEditable))) {
      node.querySelector('button')?.focus({ preventScroll: true })
    }
    const close = () => setMenu(undefined)
    const outside = (event: PointerEvent) => { if (!event.composedPath().includes(node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (node.contains(document.activeElement)) menu.trigger.focus({ preventScroll: true })
      close()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  return <section className="document-pages" aria-labelledby="document-pages-heading">
    <div className="object-head"><h2 id="document-pages-heading">文档页面</h2><span>{pages.length} 页</span></div>
    <ol className="document-page-list">
      {pages.map((page, i) => {
        const label = `第 ${i + 1} 页`
        const current = active === page.id, expanded = current && !collapsed
        return <li key={page.id}>
          <div className="document-page-row" data-current={current} onMouseDown={event => {
            if (event.button === 2) event.preventDefault()
          }} onContextMenu={event => {
            event.preventDefault()
            const trigger = (event.target as Element).closest('button') ?? event.currentTarget.querySelector<HTMLButtonElement>('.page-select')!
            setMenu({ id: page.id, label, x: event.clientX, y: event.clientY, trigger })
          }} onKeyDown={event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
            if (!(event.target instanceof HTMLButtonElement)) return
            event.preventDefault()
            const { left, bottom } = event.target.getBoundingClientRect()
            setMenu({ id: page.id, label, x: left, y: bottom, trigger: event.target })
          }}>
            <button type="button" className="page-disclosure" aria-label={`${expanded ? '折叠' : '展开'}${label}对象`}
              aria-expanded={expanded} aria-controls={current ? objectRegion : undefined}
              onClick={() => current ? setCollapsed(!collapsed) : onPage(page.id)}><Icon name="chevron" /></button>
            <button type="button" className="page-select" aria-current={current ? 'page' : undefined} aria-haspopup="menu"
              onClick={() => current ? setCollapsed(false) : onPage(page.id)}>
              {reader && <PageThumb reader={reader} index={i} />}
              <span>{label}</span>
            </button>
          </div>
          {current && <div id={objectRegion} className="document-page-objects" role="region" aria-label={`${label}对象`} hidden={!expanded}>
            {children}
          </div>}
        </li>
      })}
    </ol>
    {menu && <div ref={popup} className="page-context-menu" role="menu" aria-label={`${menu.label}操作`}
      onBlur={() => setMenu(undefined)} onKeyDown={event => event.stopPropagation()}>
      <button type="button" role="menuitem" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => {
        onToggleBackground(menu.id)
        if (popup.current?.contains(document.activeElement)) menu.trigger.focus({ preventScroll: true })
        setMenu(undefined)
      }}>{hiddenBackgrounds.has(menu.id) ? '显示底稿' : '隐藏底稿'}</button>
    </div>}
  </section>
}
