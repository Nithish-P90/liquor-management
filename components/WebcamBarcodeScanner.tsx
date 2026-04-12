'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  onScan: (barcode: string) => void
  title?: string
  helpText?: string
  compact?: boolean
  className?: string
}

/**
 * Webcam barcode scanner using the html5-qrcode library that's already
 * in the project's dependencies.
 *
 * Renders a "Start Camera" button. Once started, it opens the rear-facing
 * (or only) camera and continuously scans for barcodes. On a successful
 * scan it plays a short beep and invokes the `onScan` callback.
 */
export function WebcamBarcodeScanner({ onScan, title, helpText, compact, className }: Props) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const scannerRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const readerId = useRef(`reader-${Math.random().toString(36).slice(2, 9)}`)

  // Play a short beep to confirm scan
  const beep = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 1200
      gain.gain.value = 0.3
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
    } catch {
      // Silently ignore if AudioContext is unavailable
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      }
    } catch {
      // ignore
    }
    scannerRef.current = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError('')
    try {
      // Dynamically import to avoid SSR issues
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode(readerId.current)
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: compact ? { width: 200, height: 80 } : { width: 280, height: 120 },
        },
        (decodedText: string) => {
          beep()
          onScan(decodedText)
        },
        () => {
          // ignore scan failures (no barcode in frame)
        }
      )
      setActive(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera access denied'
      setError(msg)
      setActive(false)
    }
  }, [beep, compact, onScan])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return (
    <div className={className}>
      {title && (
        <p className={`font-semibold text-slate-700 ${compact ? 'text-xs mb-1' : 'text-sm mb-2'}`}>
          {title}
        </p>
      )}
      {helpText && (
        <p className="text-xs text-slate-400 mb-2">{helpText}</p>
      )}

      {/* Scanner viewport */}
      <div
        id={readerId.current}
        ref={containerRef}
        className={`rounded-lg overflow-hidden bg-slate-900 ${
          active ? (compact ? 'h-32' : 'h-48') : 'h-0'
        } transition-all`}
      />

      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      <div className="mt-2">
        {!active ? (
          <button
            type="button"
            onClick={start}
            className={`rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-medium transition-colors ${
              compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
            }`}
          >
            📷 Start Camera
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className={`rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors ${
              compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
            }`}
          >
            ⏹ Stop Camera
          </button>
        )}
      </div>
    </div>
  )
}
