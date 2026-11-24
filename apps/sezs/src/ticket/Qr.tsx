import { useMemo } from 'react'

import qrcode from './qrcode-generator.js'

type Props = { value: string; label?: string; className?: string }

export const TicketQr = ({ value, label, className }: Props) => {
  const svg = useMemo(() => {
    if (!value) return ''
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    if (typeof qr.createSvgTag === 'function') {
      try {
        return qr.createSvgTag({ scalable: true, cellSize: 4, margin: 2 })
      } catch {
        return qr.createSvgTag(4, 2)
      }
    }
    return ''
  }, [value])
  if (!svg) return null
  return (
    <div
      className={'ticket-qr' + (className ? ' ' + className : '')}
      aria-label={label || 'QR'}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
