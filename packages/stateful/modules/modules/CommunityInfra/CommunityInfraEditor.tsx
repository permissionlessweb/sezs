import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SwitchCard,
  TextAreaInput,
  TextInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'

import {
  DEFAULT_EVENT_HUB_RESIDUAL_DOCS,
  DEFAULT_HERMES_BOARD_LABEL,
  DEFAULT_HERMES_DEEP_LINK,
  DEFAULT_REGISTRY_POINTER,
} from './constants'
import { CommunityInfraModuleData } from './types'

export const CommunityInfraEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<CommunityInfraModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<CommunityInfraModuleData>()

  const useEndpointsSsotDefaults = watch(
    (fieldNamePrefix + 'useEndpointsSsotDefaults') as 'useEndpointsSsotDefaults'
  )
  const useLabImageDigests = watch(
    (fieldNamePrefix + 'useLabImageDigests') as 'useLabImageDigests'
  )
  const requireAdmin = watch(
    (fieldNamePrefix + 'requireAdmin') as 'requireAdmin'
  )
  const enableResidualSpawn = watch(
    (fieldNamePrefix + 'enableResidualSpawn') as 'enableResidualSpawn'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.communityInfraModuleEditor', {
          defaultValue:
            'Multi-instance community infra matrix (M1–M3). Seeds from ENDPOINTS-SSOT + LAB-IMAGE-DIGESTS. HermesOps board deep-link + dual-gated residual spawn (no Akash LIVE). No secrets.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel name={t('form.description')} optional />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={3}
        />
        <InputErrorMessage error={errors?.description} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.instanceLabel', { defaultValue: 'Instance label' })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.instanceLabel}
          fieldName={(fieldNamePrefix + 'instanceLabel') as 'instanceLabel'}
          placeholder="lab banana · 120u-1"
          register={register}
        />
        <InputErrorMessage error={errors?.instanceLabel} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.location', { defaultValue: 'Location' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.location}
          fieldName={(fieldNamePrefix + 'location') as 'location'}
          placeholder="local | mesh | akash | unknown"
          register={register}
        />
        <InputErrorMessage error={errors?.location} />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={useEndpointsSsotDefaults !== false}
        label={t('form.useEndpointsSsotDefaults', {
          defaultValue:
            'Seed multi-instance from ENDPOINTS-SSOT (lab local + collab mesh)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix +
              'useEndpointsSsotDefaults') as 'useEndpointsSsotDefaults',
            !(useEndpointsSsotDefaults !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={useLabImageDigests !== false}
        label={t('form.useLabImageDigests', {
          defaultValue:
            'Attach LAB-IMAGE-DIGESTS pins (localterp / buzz-lab) on matching roles',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'useLabImageDigests') as 'useLabImageDigests',
            !(useLabImageDigests !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <p className="secondary-text text-xs">
        {t('info.communityInfraMultiInstanceNote', {
          defaultValue:
            'Default instances: lab-local (127.0.0.1 chain/faucet/buzz dual) + collab-mesh (Buzz/HM on localhost). Advanced multi-instance JSON can be set via proposal variables.instances when needed; empty list uses the defaults above.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel
          name={t('form.buzzCanonicalUrl', {
            defaultValue: 'Buzz canonical URL (collab mesh override)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.buzzCanonicalUrl}
          fieldName={
            (fieldNamePrefix + 'buzzCanonicalUrl') as 'buzzCanonicalUrl'
          }
          placeholder="http://localhost:3000"
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.buzzDualUrl', { defaultValue: 'Buzz dual URL' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.buzzDualUrl}
          fieldName={(fieldNamePrefix + 'buzzDualUrl') as 'buzzDualUrl'}
          placeholder="http://127.0.0.1:3001"
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.hashMerchantUrl', {
            defaultValue: 'HashMerchant URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.hashMerchantUrl}
          fieldName={(fieldNamePrefix + 'hashMerchantUrl') as 'hashMerchantUrl'}
          placeholder="http://localhost:19090"
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.hermesBoardLabel', {
            defaultValue: 'Hermes board label',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.hermesBoardLabel}
          fieldName={
            (fieldNamePrefix + 'hermesBoardLabel') as 'hermesBoardLabel'
          }
          placeholder={DEFAULT_HERMES_BOARD_LABEL}
          register={register}
        />
      </div>

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
          placeholder={DEFAULT_HERMES_DEEP_LINK}
          register={register}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={enableResidualSpawn !== false}
        label={t('form.enableResidualSpawn', {
          defaultValue:
            'Enable dual-gated residual spawn (Hermes draft only; no Akash LIVE)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix +
              'enableResidualSpawn') as 'enableResidualSpawn',
            !(enableResidualSpawn !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <div className="space-y-2">
        <InputLabel
          name={t('form.registryPointer', {
            defaultValue: 'Registry / digest pointer',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.registryPointer}
          fieldName={(fieldNamePrefix + 'registryPointer') as 'registryPointer'}
          placeholder={DEFAULT_REGISTRY_POINTER}
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.eventHubResidualDocsUrl', {
            defaultValue: 'Event Hub residual docs path/URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.eventHubResidualDocsUrl}
          fieldName={
            (fieldNamePrefix +
              'eventHubResidualDocsUrl') as 'eventHubResidualDocsUrl'
          }
          placeholder={DEFAULT_EVENT_HUB_RESIDUAL_DOCS}
          register={register}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!requireAdmin}
        label={t('form.requireAdmin', {
          defaultValue: 'Require DAO admin to open matrix',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'requireAdmin') as 'requireAdmin',
            !requireAdmin,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />
    </div>
  )
}
