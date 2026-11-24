import { Fingerprint } from '@mui/icons-material'

import { Button } from '../../buttons'
import { AuthMethodPanel } from './AuthMethodPanel'

export type PasskeyMode = 'choose' | 'existing' | 'create'

export type PasskeyLocalAccount = {
  id: string
  label: string
  credentialId: string
  pairedAddress?: string
}

export type PasskeyAuthStageProps = {
  mode: PasskeyMode
  busy?: boolean
  /** Truncated or short active credential display. */
  activeCredentialShort?: string | null
  activeAccount?: PasskeyLocalAccount | null
  accounts: PasskeyLocalAccount[]
  showPairing: boolean
  labels: {
    title: string
    boundHint: string
    notBoundHint: string
    activeLocal?: string
    useExisting: string
    create: string
    noAccounts: string
    back: string
    pairingOn: string
    pairingOff: string
  }
  onModeChange: (mode: PasskeyMode) => void
  onCreate: () => void
  onSelectExisting: (account: PasskeyLocalAccount) => void
  /** When true, panel uses Clear focus ring (chooser selection). */
  highlighted?: boolean
}

/**
 * Passkey / WebAuthn stage: choose → use existing | create.
 * Pairing copy only after wallet connect (showPairing).
 */
export const PasskeyAuthStage = ({
  mode,
  busy,
  activeCredentialShort,
  activeAccount,
  accounts,
  showPairing,
  labels,
  onModeChange,
  onCreate,
  onSelectExisting,
  highlighted,
}: PasskeyAuthStageProps) => (
  <AuthMethodPanel
    Icon={Fingerprint}
    description={
      activeCredentialShort
        ? labels.boundHint
        : labels.notBoundHint
    }
    footer={showPairing ? labels.pairingOn : labels.pairingOff}
    highlighted={highlighted}
    id="auth-method-panel-passkey"
    title={labels.title}
  >
    {activeAccount ? (
      <p className="secondary-text text-xs">
        {labels.activeLocal ?? activeAccount.label}
        {activeAccount.pairedAddress
          ? ` · ${activeAccount.pairedAddress.slice(0, 12)}…`
          : ''}
      </p>
    ) : null}

    {mode === 'choose' && (
      <div className="flex flex-row flex-wrap gap-2">
        <Button
          disabled={busy || accounts.length === 0}
          onClick={() => onModeChange('existing')}
          size="sm"
          variant="secondary"
        >
          {labels.useExisting}
          {accounts.length ? ` (${accounts.length})` : ''}
        </Button>
        <Button
          disabled={busy}
          loading={busy}
          onClick={onCreate}
          size="sm"
          variant="primary"
        >
          {labels.create}
        </Button>
      </div>
    )}

    {mode === 'existing' && (
      <div className="flex flex-col gap-2">
        {accounts.length === 0 ? (
          <p className="secondary-text text-xs">{labels.noAccounts}</p>
        ) : (
          accounts.map((account) => (
            <Button
              key={account.id}
              disabled={busy}
              onClick={() => onSelectExisting(account)}
              size="sm"
              variant="secondary"
            >
              {account.label}
              {' · '}
              {account.credentialId.slice(0, 12)}…
            </Button>
          ))
        )}
        <Button onClick={() => onModeChange('choose')} size="sm" variant="ghost">
          {labels.back}
        </Button>
      </div>
    )}
  </AuthMethodPanel>
)
