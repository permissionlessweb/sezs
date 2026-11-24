import { useEffect, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  InputErrorMessage,
  InputLabel,
  SwitchCard,
  TextAreaInput,
} from '@dao-dao/stateless'
import { ModuleEditorProps } from '@dao-dao/types'

import { CommunityGatewaysModuleData } from './types'

/**
 * Curator editor: intro + mesh merge + optional JSON list of gateways.
 * Full structured multi-row editor can land later; JSON keeps phase-0 small.
 */
export const CommunityGatewaysEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<CommunityGatewaysModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } =
    useFormContext<CommunityGatewaysModuleData>()

  const useChainMeshDefault = watch(
    (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault'
  )
  const showBuzzSteps = watch(
    (fieldNamePrefix + 'showBuzzSteps') as 'showBuzzSteps'
  )
  const showHermesSteps = watch(
    (fieldNamePrefix + 'showHermesSteps') as 'showHermesSteps'
  )
  const gateways = watch((fieldNamePrefix + 'gateways') as 'gateways')
  const [gatewaysText, setGatewaysText] = useState(() =>
    JSON.stringify(gateways || [], null, 2)
  )
  const [gatewaysError, setGatewaysError] = useState<string | null>(null)

  useEffect(() => {
    setGatewaysText(JSON.stringify(gateways || [], null, 2))
  }, [gateways])

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.communityGatewaysEditor', {
          defaultValue:
            'Unified Buzz + Hermes directory for DAO users. Lists public/registered gateway URLs and connect steps. Does not embed Hermes dashboards.',
        })}
      </p>

      <div className="space-y-2">
        <InputLabel name={t('form.description')} optional />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={4}
        />
        <InputErrorMessage error={errors?.description} />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!useChainMeshDefault}
        label={t('form.useChainMeshDefault', {
          defaultValue: 'Include mesh.v1 embeds + relays',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix + 'useChainMeshDefault') as 'useChainMeshDefault',
            !useChainMeshDefault,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={showBuzzSteps !== false}
        label={t('form.showBuzzSteps', {
          defaultValue: 'Show Buzz connect steps',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix + 'showBuzzSteps') as 'showBuzzSteps',
            !(showBuzzSteps !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={showHermesSteps !== false}
        label={t('form.showHermesSteps', {
          defaultValue: 'Show Hermes connect steps',
        })}
        onClick={() =>
          setValue(
            (fieldNamePrefix + 'showHermesSteps') as 'showHermesSteps',
            !(showHermesSteps !== false),
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <div className="space-y-2">
        <InputLabel
          name={t('form.gatewaysJson', {
            defaultValue: 'Gateways (JSON array)',
          })}
          optional
        />
        <textarea
          className="w-full rounded-md border border-border-primary bg-background-base p-2 font-mono text-xs min-h-[10rem]"
          disabled={!isCreating}
          onChange={(e) => {
            const raw = e.target.value
            setGatewaysText(raw)
            try {
              const parsed = JSON.parse(raw)
              if (!Array.isArray(parsed)) {
                setGatewaysError('Must be a JSON array')
                return
              }
              setGatewaysError(null)
              setValue((fieldNamePrefix + 'gateways') as 'gateways', parsed, {
                shouldValidate: true,
              })
            } catch {
              setGatewaysError('Invalid JSON')
            }
          }}
          value={gatewaysText}
        />
        {gatewaysError ? (
          <p className="text-xs text-text-interactive-error">{gatewaysError}</p>
        ) : (
          <p className="secondary-text text-xs">
            {t('info.gatewaysJsonHint', {
              defaultValue:
                'Fields: id, kind (buzz|hermes), label, url, visibility (public|registered|members|operators), optional relayWss, note.',
            })}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.meshJson', { defaultValue: 'mesh.v1 override (JSON)' })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          fieldName={(fieldNamePrefix + 'meshJson') as 'meshJson'}
          placeholder={t('form.meshJsonPlaceholder', {
            defaultValue:
              '{"v":1,"relays":[],"query":"","embeds":{"buzz":"…","hermes":"…"}}',
          })}
          register={register}
          rows={4}
        />
      </div>
    </div>
  )
}
