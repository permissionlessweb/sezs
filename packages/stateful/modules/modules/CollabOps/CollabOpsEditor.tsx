import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SegmentedControls,
  SwitchCard,
  TextAreaInput,
  TextInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'
import {
  LAB_BUZZ_DUAL_HTTP,
  LAB_BUZZ_RELAY_HTTP,
  LAB_HERMES_OPS_HTTP,
  resolveLabBuzzEmbedShell,
  resolveLabHermesOps,
} from '@dao-dao/utils'

import { DEFAULT_BUZZ_EMBED } from '../Buzz/constants'
import { CollabOpsModuleData } from './types'

export const CollabOpsEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<CollabOpsModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<CollabOpsModuleData>()
  const labBuzzPlaceholder = resolveLabBuzzEmbedShell()
  const labHermesPlaceholder = resolveLabHermesOps()

  const buzzDefaultView = watch(
    (fieldNamePrefix + 'buzzDefaultView') as 'buzzDefaultView'
  )
  const enableDaoAttest = watch(
    (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest'
  )
  const hermesDeepLinkOnly = watch(
    (fieldNamePrefix + 'hermesDeepLinkOnly') as 'hermesDeepLinkOnly'
  )
  const privateVisibility = watch(
    (fieldNamePrefix + 'privateVisibility') as 'privateVisibility'
  )
  const defaultPlane = watch(
    (fieldNamePrefix + 'defaultPlane') as 'defaultPlane'
  )
  const useChainMeshDefault = watch(
    (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault'
  )
  const showLiveEmbeds = watch(
    (fieldNamePrefix + 'showLiveEmbeds') as 'showLiveEmbeds'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.collabOpsModuleEditor', {
          defaultValue:
            'Unified public (Buzz) + private (Hermes) info from mesh.v1. Prefer this over separate Buzz / Hermes Ops tabs. Private content is never forced into the public plane. Enable writes merge-safe mesh.v1 embeds.',
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

      <SwitchCard
        containerClassName="self-start"
        enabled={useChainMeshDefault !== false}
        label={t('form.useChainMeshDefault', {
          defaultValue: 'Resolve mesh.v1 (storage → module → chain defaults)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix +
              'useChainMeshDefault') as 'useChainMeshDefault',
            !(useChainMeshDefault !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={!!showLiveEmbeds}
        label={t('form.showLiveEmbeds', {
          defaultValue:
            'Show live embed slots (optional; Phase-1 prefers info + Open)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'showLiveEmbeds') as 'showLiveEmbeds',
            !showLiveEmbeds,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <div className="rounded-md border border-border-secondary p-3 space-y-3">
        <p className="primary-text text-sm">
          {t('title.collabOpsPublicPlane', {
            defaultValue: 'Public plane (Buzz)',
          })}
        </p>
        <div className="space-y-2">
          <InputLabel
            name={t('form.buzzEmbedBaseUrl', {
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
            placeholder={labBuzzPlaceholder || DEFAULT_BUZZ_EMBED}
            register={register}
          />
          <p className="secondary-text text-xs">
            {t('info.collabOpsBuzzEmbedHint', {
              defaultValue: `Lab: dual shell ${LAB_BUZZ_DUAL_HTTP} (SDA/build-host); relay SoT ${LAB_BUZZ_RELAY_HTTP} (deploy-host) is not iframe base.`,
            })}
          </p>
          <InputErrorMessage error={errors?.buzzEmbedBaseUrl} />
        </div>
        <div className="space-y-2">
          <InputLabel
            name={t('form.buzzDefaultView', {
              defaultValue: 'Buzz default view (live embed)',
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
                label: t('form.buzzViewPublic', { defaultValue: 'Public' }),
                value: 'public' as const,
              },
              {
                label: t('form.buzzViewEvent', { defaultValue: 'Event' }),
                value: 'event' as const,
              },
            ]}
          />
        </div>
        <SwitchCard
          containerClassName="self-start"
          enabled={!!enableDaoAttest}
          label={t('form.enableDaoAttest', {
            defaultValue: 'Enable DAO membership attest (room gates)',
          })}
          onClick={() =>
            isCreating &&
            setValue(
              (fieldNamePrefix + 'enableDaoAttest') as 'enableDaoAttest',
              !enableDaoAttest,
              { shouldValidate: true }
            )
          }
          readOnly={!isCreating}
        />
      </div>

      <div className="rounded-md border border-border-secondary p-3 space-y-3">
        <p className="primary-text text-sm">
          {t('title.collabOpsPrivatePlane', {
            defaultValue: 'Private plane (Hermes)',
          })}
        </p>
        <div className="space-y-2">
          <InputLabel
            name={t('form.hermesEmbedBaseUrl', {
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
          <InputErrorMessage error={errors?.hermesEmbedBaseUrl} />
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
            placeholder={labHermesPlaceholder || LAB_HERMES_OPS_HTTP}
            register={register}
          />
          <InputErrorMessage error={errors?.hermesDeepLinkUrl} />
        </div>
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
          <InputErrorMessage error={errors?.hermesBoardSlug} />
        </div>
        <SwitchCard
          containerClassName="self-start"
          enabled={!!hermesDeepLinkOnly}
          label={t('form.hermesDeepLinkOnly', {
            defaultValue: 'Deep-link only (no Hermes iframe)',
          })}
          onClick={() =>
            isCreating &&
            setValue(
              (fieldNamePrefix +
                'hermesDeepLinkOnly') as 'hermesDeepLinkOnly',
              !hermesDeepLinkOnly,
              { shouldValidate: true }
            )
          }
          readOnly={!isCreating}
        />
        <div className="space-y-2">
          <InputLabel
            name={t('form.privateVisibility', {
              defaultValue: 'Private plane visibility',
            })}
          />
          <SegmentedControls
            disabled={!isCreating}
            onSelect={(value) =>
              setValue(
                (fieldNamePrefix + 'privateVisibility') as 'privateVisibility',
                value,
                { shouldValidate: true }
              )
            }
            selected={privateVisibility}
            tabs={[
              {
                label: t('form.onlyMembers', { defaultValue: 'Members' }),
                value: 'only-members' as const,
              },
              {
                label: t('form.adminsOnly', { defaultValue: 'Admins' }),
                value: 'admins' as const,
              },
              {
                label: t('form.hidden', { defaultValue: 'Hidden' }),
                value: 'hidden' as const,
              },
            ]}
          />
        </div>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.defaultPlane', { defaultValue: 'Default plane' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'defaultPlane') as 'defaultPlane',
              value,
              { shouldValidate: true }
            )
          }
          selected={defaultPlane}
          tabs={[
            {
              label: t('form.public', { defaultValue: 'Public' }),
              value: 'public' as const,
            },
            {
              label: t('form.private', { defaultValue: 'Private' }),
              value: 'private' as const,
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.collabOpsDefaultPlaneHint', {
            defaultValue:
              'If Private is selected but the viewer is not allowed, the UI falls back to Public (never leaks ops).',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.meshJson', {
            defaultValue: 'Advanced mesh.v1 JSON (optional)',
          })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.meshJson}
          fieldName={(fieldNamePrefix + 'meshJson') as 'meshJson'}
          placeholder='{"v":1,"relays":[],"query":"","embeds":{"buzz":"https://…"}}'
          register={register}
          rows={4}
        />
        <InputErrorMessage error={errors?.meshJson} />
        <p className="secondary-text text-xs">
          {t('info.collabOpsMeshJsonHint', {
            defaultValue:
              'Same key as DAO storage / billboard text record. Enable merges embeds into mesh.v1 (Nostr discovery content). Never invent relays.',
          })}
        </p>
      </div>
    </div>
  )
}
