/**
 * Event Hub “Start here” walkthrough modal — first-paint orientation for event night.
 * Parent owns open state via useEventWalkthrough.
 */
import { useCallback, useState } from 'react'

export type EventWalkthroughModalProps = {
  visible: boolean
  onClose: () => void
}

const STEPS = [
  {
    title: 'Connect',
    body: 'Connect a wallet so membership and registration chips can resolve.',
  },
  {
    title: 'Register',
    body: 'When the Registered chip is not green, use Register for event to open the ceremony / schedule path.',
  },
  {
    title: 'Work · Collab · Ops',
    body: 'Use surface tabs for bounties (Work), Buzz (Collab), and Hermes (Ops when permitted).',
  },
]

export const EventWalkthroughModal = ({
  visible,
  onClose,
}: EventWalkthroughModalProps) => {
  if (!visible) {
    return null
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
    >
      <button
        aria-label="Close walkthrough backdrop"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border-primary bg-background-base p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="title-text text-text-body">Start here</p>
            <p className="secondary-text mt-1 text-sm">
              Three steps for tonight&apos;s Event Hub.
            </p>
          </div>
          <button
            className="caption-text text-xs opacity-70 hover:opacity-100"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => (
            <li
              className="rounded-md border border-border-secondary bg-background-secondary px-3 py-2"
              key={step.title}
            >
              <p className="primary-text text-sm">
                <span className="caption-text mr-2 opacity-60">{i + 1}.</span>
                {step.title}
              </p>
              <p className="secondary-text mt-1 text-xs leading-snug">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-md border border-border-interactive-hover bg-background-button px-3 py-1.5 text-xs font-medium text-text-button"
            onClick={onClose}
            type="button"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

export const useEventWalkthrough = () => {
  const [visible, setVisible] = useState(false)
  const open = useCallback(() => setVisible(true), [])
  const close = useCallback(() => setVisible(false), [])
  return { visible, open, close }
}
