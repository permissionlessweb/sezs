/**
 * Module help control — circular "?" opens a **centered** product Modal
 * with end-user documentation (not developer/ops notes).
 *
 * Copy guidelines for callers' `markdown`:
 * - Speak to DAO members / visitors (what · why · how to use)
 * - No mesh.v1, RPC, LCD, code IDs, or deploy jargon in the body
 * - Operator details stay under DevOpsDisclosure elsewhere
 */
import { useState } from 'react'

import { MarkdownRenderer, Modal } from '@dao-dao/stateless'

export type ModuleInfoPopoverProps = {
  /** Short title in the modal header (product name) */
  title: string
  /** Markdown — end-user module guide */
  markdown: string
  /** Accessible label for the trigger button */
  buttonLabel?: string
}

export const ModuleInfoPopover = ({
  title,
  markdown,
  buttonLabel = 'About this module',
}: ModuleInfoPopoverProps) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      <div className="inline-flex shrink-0 items-center self-center">
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={buttonLabel}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-primary bg-background-secondary text-sm font-medium leading-none text-text-secondary transition-colors hover:bg-background-interactive-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-interactive-focus"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span aria-hidden className="select-none">
            ?
          </span>
        </button>
      </div>

      <Modal
        containerClassName="!max-w-lg w-full"
        contentContainerClassName="!overflow-y-auto"
        header={{
          title,
        }}
        onClose={close}
        visible={open}
      >
        <div className="secondary-text prose-sm max-w-none text-sm leading-relaxed text-text-secondary">
          <MarkdownRenderer className="!text-sm" markdown={markdown} />
        </div>
      </Modal>
    </>
  )
}
