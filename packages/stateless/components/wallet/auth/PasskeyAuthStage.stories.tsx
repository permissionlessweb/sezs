import { useState } from 'react'
import { ComponentMeta, ComponentStory } from '@storybook/react'

import { PasskeyAuthStage, PasskeyMode } from './PasskeyAuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / PasskeyAuthStage',
  component: PasskeyAuthStage,
} as ComponentMeta<typeof PasskeyAuthStage>

const accounts = [
  {
    id: 'a1',
    label: 'Local passkey account',
    credentialId: 'cred-abc123def456',
    pairedAddress: 'terp1abcxyz…',
  },
]

const baseLabels = {
  title: 'Passkey / WebAuthn',
  boundHint: 'Active credential: cred-abc123…',
  notBoundHint:
    'No active passkey yet — use an existing local account or create one.',
  activeLocal: 'Local account: Local passkey account',
  useExisting: 'Use existing',
  create: 'Create passkey account',
  noAccounts: 'No local passkey accounts yet.',
  back: 'Back',
  pairingOn:
    'Wallet connected — passkey can pair to this address for local account continuity.',
  pairingOff:
    'Pairing to a chain address is available after you connect a wallet.',
}

const Interactive: ComponentStory<typeof PasskeyAuthStage> = (args) => {
  const [mode, setMode] = useState<PasskeyMode>('choose')
  return (
    <div className="max-w-md rounded-lg border border-border-base bg-background-base p-4">
      <PasskeyAuthStage
        {...args}
        mode={mode}
        onModeChange={setMode}
        onCreate={() => alert('create')}
        onSelectExisting={(a) => alert(`select ${a.id}`)}
      />
    </div>
  )
}

export const ChooseUnbound = Interactive.bind({})
ChooseUnbound.args = {
  accounts: [],
  showPairing: false,
  labels: baseLabels,
  activeCredentialShort: null,
}

export const ChooseWithAccountsPaired = Interactive.bind({})
ChooseWithAccountsPaired.args = {
  accounts,
  showPairing: true,
  activeCredentialShort: 'cred-abc123',
  activeAccount: accounts[0],
  labels: baseLabels,
}

export const ExistingList = Interactive.bind({})
ExistingList.args = {
  mode: 'existing',
  accounts,
  showPairing: true,
  labels: baseLabels,
}

export const BusyCreate = Interactive.bind({})
BusyCreate.args = {
  accounts: [],
  busy: true,
  showPairing: false,
  labels: baseLabels,
}

export const HighlightedChoose = Interactive.bind({})
HighlightedChoose.args = {
  accounts: [],
  showPairing: false,
  labels: baseLabels,
  activeCredentialShort: null,
  highlighted: true,
}
