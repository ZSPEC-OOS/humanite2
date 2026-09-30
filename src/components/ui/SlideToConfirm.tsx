'use client'
import { useRef, useState } from 'react'

interface SlideToConfirmProps {
  label: string
  confirmingLabel?: string
  onConfirm: () => void
  disabled?: boolean
  danger?: boolean
}

// A drag-to-the-end slider, not a tap-to-confirm dialog — deliberately
// harder to trigger by accident than window.confirm(), which a reflexive
// "OK" tap defeats instantly. Used for actions with no undo (permanent
// delete); anything reversible (archive, cancel) should keep using a plain
// confirm().
export function SlideToConfirm({ label, confirmingLabel = 'Release to confirm', onConfirm, disabled = false, danger = true }: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [armed, setArmed] = useState(false)
  const THUMB_SIZE = 40

  function clampAndSet(clientX: number) {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const max = rect.width - THUMB_SIZE
    const x = Math.min(max, Math.max(0, clientX - rect.left - THUMB_SIZE / 2))
    setDragX(x)
    setArmed(x >= max - 4)
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (disabled) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(true)
    clampAndSet(e.clientX)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return
    clampAndSet(e.clientX)
  }

  function handlePointerUp() {
    if (!dragging) return
    setDragging(false)
    if (armed) {
      onConfirm()
    }
    setDragX(0)
    setArmed(false)
  }

  return (
    <div
      ref={trackRef}
      className={`relative w-full h-11 rounded-full select-none touch-none overflow-hidden ${
        disabled ? 'opacity-40' : ''
      } ${danger ? 'bg-red-50 dark:bg-red-950/40' : 'bg-gray-100 dark:bg-gray-800'}`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${danger ? 'bg-red-200 dark:bg-red-900/60' : 'bg-gray-200 dark:bg-gray-700'}`}
        style={{ width: `${dragX + THUMB_SIZE}px`, transition: dragging ? 'none' : 'width 150ms ease-out' }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={`text-xs font-medium ${danger ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>
          {armed ? confirmingLabel : label}
        </span>
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ width: THUMB_SIZE, height: THUMB_SIZE, transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : 'transform 150ms ease-out' }}
        className={`absolute top-0.5 left-0.5 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing shadow ${
          danger ? 'bg-red-600 text-white' : 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
        }`}
      >
        →
      </div>
    </div>
  )
}
