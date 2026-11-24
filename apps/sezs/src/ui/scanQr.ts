import jsQR from 'jsqr'

/** QR decode: BarcodeDetector when present, jsQR as a fallback. */

const detectWithBarcode = async (source: CanvasImageSource | ImageBitmap | Blob): Promise<string> => {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return ''
  try {
    const Detector = (
      window as unknown as {
        BarcodeDetector: new (opts: { formats: string[] }) => {
          detect: (s: CanvasImageSource | ImageBitmap | Blob) => Promise<{ rawValue?: string }[]>
        }
      }
    ).BarcodeDetector
    const det = new Detector({ formats: ['qr_code'] })
    const hits = await det.detect(source)
    return String(hits[0]?.rawValue || '').trim()
  } catch {
    return ''
  }
}

const imageDataOf = async (source: CanvasImageSource | ImageBitmap | Blob | File): Promise<ImageData | null> => {
  try {
    let bmp: ImageBitmap | null = null
    if (source instanceof Blob) {
      bmp = await createImageBitmap(source)
    } else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      bmp = source
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (bmp) {
      canvas.width = bmp.width
      canvas.height = bmp.height
      ctx.drawImage(bmp, 0, 0)
      if (source instanceof Blob) bmp.close()
    } else {
      const el = source as CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
      const w = el.videoWidth || el.naturalWidth || el.width || 0
      const h = el.videoHeight || el.naturalHeight || el.height || 0
      if (!w || !h) return null
      canvas.width = w
      canvas.height = h
      ctx.drawImage(el, 0, 0, w, h)
    }
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch {
    return null
  }
}

export const detectQr = async (source: CanvasImageSource | ImageBitmap | Blob | File): Promise<string> => {
  const direct = source instanceof Blob ? '' : await detectWithBarcode(source)
  if (direct) return direct
  if (source instanceof Blob) {
    try {
      const bmp = await createImageBitmap(source)
      const hit = await detectWithBarcode(bmp)
      bmp.close()
      if (hit) return hit
    } catch {
      /* fall through to jsQR */
    }
  }
  const data = await imageDataOf(source)
  if (!data) return ''
  const hit = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' })
  return String(hit?.data || '').trim()
}

export const cameraAvailable = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  !!navigator.mediaDevices?.getUserMedia
