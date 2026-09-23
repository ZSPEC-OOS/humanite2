'use client'

/**
 * Temporary authoring tool — not a production feature. Lets you nudge the
 * position, size, spacing, and centering of any element on the page, then
 * copy the resulting deltas out as JSON so they can be hard-coded into the
 * real Tailwind markup. A small ✥ button sits fixed at the bottom-left of
 * every page as the way in — click it (or append `?edit=1` to the URL, or
 * press Ctrl+Shift+E) to open the full toolbar. Everything else — overlays,
 * listeners — stays dormant until then.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

interface EditState {
  centered: boolean
  x: number
  y: number
  width: number | null
  height: number | null
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  fontSize: number | null
}

const DEFAULT_EDIT: EditState = {
  centered: false,
  x: 0,
  y: 0,
  width: null,
  height: null,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  fontSize: null,
}

function isDefault(edit: EditState): boolean {
  return (
    edit.centered === DEFAULT_EDIT.centered &&
    edit.x === DEFAULT_EDIT.x &&
    edit.y === DEFAULT_EDIT.y &&
    edit.width === DEFAULT_EDIT.width &&
    edit.height === DEFAULT_EDIT.height &&
    edit.marginTop === DEFAULT_EDIT.marginTop &&
    edit.marginRight === DEFAULT_EDIT.marginRight &&
    edit.marginBottom === DEFAULT_EDIT.marginBottom &&
    edit.marginLeft === DEFAULT_EDIT.marginLeft &&
    edit.fontSize === DEFAULT_EDIT.fontSize
  )
}

function storageKey(pathname: string) {
  return `humanite:editor:overrides:${pathname}`
}

function labelFor(el: Element): string {
  const tagId = el.getAttribute('data-edit-id')
  if (tagId) return tagId
  const text = el.textContent?.trim().slice(0, 24) ?? ''
  return text ? `${el.tagName.toLowerCase()} "${text}"` : el.tagName.toLowerCase()
}

function selectorFor(el: Element): string {
  const tagId = el.getAttribute('data-edit-id')
  if (tagId) return `[data-edit-id="${tagId}"]`

  const parts: string[] = []
  let node: Element | null = el
  let depth = 0
  while (node && node.nodeType === 1 && depth < 8) {
    if (node.getAttribute('data-edit-id')) {
      parts.unshift(`[data-edit-id="${node.getAttribute('data-edit-id')}"]`)
      break
    }
    let part = node.tagName.toLowerCase()
    if (node.id) {
      parts.unshift(`${part}#${node.id}`)
      break
    }
    const parent: Element | null = node.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === node!.tagName)
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(node) + 1})`
      }
    }
    parts.unshift(part)
    node = node.parentElement
    depth++
  }
  return parts.join(' > ')
}

function applyEdit(el: HTMLElement, edit: EditState) {
  if (edit.centered) {
    el.style.position = 'relative'
    el.style.left = '50%'
    el.style.transform = `translate(calc(-50% + ${edit.x}px), ${edit.y}px)`
  } else {
    el.style.position = ''
    el.style.left = ''
    el.style.transform = edit.x || edit.y ? `translate(${edit.x}px, ${edit.y}px)` : ''
  }
  el.style.width = edit.width != null ? `${edit.width}px` : ''
  el.style.height = edit.height != null ? `${edit.height}px` : ''
  el.style.marginTop = edit.marginTop ? `${edit.marginTop}px` : ''
  el.style.marginRight = edit.marginRight ? `${edit.marginRight}px` : ''
  el.style.marginBottom = edit.marginBottom ? `${edit.marginBottom}px` : ''
  el.style.marginLeft = edit.marginLeft ? `${edit.marginLeft}px` : ''
  el.style.fontSize = edit.fontSize != null ? `${edit.fontSize}px` : ''
}

type Overrides = Record<string, EditState>

export function PositionEditor() {
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const [overrides, setOverrides] = useState<Overrides>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null)
  const [selectedRect, setSelectedRect] = useState<DOMRect | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    startEdit: EditState
  } | null>(null)

  // Activation: ?edit=1 or Ctrl+Shift+E.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('edit') === '1') setActive(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setActive(a => !a)
      }
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load persisted overrides for this page.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(pathname))
      setOverrides(raw ? JSON.parse(raw) : {})
    } catch {
      setOverrides({})
    }
    setSelected(null)
  }, [pathname])

  // Persist + apply overrides whenever they change.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(pathname), JSON.stringify(overrides))
    } catch {
      /* localStorage unavailable — edits stay in-memory only */
    }
    for (const [selector, edit] of Object.entries(overrides)) {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) applyEdit(el, edit)
    }
  }, [overrides, pathname])

  const setEditFor = useCallback((selector: string, patch: Partial<EditState>) => {
    setOverrides(prev => {
      const next = { ...(prev[selector] ?? DEFAULT_EDIT), ...patch }
      const copy = { ...prev }
      if (isDefault(next)) {
        delete copy[selector]
        const el = document.querySelector<HTMLElement>(selector)
        if (el) applyEdit(el, DEFAULT_EDIT)
      } else {
        copy[selector] = next
      }
      return copy
    })
  }, [])

  // Hover + click-to-select, only while active and not interacting with our own panel.
  useEffect(() => {
    if (!active) return

    const isOwnUi = (t: EventTarget | null) => t instanceof Element && t.closest('[data-editor-ui]')

    const onMove = (e: MouseEvent) => {
      if (dragRef.current) return
      if (isOwnUi(e.target)) {
        setHoverRect(null)
        return
      }
      const el = e.target as Element
      setHoverRect(el.getBoundingClientRect())
    }

    const onClick = (e: MouseEvent) => {
      if (isOwnUi(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.target as Element
      const selector = selectorFor(el)
      setSelected(selector)
      setSelectedRect(el.getBoundingClientRect())
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [active])

  // Keep the selection overlay glued to its element (scroll/resize/drag).
  useEffect(() => {
    if (!active || !selected) {
      setSelectedRect(null)
      return
    }
    let raf: number
    const tick = () => {
      const el = document.querySelector(selected)
      if (el) setSelectedRect(el.getBoundingClientRect())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, selected])

  const beginDrag = useCallback(
    (mode: 'move' | 'resize') => (e: React.MouseEvent) => {
      if (!selected) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startEdit: overrides[selected] ?? DEFAULT_EDIT,
      }

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current || !selected) return
        const dx = ev.clientX - dragRef.current.startX
        const dy = ev.clientY - dragRef.current.startY
        const { startEdit } = dragRef.current
        if (mode === 'move') {
          setEditFor(selected, { x: startEdit.x + dx, y: startEdit.y + dy })
        } else {
          const el = document.querySelector<HTMLElement>(selected)
          const base = {
            width: startEdit.width ?? el?.getBoundingClientRect().width ?? 0,
            height: startEdit.height ?? el?.getBoundingClientRect().height ?? 0,
          }
          setEditFor(selected, {
            width: Math.max(8, Math.round(base.width + dx)),
            height: Math.max(8, Math.round(base.height + dy)),
          })
        }
      }
      const onMouseUp = () => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [selected, overrides, setEditFor]
  )

  const copyOut = useCallback(
    (allPages: boolean) => {
      let payload: Record<string, Overrides>
      if (allPages) {
        payload = {}
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i)
          if (!key?.startsWith('humanite:editor:overrides:')) continue
          const page = key.slice('humanite:editor:overrides:'.length)
          try {
            payload[page] = JSON.parse(window.localStorage.getItem(key) ?? '{}')
          } catch {
            /* skip unparsable entry */
          }
        }
      } else {
        payload = { [pathname]: overrides }
      }
      const text = JSON.stringify(payload, null, 2)
      navigator.clipboard?.writeText(text).then(
        () => setCopyFeedback('Copied to clipboard.'),
        () => setCopyFeedback('Clipboard blocked — select the text below and copy manually.')
      )
      setLastExport(text)
      setTimeout(() => setCopyFeedback(null), 3000)
    },
    [pathname, overrides]
  )

  const [lastExport, setLastExport] = useState<string | null>(null)

  if (!active) {
    return (
      <button
        data-editor-ui
        onClick={() => setActive(true)}
        title="Open position editor (Ctrl+Shift+E)"
        className="fixed bottom-4 left-4 z-[10000] flex h-10 w-10 items-center justify-center
                   rounded-full border border-gray-300 bg-white/90 text-gray-500 shadow-lg
                   backdrop-blur-sm transition hover:text-gray-900"
      >
        ✥
      </button>
    )
  }

  const selectedEdit = selected ? overrides[selected] ?? DEFAULT_EDIT : null
  const hasAnyOverrides = Object.keys(overrides).length > 0

  return (
    <div data-editor-ui>
      {/* Hover highlight */}
      {hoverRect && !selected && (
        <div
          className="pointer-events-none fixed z-[9998] border-2 border-sky-400/70"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}

      {/* Selection overlay + handles */}
      {selectedRect && (
        <div
          className="pointer-events-none fixed z-[9999] border-2 border-orange-500"
          style={{
            left: selectedRect.left,
            top: selectedRect.top,
            width: selectedRect.width,
            height: selectedRect.height,
          }}
        >
          <div
            onMouseDown={beginDrag('move')}
            title="Drag to move"
            className="pointer-events-auto absolute -left-3 -top-3 flex h-6 w-6 cursor-move
                       items-center justify-center rounded-full bg-orange-500 text-xs text-white shadow"
          >
            ✥
          </div>
          <div
            onMouseDown={beginDrag('resize')}
            title="Drag to resize"
            className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize
                       rounded-sm border-2 border-white bg-orange-500 shadow"
          />
        </div>
      )}

      {/* Toolbar panel */}
      <div
        className="fixed bottom-4 right-4 z-[10000] w-80 rounded-xl border border-gray-200
                   bg-white p-4 text-sm text-gray-800 shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Position Editor</span>
          <button
            onClick={() => setActive(false)}
            className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            Exit (Ctrl+Shift+E)
          </button>
        </div>

        {!selected && (
          <p className="text-xs leading-relaxed text-gray-500">
            Click any text or box on the page to select it. Drag the ✥ handle to move it, the
            corner handle to resize it, or use the fields below once selected — including
            centering it and nudging it up or down while centered.
          </p>
        )}

        {selected && selectedEdit && (
          <div className="space-y-3">
            <p className="truncate text-xs text-gray-500" title={selected}>
              {labelFor(document.querySelector(selected) ?? document.body)}
            </p>

            <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
              <input
                type="checkbox"
                checked={selectedEdit.centered}
                onChange={e => setEditFor(selected, { centered: e.target.checked, x: 0 })}
              />
              Center horizontally
            </label>

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={selectedEdit.centered ? 'Nudge X (from center)' : 'Offset X'}
                value={selectedEdit.x}
                onChange={v => setEditFor(selected, { x: v ?? 0 })}
              />
              <NumberField label="Offset Y (up/down)" value={selectedEdit.y} onChange={v => setEditFor(selected, { y: v ?? 0 })} />
              <NumberField
                label="Width"
                value={selectedEdit.width}
                placeholder="auto"
                onChange={v => setEditFor(selected, { width: v })}
              />
              <NumberField
                label="Height"
                value={selectedEdit.height}
                placeholder="auto"
                onChange={v => setEditFor(selected, { height: v })}
              />
              <NumberField
                label="Font size"
                value={selectedEdit.fontSize}
                placeholder="auto"
                onChange={v => setEditFor(selected, { fontSize: v })}
              />
            </div>

            <p className="text-xs font-medium text-gray-500">Spacing (margin, px)</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Top" value={selectedEdit.marginTop} onChange={v => setEditFor(selected, { marginTop: v ?? 0 })} />
              <NumberField label="Right" value={selectedEdit.marginRight} onChange={v => setEditFor(selected, { marginRight: v ?? 0 })} />
              <NumberField label="Bottom" value={selectedEdit.marginBottom} onChange={v => setEditFor(selected, { marginBottom: v ?? 0 })} />
              <NumberField label="Left" value={selectedEdit.marginLeft} onChange={v => setEditFor(selected, { marginLeft: v ?? 0 })} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setOverrides(prev => {
                    const copy = { ...prev }
                    delete copy[selected]
                    return copy
                  })
                  const el = document.querySelector<HTMLElement>(selected)
                  if (el) applyEdit(el, DEFAULT_EDIT)
                }}
                className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-medium hover:bg-gray-50"
              >
                Reset this
              </button>
              <button
                onClick={() => setSelected(null)}
                className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-medium hover:bg-gray-50"
              >
                Deselect
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <button
            onClick={() => copyOut(false)}
            disabled={!hasAnyOverrides}
            className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-red-500 py-2 text-xs
                       font-semibold text-white shadow disabled:opacity-40"
          >
            Copy positions — this page
          </button>
          <button
            onClick={() => copyOut(true)}
            className="w-full rounded-lg border border-gray-300 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Copy positions — all pages
          </button>
          {hasAnyOverrides && (
            <button
              onClick={() => {
                if (!window.confirm('Clear all overrides on this page?')) return
                for (const selector of Object.keys(overrides)) {
                  const el = document.querySelector<HTMLElement>(selector)
                  if (el) applyEdit(el, DEFAULT_EDIT)
                }
                setOverrides({})
                setSelected(null)
              }}
              className="w-full rounded-lg py-1 text-xs text-red-500 hover:bg-red-50"
            >
              Clear all on this page
            </button>
          )}
          {copyFeedback && <p className="text-center text-xs text-gray-500">{copyFeedback}</p>}
          {lastExport && (
            <textarea
              readOnly
              value={lastExport}
              className="h-24 w-full rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-[10px]"
              onFocus={e => e.currentTarget.select()}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <input
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs
                   focus:border-orange-400 focus:outline-none"
      />
    </label>
  )
}
