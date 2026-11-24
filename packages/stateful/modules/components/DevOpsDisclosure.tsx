/**
 * Collapsed operator/debug details for module surfaces.
 * Keep primary UX clean; expand only when an operator needs mesh/probe URLs.
 */
import { ReactNode, useState } from 'react'

export type DevOpsDisclosureProps = {
  /** Summary label on the toggle (default: Operator details) */
  label?: string
  children: ReactNode
  className?: string
  /** Start expanded (default false) */
  defaultOpen?: boolean
}

export const DevOpsDisclosure = ({
  label = 'Operator details',
  children,
  className,
  defaultOpen = false,
}: DevOpsDisclosureProps) => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={className}>
      <button
        aria-expanded={open}
        className="caption-text flex items-center gap-1 text-left text-xs opacity-70 transition-opacity hover:opacity-100"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span aria-hidden className="inline-block w-3 font-mono">
          {open ? '▾' : '▸'}
        </span>
        {label}
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1 rounded-md border border-border-primary bg-background-tertiary/60 px-3 py-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export type DevOpsMonoLineProps = {
  label?: string
  value: string
  className?: string
}

/** Single monospaced key/value row for operator disclosures. */
export const DevOpsMonoLine = ({
  label,
  value,
  className,
}: DevOpsMonoLineProps) => (
  <p
    className={
      className ||
      'caption-text break-all font-mono text-[11px] leading-snug opacity-90'
    }
  >
    {label ? (
      <>
        <span className="opacity-70">{label}</span>
        <span className="opacity-50"> · </span>
      </>
    ) : null}
    {value}
  </p>
)
