type QrFactory = (typeNumber: number, errorCorrectionLevel: string) => {
  addData: (data: string) => void
  make: () => void
  getModuleCount: () => number
  isDark: (row: number, col: number) => boolean
}

// CJS vendor build; webpack resolves require() reliably in the Next pages bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qrcode = require("./qrcode-generator.cjs") as QrFactory

type Props = { value: string; size?: number }

export const QrSvg = ({ value, size = 168 }: Props) => {
  const qr = qrcode(0, "M")
  qr.addData(value || " ")
  qr.make()
  const n = qr.getModuleCount()
  const cells: string[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) cells.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={n} height={n} fill="#fff1c9" />
      <path d={cells.join("")} fill="#07070a" />
    </svg>
  )
}

export default QrSvg
