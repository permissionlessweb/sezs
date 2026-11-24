/**
 * EventHub Editor — enable shell.
 *
 * Checklist-driven form aligned with CURATOR-CHECKLIST.md. Exposes fields for
 * calendar/ceremony, mesh defaults, embed bases, deep-link policy, surface
 * views, registration/buzz/hermes policies, and optional event story.
 */
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  AddressInput,
  InputErrorMessage,
  InputLabel,
  SegmentedControls,
  SwitchCard,
  TextAreaInput,
  TextInput,
  useActionOptions,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import {
  LAB_BUZZ_DUAL_HTTP,
  LAB_BUZZ_RELAY_HTTP,
  LAB_CALENDAR_CONTRACT,
  LAB_HERMES_OPS_HTTP,
  MESH_STORAGE_KEY,
  makeValidateAddress,
  resolveLabBountiesEmbed,
  resolveLabBuzzEmbedShell,
  resolveLabCalendarContract,
  resolveLabHermesOps,
} from '@dao-dao/utils'

import { EventHubModuleData } from './types'

export const EventHubEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<EventHubModuleData>) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, setValue, watch } = useFormContext<
    EventHubModuleData & Record<string, unknown>
  >()
  const labBuzzPlaceholder = resolveLabBuzzEmbedShell()
  const labHermesPlaceholder = resolveLabHermesOps()
  const labBountiesPlaceholder = resolveLabBountiesEmbed()
  const labCalendarPlaceholder = resolveLabCalendarContract()

  const useChainMeshDefault = watch(
    (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault'
  )
  const hermesDeepLinkOnly = watch(
    (fieldNamePrefix + 'hermesDeepLinkOnly') as 'hermesDeepLinkOnly'
  )
  const enableDaoAttest = watch(
    (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest'
  )
  const buzzDefaultView = watch(
    (fieldNamePrefix + 'buzzDefaultView') as 'buzzDefaultView'
  )
  const bountiesDefaultView = watch(
    (fieldNamePrefix + 'bountiesDefaultView') as 'bountiesDefaultView'
  )
  const registrationPolicy = watch(
    (fieldNamePrefix + 'registrationPolicy') as 'registrationPolicy'
  )
  const buzzGate = watch((fieldNamePrefix + 'buzzGate') as 'buzzGate')
  const hermesVisibility = watch(
    (fieldNamePrefix + 'hermesVisibility') as 'hermesVisibility'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.eventHubModuleEditor', {
          defaultValue:
            'Enable the Event Hub to unify calendar, bounties, Buzz, and Hermes ops into a single event-centric tab. Configure the calendar contract, embed bases, and optional ceremony address.',
        })}
      </p>

      {/* Description */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.description', { defaultValue: 'Description' })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={3}
        />
        <InputErrorMessage error={errors?.description} />
      </div>

      {/* Event story (C1) */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.eventTitle', { defaultValue: 'Event title' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.eventTitle}
          fieldName={(fieldNamePrefix + 'eventTitle') as 'eventTitle'}
          register={register}
        />
        <InputErrorMessage error={errors?.eventTitle} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.eventAudience', { defaultValue: 'Audience' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.eventAudience}
          fieldName={(fieldNamePrefix + 'eventAudience') as 'eventAudience'}
          register={register}
        />
        <InputErrorMessage error={errors?.eventAudience} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.eventCodeOfConductUrl', {
            defaultValue: 'Code of conduct URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.eventCodeOfConductUrl}
          fieldName={
            (fieldNamePrefix +
              'eventCodeOfConductUrl') as 'eventCodeOfConductUrl'
          }
          register={register}
        />
        <InputErrorMessage error={errors?.eventCodeOfConductUrl} />
      </div>

      {/* Default event slug / deep-link seed */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.defaultEventSlug', {
            defaultValue: 'Default event slug / id',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.defaultEventSlug}
          fieldName={
            (fieldNamePrefix + 'defaultEventSlug') as 'defaultEventSlug'
          }
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.defaultEventSlugHint', {
            defaultValue:
              'Pre-selects this event when the Hub loads (deep-link / proposal entry). Users can still pick another from the strip.',
          })}
        </p>
        <InputErrorMessage error={errors?.defaultEventSlug} />
      </div>

      {/* Calendar contract */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.calendarContract', {
            defaultValue: 'Calendar contract',
          })}
          optional
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.calendarContract}
          fieldName={
            (fieldNamePrefix + 'calendarContract') as 'calendarContract'
          }
          placeholder={labCalendarPlaceholder || LAB_CALENDAR_CONTRACT}
          register={register}
          type="contract"
          validation={[makeValidateAddress(bech32Prefix)]}
        />
        <p className="secondary-text text-xs">
          {t('info.calendarContractHint', {
            defaultValue: `Lab 120u-1 open-lab calendar: ${LAB_CALENDAR_CONTRACT}. Events from this contract populate the Event Hub strip.`,
          })}
        </p>
        <InputErrorMessage error={errors?.calendarContract} />
      </div>

      {/* Ceremony contract (optional) */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.ceremonyContract', {
            defaultValue: 'Ceremony contract',
          })}
          optional
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.ceremonyContract}
          fieldName={
            (fieldNamePrefix + 'ceremonyContract') as 'ceremonyContract'
          }
          register={register}
          type="contract"
          validation={[makeValidateAddress(bech32Prefix)]}
        />
        <p className="secondary-text text-xs">
          {t('info.ceremonyContractHint', {
            defaultValue:
              'Optional cw-vote-ceremony contract for ZK vote registration. Enables the Registered and Can Vote chips.',
          })}
        </p>
        <InputErrorMessage error={errors?.ceremonyContract} />
      </div>

      {/* Registration policy (C4) */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.registrationPolicy', {
            defaultValue: 'Registration policy',
          })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix +
                'registrationPolicy') as 'registrationPolicy',
              value,
              { shouldValidate: true }
            )
          }
          selected={registrationPolicy}
          tabs={[
            {
              label: t('form.registrationOpen', { defaultValue: 'Open' }),
              value: 'open' as const,
            },
            {
              label: t('form.registrationMembers', {
                defaultValue: 'Members',
              }),
              value: 'members' as const,
            },
            {
              label: t('form.registrationCeremony', {
                defaultValue: 'Ceremony',
              }),
              value: 'ceremony' as const,
            },
          ]}
        />
      </div>

      {/* Use chain mesh default */}
      <SwitchCard
        containerClassName="self-start"
        enabled={useChainMeshDefault !== false}
        label={t('form.useChainMeshDefault', {
          defaultValue: 'Use chain headstash mesh defaults',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault',
            useChainMeshDefault === false,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
        tooltip={t('info.useChainMeshDefaultTooltip', {
          defaultValue: `When on, frontends resolve query/relays from services.headstashServer if DAO storage "${MESH_STORAGE_KEY}" is empty. Turn off only if you supply meshJson or require an on-chain mesh.v1 item.`,
        })}
      />

      {/* Mesh JSON (advanced) */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.meshJson', {
            defaultValue: 'mesh.v1 JSON (optional advanced)',
          })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.meshJson}
          fieldName={(fieldNamePrefix + 'meshJson') as 'meshJson'}
          placeholder={`{"v":1,"relays":["wss://…"],"query":"https://…","calendar":"terp1…","embeds":{"bounties":"…","buzz":"…","hermes":"…"}}`}
          register={register}
          rows={4}
        />
        <p className="secondary-text text-xs">
          {t('info.meshJsonHint', {
            defaultValue: `If set and valid, this JSON is written to DAO storage "${MESH_STORAGE_KEY}" on enable. Otherwise chain headstash defaults + calendar + embed bases are published.`,
          })}
        </p>
        <InputErrorMessage error={errors?.meshJson} />
      </div>

      {/* Embed base URLs */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.bountiesEmbedBase', {
            defaultValue: 'Bounties embed base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.bountiesEmbedBaseUrl}
          fieldName={
            (fieldNamePrefix + 'bountiesEmbedBaseUrl') as 'bountiesEmbedBaseUrl'
          }
          placeholder={labBountiesPlaceholder}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.bountiesEmbedBaseHint', {
            defaultValue:
              'Lab: SDA host bounties FE (build-host). Empty → mesh.embeds.bounties → chain services.',
          })}
        </p>
        <InputErrorMessage error={errors?.bountiesEmbedBaseUrl} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.bountiesDefaultView', {
            defaultValue: 'Bounties default view',
          })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix +
                'bountiesDefaultView') as 'bountiesDefaultView',
              value,
              { shouldValidate: true }
            )
          }
          selected={bountiesDefaultView}
          tabs={[
            {
              label: t('form.viewMembers', { defaultValue: 'Members' }),
              value: 'members' as const,
            },
            {
              label: t('form.viewPublic', { defaultValue: 'Public' }),
              value: 'public' as const,
            },
          ]}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.buzzEmbedBase', {
            defaultValue: 'Buzz embed base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.buzzEmbedBaseUrl}
          fieldName={
            (fieldNamePrefix + 'buzzEmbedBaseUrl') as 'buzzEmbedBaseUrl'
          }
          placeholder={labBuzzPlaceholder}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.eventHubBuzzEmbedHint', {
            defaultValue: `Lab embed shell ${LAB_BUZZ_DUAL_HTTP} (SDA/build-host dual); relay SoT ${LAB_BUZZ_RELAY_HTTP} (deploy-host) is not iframe base. Empty → mesh.embeds.buzz → chain services.`,
          })}
        </p>
        <InputErrorMessage error={errors?.buzzEmbedBaseUrl} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.buzzDefaultView', {
            defaultValue: 'Buzz default view',
          })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'buzzDefaultView') as 'buzzDefaultView',
              value,
              { shouldValidate: true }
            )
          }
          selected={buzzDefaultView}
          tabs={[
            {
              label: t('form.viewEvent', { defaultValue: 'Event' }),
              value: 'event' as const,
            },
            {
              label: t('form.viewPublic', { defaultValue: 'Public' }),
              value: 'public' as const,
            },
          ]}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.buzzGate', { defaultValue: 'Buzz room gate' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue((fieldNamePrefix + 'buzzGate') as 'buzzGate', value, {
              shouldValidate: true,
            })
          }
          selected={buzzGate}
          tabs={[
            {
              label: t('form.gatePublic', { defaultValue: 'Public' }),
              value: 'public' as const,
            },
            {
              label: t('form.gateDaoMember', { defaultValue: 'DAO member' }),
              value: 'dao-member' as const,
            },
            {
              label: t('form.gateRegistered', { defaultValue: 'Registered' }),
              value: 'registered' as const,
            },
          ]}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={enableDaoAttest !== false}
        label={t('form.enableDaoAttest', {
          defaultValue: 'Enable DAO attest (ADR-36) for Buzz',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest',
            enableDaoAttest === false,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
        tooltip={t('info.enableDaoAttestTooltip', {
          defaultValue:
            'When on, the Buzz iframe may request an ADR-36 daoAttest signature for gated rooms. Never posts nsec or bounty JWT.',
        })}
      />

      <div className="space-y-2">
        <InputLabel
          name={t('form.hermesEmbedBase', {
            defaultValue: 'Hermes embed base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.hermesEmbedBaseUrl}
          fieldName={
            (fieldNamePrefix + 'hermesEmbedBaseUrl') as 'hermesEmbedBaseUrl'
          }
          placeholder={labHermesPlaceholder || LAB_HERMES_OPS_HTTP}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesEmbedBaseHint', {
            defaultValue: `Lab Hermes on SDA/build-host (${LAB_HERMES_OPS_HTTP}). Empty → mesh.embeds.hermes → chain services.`,
          })}
        </p>
        <InputErrorMessage error={errors?.hermesEmbedBaseUrl} />
      </div>

      {/* Hermes deep-link URL */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.hermesDeepLinkUrl', {
            defaultValue: 'Hermes deep-link URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.hermesDeepLinkUrl}
          fieldName={
            (fieldNamePrefix + 'hermesDeepLinkUrl') as 'hermesDeepLinkUrl'
          }
          placeholder={labHermesPlaceholder || LAB_HERMES_OPS_HTTP}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesDeepLinkHint', {
            defaultValue:
              'Optional Hermes deep-link URL for the ops surface. Used when no embed host is configured.',
          })}
        </p>
        <InputErrorMessage error={errors?.hermesDeepLinkUrl} />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={hermesDeepLinkOnly !== false}
        label={t('form.hermesDeepLinkOnly', {
          defaultValue: 'Hermes deep-link only (no iframe)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'hermesDeepLinkOnly') as 'hermesDeepLinkOnly',
            hermesDeepLinkOnly === false,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
        tooltip={t('info.hermesDeepLinkOnlyTooltip', {
          defaultValue:
            'Recommended until Hermes ships an embeddable ops surface. Avoids blank iframes.',
        })}
      />

      {/* Hermes board slug */}
      <div className="space-y-2">
        <InputLabel
          name={t('form.hermesBoardSlug', {
            defaultValue: 'Hermes board slug',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.hermesBoardSlug}
          fieldName={
            (fieldNamePrefix + 'hermesBoardSlug') as 'hermesBoardSlug'
          }
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesBoardSlugHint', {
            defaultValue:
              'Hermes kanban board slug for event facilitators. Deep-linked in the Ops slot.',
          })}
        </p>
        <InputErrorMessage error={errors?.hermesBoardSlug} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.hermesVisibility', {
            defaultValue: 'Hermes Ops visibility',
          })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'hermesVisibility') as 'hermesVisibility',
              value,
              { shouldValidate: true }
            )
          }
          selected={hermesVisibility}
          tabs={[
            {
              label: t('form.hermesOnlyMembers', {
                defaultValue: 'Members',
              }),
              value: 'only-members' as const,
            },
            {
              label: t('form.hermesAdmins', { defaultValue: 'Admins' }),
              value: 'admins' as const,
            },
            {
              label: t('form.hermesHidden', { defaultValue: 'Hidden' }),
              value: 'hidden' as const,
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesVisibilityHint', {
            defaultValue:
              'Controls who sees the Ops tab. Hidden never mounts Hermes. Admins require wallet match to DAO/contract admin.',
          })}
        </p>
      </div>
    </div>
  )
}
