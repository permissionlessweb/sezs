import { ComponentMeta, ComponentStory } from '@storybook/react'

import { Adr36AuthStage } from './Adr36AuthStage'
import { OcidJwtAuthStage } from './OcidJwtAuthStage'
import { PasskeyAuthStage } from './PasskeyAuthStage'
import { SmartAccountAuthStage } from './SmartAccountAuthStage'
import { StableAuthSection } from './StableAuthSection'
import { ZcashLoginAuthStage } from './ZcashLoginAuthStage'

export default {
  title:
    'DAO DAO / packages / stateless / components / wallet / auth / StableAuthSection',
  component: StableAuthSection,
} as ComponentMeta<typeof StableAuthSection>

const Template: ComponentStory<typeof StableAuthSection> = (args) => (
  <div className="max-w-lg rounded-lg border border-border-base bg-background-base">
    <StableAuthSection {...args} />
  </div>
)

export const ConnectVariant = Template.bind({})
ConnectVariant.args = {
  variant: 'connect',
  title: 'Stable auth',
  description:
    'Choose among planned auth methods for DAO membership. Extension wallets are listed above.',
  chooser: {
    title: 'Auth methods',
    hint: 'Fund movement and bounty authorize always need an explicit second step.',
    methods: [
      {
        id: 'passkey',
        label: 'Passkey / WebAuthn',
        description: 'Local device credential.',
        availability: 'ready',
        selectable: true,
      },
      {
        id: 'ocid_jwt',
        label: 'OCID / JWT bridge',
        description: 'Optional invite path.',
        availability: 'partial',
        selectable: true,
      },
      {
        id: 'adr36_bounties',
        label: 'ADR-36 bounties session',
        description: 'Membership proof for embed.',
        availability: 'ready',
        selectable: true,
      },
      {
        id: 'zcash_zecauth',
        label: 'Zcash Login — ZecAuth',
        description: 'Experimental.',
        availability: 'disabled',
        selectable: false,
        disabledReason: 'Flag off',
      },
    ],
    focusedMethodId: null,
    onSelect: () => undefined,
  },
  children: (
    <>
      <PasskeyAuthStage
        accounts={[]}
        labels={{
          title: 'Passkey / WebAuthn',
          boundHint: '',
          notBoundHint: 'No active passkey yet.',
          useExisting: 'Use existing',
          create: 'Create passkey account',
          noAccounts: 'No accounts',
          back: 'Back',
          pairingOn: 'Paired',
          pairingOff: 'Connect wallet to pair.',
        }}
        mode="choose"
        onCreate={() => undefined}
        onModeChange={() => undefined}
        onSelectExisting={() => undefined}
        showPairing={false}
      />
      <OcidJwtAuthStage
        connectHint="Optional onboarding invite — wallet connect does not require it."
        openOnboardingLabel="Onboarding invite (optional)"
        onOpenOnboarding={() => undefined}
        showSessionDetail={false}
        status="none"
        title="OCID / JWT session"
      />
      <Adr36AuthStage
        description="Membership uses wallet signArbitrary (ADR-36)."
        statusLine="Connect an extension wallet first."
        title="ADR-36 bounties session"
      />
      <SmartAccountAuthStage
        message="Connect on a smartaccount-enabled chain."
        state="need_wallet"
        title="Smart account"
      />
      <ZcashLoginAuthStage
        adapters={[
          {
            id: 'zcash_zecauth',
            label: 'ZecAuth',
            summary: 'Auth-isolated cosmos signArbitrary stand-in.',
          },
        ]}
        description="Flag-gated lab adapters. No seeds or UFVKs."
        experimentalNote="ZecAuth / zns-login / ZecPass stay behind NEXT_PUBLIC_ENABLE_ZCASH_* flags."
        onRunAdapter={() => undefined}
        title="Zcash Login lab adapters"
        walletConnected={false}
      />
    </>
  ),
}

export const ConnectedVariant = Template.bind({})
ConnectedVariant.args = {
  ...ConnectVariant.args,
  variant: 'connected',
  children: (
    <>
      <PasskeyAuthStage
        accounts={[
          {
            id: '1',
            label: 'Device key',
            credentialId: 'cred-xyz',
            pairedAddress: 'terp1demo…',
          },
        ]}
        activeAccount={{
          id: '1',
          label: 'Device key',
          credentialId: 'cred-xyz',
          pairedAddress: 'terp1demo…',
        }}
        activeCredentialShort="cred-xyz"
        labels={{
          title: 'Passkey / WebAuthn',
          boundHint: 'Active credential: cred-xyz…',
          notBoundHint: '',
          activeLocal: 'Local account: Device key',
          useExisting: 'Use existing',
          create: 'Create passkey account',
          noAccounts: 'No accounts',
          back: 'Back',
          pairingOn: 'Wallet connected — passkey can pair.',
          pairingOff: '',
        }}
        mode="choose"
        onCreate={() => undefined}
        onModeChange={() => undefined}
        onSelectExisting={() => undefined}
        showPairing
      />
      <OcidJwtAuthStage
        connectHint=""
        detail="2 PFPK / JWT token(s) on this profile"
        openOnboardingLabel="Onboarding invite (optional)"
        onOpenOnboarding={() => undefined}
        showSessionDetail
        status="session"
        title="OCID / JWT session"
      />
      <Adr36AuthStage
        description="Membership uses wallet signArbitrary (ADR-36)."
        statusLine="Wallet connected — open Bounties module to complete membership proof."
        title="ADR-36 bounties session"
      />
      <SmartAccountAuthStage
        authenticatorCount={1}
        selectedId="0"
        state="ready"
        title="Smart account"
      />
      <ZcashLoginAuthStage
        adapters={[
          {
            id: 'zcash_zecauth',
            label: 'ZecAuth',
            summary: 'Lab capability grant only.',
          },
        ]}
        description="Flag-gated. Uses cosmos signArbitrary as auth-isolated stand-in."
        onRunAdapter={() => undefined}
        title="Zcash Login lab adapters"
        walletConnected
      />
    </>
  ),
}
