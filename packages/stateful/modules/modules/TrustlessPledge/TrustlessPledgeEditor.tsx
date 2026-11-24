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
  PledgeDigestAlg,
  makeValidateAddress,
  validateRequired,
} from '@dao-dao/utils'

import { TrustlessPledgeModuleData } from './types'

const DIGEST_TABS: { label: string; value: PledgeDigestAlg }[] = [
  { label: 'blake2b256', value: 'blake2b256' },
  { label: 'blake3', value: 'blake3' },
  { label: 'sha256', value: 'sha256' },
]

export const TrustlessPledgeEditor = ({
  fieldNamePrefix,
  isCreating,
  errors,
}: ModuleEditorProps<TrustlessPledgeModuleData>) => {
  const { t } = useTranslation()
  const {
    chain: { bech32Prefix },
  } = useActionOptions()
  const { register, watch, setValue } =
    useFormContext<TrustlessPledgeModuleData>()

  const digestAlg = watch(
    (fieldNamePrefix + 'digestAlg') as 'digestAlg'
  ) as PledgeDigestAlg
  const onePerWallet = watch(
    (fieldNamePrefix + 'onePerWallet') as 'onePerWallet'
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="secondary-text text-sm">
        {t('info.trustlessPledgeModuleEditor', {
          defaultValue:
            'Trustlessness Pledge: wallets compute an ADR-032 digest over manifesto CID + optional project_id + multi-destination commitments, then mint only after ADR-36 auth (DST+nonce|digest). Contract verifies the signature and one-time nonce; chain ownership is source of truth for hasPledged.',
        })}
      </p>

      <div className="space-y-1">
        <InputLabel
          name={t('form.collectionAddress', {
            defaultValue: 'Pledge collection (cw721_svg)',
          })}
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.collection}
          fieldName={(fieldNamePrefix + 'collection') as 'collection'}
          register={register}
          type="contract"
          validation={[validateRequired, makeValidateAddress(bech32Prefix)]}
        />
        <InputErrorMessage error={errors?.collection} />
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.svgMinter', {
            defaultValue: 'SVG minter (optional)',
          })}
          optional
        />
        <AddressInput
          disabled={!isCreating}
          error={errors?.minter}
          fieldName={(fieldNamePrefix + 'minter') as 'minter'}
          register={register}
          type="contract"
          validation={[makeValidateAddress(bech32Prefix, false)]}
        />
        <InputErrorMessage error={errors?.minter} />
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.manifestoCid', {
            defaultValue: 'Manifesto IPFS CID',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.manifestoCid}
          fieldName={(fieldNamePrefix + 'manifestoCid') as 'manifestoCid'}
          placeholder="bafy… (required before sign & mint)"
          register={register}
        />
        <InputErrorMessage error={errors?.manifestoCid} />
        <p className="secondary-text text-xs">
          {t('info.manifestoCidHint', {
            defaultValue:
              'Canonical IPFS CID (or ipfs:// / https URL). SDA fetches and shows the text in-module; chain mint still binds this CID into the ADR-032 digest.',
          })}
        </p>
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.teamCid', {
            defaultValue: 'Team variant CID (optional)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.teamCid}
          fieldName={(fieldNamePrefix + 'teamCid') as 'teamCid'}
          placeholder="bafy… team-specific pledge text"
          register={register}
        />
        <InputErrorMessage error={errors?.teamCid} />
        <p className="secondary-text text-xs">
          {t('info.teamCidHint', {
            defaultValue:
              'Optional second document slot (team variant). Same IPFS gateway pipeline as the manifesto.',
          })}
        </p>
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.ipfsGateway', { defaultValue: 'IPFS gateway base' })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.ipfsGateway}
          fieldName={(fieldNamePrefix + 'ipfsGateway') as 'ipfsGateway'}
          placeholder="https://ipfs.terp.network/ipfs/"
          register={register}
          validation={[validateRequired]}
        />
        <InputErrorMessage error={errors?.ipfsGateway} />
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.pledgeSiteUrl', {
            defaultValue: 'Pledge website (public home)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.pledgeSiteUrl}
          fieldName={(fieldNamePrefix + 'pledgeSiteUrl') as 'pledgeSiteUrl'}
          placeholder="https://permissionless.money/pledge"
          register={register}
          validation={[
            (v) =>
              !v ||
              (typeof v === 'string' &&
                (v.startsWith('https://') || v.startsWith('http://'))) ||
              'Must be an http(s) URL.',
          ]}
        />
        <InputErrorMessage error={errors?.pledgeSiteUrl} />
        <p className="secondary-text text-xs">
          {t('info.pledgeSiteUrlHint', {
            defaultValue:
              'Primary “Visit site” button. Defaults to permissionless.money/pledge — not the Fileverse deep link.',
          })}
        </p>
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.pledgeDocUrl', {
            defaultValue: 'Full pledge text (Fileverse)',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.pledgeDocUrl}
          fieldName={(fieldNamePrefix + 'pledgeDocUrl') as 'pledgeDocUrl'}
          register={register}
          validation={[
            validateRequired,
            (v) =>
              !v ||
              (typeof v === 'string' && v.startsWith('https://')) ||
              'Must be an https URL.',
          ]}
        />
        <InputErrorMessage error={errors?.pledgeDocUrl} />
        <p className="secondary-text text-xs">
          {t('info.pledgeDocUrlHint', {
            defaultValue:
              'Secondary long-form document. The module card leads with the website first.',
          })}
        </p>
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.signDomain', {
            defaultValue: 'ADR-032 domain tag',
          })}
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.signDomain}
          fieldName={(fieldNamePrefix + 'signDomain') as 'signDomain'}
          placeholder="terp-adr032/v1"
          register={register}
          validation={[validateRequired]}
        />
        <InputErrorMessage error={errors?.signDomain} />
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.projectId', {
            defaultValue: 'Project ID (optional scope)',
          })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.projectId}
          fieldName={(fieldNamePrefix + 'projectId') as 'projectId'}
          placeholder="grant-zcg-369 / dao-core / product slug"
          register={register}
        />
        <InputErrorMessage error={errors?.projectId} />
        <p className="secondary-text text-xs">
          {t('info.projectIdHint', {
            defaultValue:
              'Bound into the ADR-032 preimage as project_id. Leave empty for an unscoped pledge. Use a stable id so the same project always hashes the same way.',
          })}
        </p>
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.commitmentsJson', {
            defaultValue: 'Data commitments JSON (optional)',
          })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.commitments as { message?: string } | undefined}
          fieldName={(fieldNamePrefix + 'commitments') as 'commitments'}
          placeholder={`[\n  { "kind": "ipfs", "ref": "bafy…", "digestHex": "0x…" },\n  { "kind": "dao_proposal", "ref": "morocco-1:42", "digestHex": "…" }\n]`}
          register={register}
          rows={5}
          validation={[
            (v) => {
              if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
                return true
              }
              try {
                const arr = Array.isArray(v)
                  ? v
                  : JSON.parse(String(v))
                if (!Array.isArray(arr)) {
                  return 'Must be a JSON array'
                }
                for (const item of arr) {
                  if (
                    !item ||
                    typeof item.kind !== 'string' ||
                    typeof item.ref !== 'string' ||
                    typeof item.digestHex !== 'string'
                  ) {
                    return 'Each commitment needs kind, ref, digestHex strings'
                  }
                }
                return true
              } catch {
                return 'Invalid JSON for commitments'
              }
            },
          ]}
        />
        <p className="secondary-text text-xs">
          {t('info.commitmentsHint', {
            defaultValue:
              'Optional multi-destination pledges. Each entry: { kind, ref, digestHex }. Canonical form is sorted kind|ref|digest lines bound into the ADR-032 preimage (prepare for boards, proposals, milestones, other DSTs).',
          })}
        </p>
      </div>

      <div className="space-y-2">
        <InputLabel
          name={t('form.digestAlg', { defaultValue: 'Digest algorithm' })}
        />
        <SegmentedControls
          disabled={!isCreating}
          onSelect={(value) =>
            setValue(
              (fieldNamePrefix + 'digestAlg') as 'digestAlg',
              value,
              { shouldValidate: true }
            )
          }
          selected={digestAlg}
          tabs={DIGEST_TABS}
        />
      </div>

      <SwitchCard
        containerClassName="self-start"
        enabled={!!onePerWallet}
        label={t('form.onePerWallet', {
          defaultValue: 'One pledge NFT per wallet (UI gate)',
        })}
        onClick={() =>
          isCreating &&
          setValue(
            (fieldNamePrefix + 'onePerWallet') as 'onePerWallet',
            !onePerWallet,
            { shouldValidate: true }
          )
        }
        readOnly={!isCreating}
      />

      <div className="space-y-1">
        <InputLabel
          name={t('form.buttonLabel', { defaultValue: 'Button label' })}
          optional
        />
        <TextInput
          disabled={!isCreating}
          error={errors?.buttonLabel}
          fieldName={(fieldNamePrefix + 'buttonLabel') as 'buttonLabel'}
          register={register}
        />
      </div>

      <div className="space-y-1">
        <InputLabel
          name={t('form.teamNote', { defaultValue: 'Team note' })}
          optional
        />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.teamNote}
          fieldName={(fieldNamePrefix + 'teamNote') as 'teamNote'}
          register={register}
          rows={2}
        />
      </div>

      <div className="space-y-1">
        <InputLabel name={t('form.descriptionOptional')} optional />
        <TextAreaInput
          disabled={!isCreating}
          error={errors?.description}
          fieldName={(fieldNamePrefix + 'description') as 'description'}
          register={register}
          rows={4}
        />
      </div>
    </div>
  )
}
