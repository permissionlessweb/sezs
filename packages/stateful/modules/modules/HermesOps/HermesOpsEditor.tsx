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
import { LAB_HERMES_OPS_HTTP, resolveLabHermesOps } from '@dao-dao/utils'

import {
  DEFAULT_HERMES_DEEP_LINK,
  DEFAULT_HERMES_EMBED,
} from './constants'
import { HermesOpsModuleData } from './types'

export const HermesOpsEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<HermesOpsModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } = useFormContext<HermesOpsModuleData>()
  const labHermesPlaceholder = resolveLabHermesOps()

  const defaultView = watch(
    (fieldNamePrefix + 'defaultView') as 'defaultView'
  )
  const requireAdmin = watch(
    (fieldNamePrefix + 'requireAdmin') as 'requireAdmin'
  )
  const deepLinkOnly = watch(
    (fieldNamePrefix + 'deepLinkOnly') as 'deepLinkOnly'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.hermesOpsModuleEditor', {
          defaultValue:
            'Member-gated Hermes operator surface. Prefer deep-link until an embeddable ops HTTP UI exists. Never share bounty JWT or Hermes API keys via postMessage.',
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
        enabled={!!deepLinkOnly}
        label={t('form.deepLinkOnly', {
          defaultValue: 'Deep-link only (no iframe)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'deepLinkOnly') as 'deepLinkOnly',
            !deepLinkOnly,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />
      <p className="secondary-text text-xs">
        {t('info.hermesOpsDeepLinkOnlyHint', {
          defaultValue:
            'Recommended until Hermes ships an embeddable /hermes/embed surface. Avoids blank iframes.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel
          name={t('form.deepLinkUrl', { defaultValue: 'Deep-link URL' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.deepLinkUrl}
          fieldName={(fieldNamePrefix + 'deepLinkUrl') as 'deepLinkUrl'}
          placeholder={labHermesPlaceholder || DEFAULT_HERMES_DEEP_LINK}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesOpsDeepLinkLabHint', {
            defaultValue: `Lab (SDA host / build-host): ${LAB_HERMES_OPS_HTTP}. Production: ${DEFAULT_HERMES_DEEP_LINK}.`,
          })}
        </p>
        <InputErrorMessage error={errors?.deepLinkUrl} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.embedBaseUrl', {
            defaultValue: 'Embed base URL',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating || !!deepLinkOnly}
          error={errors?.embedBaseUrl}
          fieldName={(fieldNamePrefix + 'embedBaseUrl') as 'embedBaseUrl'}
          placeholder={labHermesPlaceholder || DEFAULT_HERMES_EMBED}
          register={register}
        />
        <p className="secondary-text text-xs">
          {t('info.hermesOpsEmbedBaseHint', {
            defaultValue: `Lab ops tunnel on build-host (${LAB_HERMES_OPS_HTTP}). Empty → chain services.hermesEmbed / ${DEFAULT_HERMES_EMBED}. Path /hermes/embed is appended when not deep-link-only.`,
          })}
        </p>
        <InputErrorMessage error={errors?.embedBaseUrl} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.defaultView', { defaultValue: 'Default view' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'defaultView') as 'defaultView',
              value,
              { shouldValidate: true }
            )
          }
          selected={defaultView}
          tabs={[
            {
              label: t('form.hermesViewKanban', { defaultValue: 'Kanban' }),
              value: 'kanban' as const,
            },
            {
              label: t('form.hermesViewGateway', { defaultValue: 'Gateway' }),
              value: 'gateway' as const,
            },
            {
              label: t('form.hermesViewStatus', { defaultValue: 'Status' }),
              value: 'status' as const,
            },
          ]}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!requireAdmin}
        label={t('form.requireAdmin', {
          defaultValue: 'Require DAO admin to open ops UI',
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
      <p className="secondary-text text-xs">
        {t('info.hermesOpsRequireAdminHint', {
          defaultValue:
            'Members always see the tab (OnlyMembers). When enabled, non-admin members get an operators-only empty state instead of the iframe/deep-link.',
        })}
      </p>
    </div>
  )
}
