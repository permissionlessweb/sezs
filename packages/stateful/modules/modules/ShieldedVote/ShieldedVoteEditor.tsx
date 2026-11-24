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

import { DEFAULT_SHIELDED_CHOICES } from './constants'
import { ShieldedVoteModuleData } from './types'

export const ShieldedVoteEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<ShieldedVoteModuleData>) => {
  const { t } = useTranslation()
  const { register, watch, setValue } =
    useFormContext<ShieldedVoteModuleData>()

  const requireProof = watch(
    (fieldNamePrefix + 'requireProof') as 'requireProof'
  )
  const labMode = watch((fieldNamePrefix + 'labMode') as 'labMode')

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.shieldedVoteModuleEditor', {
          defaultValue:
            'ShieldedVote: client-side ElGamal encrypt + lab prove + lab/CW submit. Do not store plaintext votes. Lab proof is not Halo2; set labCastBaseUrl for stable lab usage.',
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
          name={t('form.defaultRoundId', {
            defaultValue: 'Default round / session id',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.defaultRoundId}
          fieldName={(fieldNamePrefix + 'defaultRoundId') as 'defaultRoundId'}
          placeholder="ceremony-session or vote round id"
          register={register}
        />
        <InputErrorMessage error={errors?.defaultRoundId} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.defaultProposalId', {
            defaultValue: 'Default proposal id',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.defaultProposalId}
          fieldName={
            (fieldNamePrefix + 'defaultProposalId') as 'defaultProposalId'
          }
          placeholder="optional proposal id"
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.eaPkHex', {
            defaultValue: 'EA public key (ea_pk hex, 32 bytes)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.eaPkHex}
          fieldName={(fieldNamePrefix + 'eaPkHex') as 'eaPkHex'}
          placeholder="64 lowercase hex chars (compressed Pallas)"
          register={register}
          validation={[
            (v) => {
              if (v == null || v === '') return true
              const h = String(v).replace(/^0x/i, '')
              if (!/^[0-9a-fA-F]{64}$/.test(h)) {
                return 'ea_pk must be 32-byte hex (64 chars) or empty'
              }
              return true
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.eaPkHexHint', {
            defaultValue:
              'From TSS ceremony / round query once wire format freezes (V-UI-0). Never paste ea_sk.',
          })}
        </p>
        <InputErrorMessage error={errors?.eaPkHex} />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.labCastBaseUrl', {
            defaultValue: 'Lab cast base URL (V-UI-4)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.labCastBaseUrl}
          fieldName={(fieldNamePrefix + 'labCastBaseUrl') as 'labCastBaseUrl'}
          placeholder="http://127.0.0.1:PORT (lab cast server)"
          register={register}
        />
        <p className="secondary-text text-xs">
          Stable lab submit with nullifier fail-closed. Prefer over chain until
          CosmWasm ceremony module is deployed.
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.castContract', {
            defaultValue: 'Cast contract (optional, V-UI-4)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.castContract}
          fieldName={(fieldNamePrefix + 'castContract') as 'castContract'}
          placeholder="terp1… cast / ceremony contract"
          register={register}
        />
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.choicesJson', {
            defaultValue: 'Choices JSON (id, label, value)',
          })}
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.choices as { message?: string } | undefined}
          fieldName={(fieldNamePrefix + 'choices') as 'choices'}
          placeholder={JSON.stringify(DEFAULT_SHIELDED_CHOICES, null, 2)}
          register={register}
          rows={6}
          validation={[
            (v) => {
              if (v == null || v === '') return true
              if (Array.isArray(v)) return true
              try {
                const arr = JSON.parse(String(v))
                if (!Array.isArray(arr) || arr.length === 0) {
                  return 'Must be a non-empty JSON array'
                }
                for (const item of arr) {
                  if (
                    !item ||
                    typeof item.id !== 'string' ||
                    typeof item.label !== 'string' ||
                    typeof item.value !== 'number'
                  ) {
                    return 'Each choice needs id, label, value'
                  }
                }
                return true
              } catch {
                return 'Invalid JSON for choices'
              }
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.shieldedChoicesHint', {
            defaultValue:
              'value is the ElGamal plaintext domain for client encrypt only — never logged or submitted in clear.',
          })}
        </p>
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!requireProof}
        label={t('form.requireProof', {
          defaultValue: 'Require cast proof (V-UI-2) before submit prep',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'requireProof') as 'requireProof',
            !requireProof,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <SwitchCard
        containerClassName="self-start"
        enabled={!!labMode}
        label={t('form.labMode', {
          defaultValue: 'Lab mode (honest residual banner)',
        })}
        onClick={() =>
          isCreating &&
          setValue((fieldNamePrefix + 'labMode') as 'labMode', !labMode, {
            shouldValidate: true,
          })
        }
        readOnly={!isCreating}
      />
    </div>
  )
}
