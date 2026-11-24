import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import {
  Button,
  MarkdownRenderer,
  SegmentedControls,
  TextInput,
} from '@dao-dao/stateless'
import { ModuleRendererProps } from '@dao-dao/types'
import {
  PUBLIC_KEY_SIZE,
  encryptAvailabilityMessage,
  ensureEncryptAvailable,
  isHexString,
} from '@dao-dao/utils'

import { encryptAndBuildCastBody, submitShieldedCast } from './castBody'
import { parseShieldedChoices } from './constants'
import { RoundStatusVisualizer } from './RoundStatusVisualizer'
import { DEFAULT_DEV_LIFECYCLE_PHASE } from './roundLifecycle'
import { ShieldedCastUiState, ShieldedVoteModuleData } from './types'

/**
 * ShieldedVote tab — product-minimal cast + optional Dev tools (labMode).
 *
 * Main MUI: choice → encrypt → short safe outcome.
 * Dev dropdown (labMode): lifecycle rail, cast pipeline, wire dumps, stub.
 * Fail-closed when encrypt wasm missing. Never POSTs plaintext vote.
 */
export const ShieldedVoteRenderer = ({
  variables,
}: ModuleRendererProps<ShieldedVoteModuleData>) => {
  const { t } = useTranslation()
  const {
    description,
    defaultRoundId = '',
    defaultProposalId = '',
    eaPkHex = '',
    castContract = '',
    labCastBaseUrl = '',
    requireProof = true,
    labMode = true,
    choices: choicesRaw,
  } = variables

  const choices = useMemo(
    () => parseShieldedChoices(choicesRaw),
    [choicesRaw]
  )

  const [roundId, setRoundId] = useState(defaultRoundId)
  const [proposalId, setProposalId] = useState(defaultProposalId)
  const [choiceId, setChoiceId] = useState(choices[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [encryptReady, setEncryptReady] = useState(false)
  const [uiState, setUiState] = useState<ShieldedCastUiState>({
    status: 'idle',
    message: 'Checking encrypt backend…',
  })
  const [preparedBodyJson, setPreparedBodyJson] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await ensureEncryptAvailable()
      if (cancelled) return
      setEncryptReady(ok)
      setUiState({
        status: ok ? 'ready' : 'encrypt_unavailable',
        message: encryptAvailabilityMessage(ok),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = choices.find((c) => c.id === choiceId) ?? choices[0]
  const eaPkOk = isHexString(eaPkHex, PUBLIC_KEY_SIZE)
  const configOk = !!roundId.trim() && eaPkOk && !!selected
  const encryptButtonDisabled = busy || !encryptReady || !configOk

  const productOutcome =
    uiState.status === 'submitted'
      ? t('success.shieldedBallotSubmitted', {
          defaultValue: 'Ballot encrypted and submitted (ciphertext only).',
        })
      : uiState.status === 'encrypted' || uiState.status === 'submit_stub'
        ? t('success.shieldedBallotSealed', {
            defaultValue: 'Ballot encrypted · ready (ciphertext only).',
          })
        : uiState.status === 'encrypt_unavailable'
          ? encryptAvailabilityMessage(false)
          : uiState.status === 'error'
            ? uiState.message
            : null

  const onCast = useCallback(async () => {
    if (!selected) {
      toast.error('No vote choice selected')
      return
    }
    if (!encryptReady) {
      setUiState({
        status: 'encrypt_unavailable',
        message: encryptAvailabilityMessage(false),
      })
      toast.error(
        t('error.shieldedEncryptUnavailable', {
          defaultValue:
            'Encrypt unavailable — cast fail-closed (rebuild vote-elgamal-wasm).',
        })
      )
      return
    }
    if (!configOk) {
      setUiState({
        status: 'missing_config',
        message: 'Round id and valid ea_pk (32-byte hex) are required.',
      })
      if (labMode) {
        toast.error(
          t('error.shieldedMissingConfig', {
            defaultValue: 'Round id and valid ea_pk required (see Dev tools).',
          })
        )
      } else {
        toast.error(
          t('error.shieldedMissingConfigProduct', {
            defaultValue:
              'Voting is not configured (missing round or election key).',
          })
        )
      }
      return
    }

    setBusy(true)
    setPreparedBodyJson(null)
    setUiState({
      status: 'encrypting',
      message: 'Encrypting ballot under ea_pk (client-side)…',
    })
    try {
      setUiState({
        status: 'proving',
        message: requireProof
          ? 'Encrypting + lab prove (PI bind; not Halo2)…'
          : 'Encrypting ballot…',
      })
      const { body, prepared } = await encryptAndBuildCastBody({
        roundId,
        proposalId: proposalId || undefined,
        eaPkHex,
        choice: selected,
        requireProof,
        withLabProof: requireProof,
      })
      const preview =
        prepared.ciphertextHex.slice(0, 16) +
        '…' +
        prepared.ciphertextHex.slice(-8)
      setPreparedBodyJson(JSON.stringify(body, null, 2))

      const canSubmit = !!(labCastBaseUrl?.trim() || castContract?.trim())
      if (canSubmit) {
        const result = await submitShieldedCast({
          castContract: castContract || undefined,
          labCastBaseUrl: labCastBaseUrl || undefined,
          body,
          requireProof,
        })
        if (result.ok) {
          setUiState({
            status: 'submitted',
            message:
              result.mode === 'lab_http'
                ? 'Submitted to lab cast surface (nullifier spent; ciphertext stored).'
                : result.note,
            ciphertextPreview: preview,
            engine: prepared.engine,
          })
          toast.success(
            t('success.shieldedSubmitted', {
              defaultValue: 'Shielded cast accepted (ciphertext only).',
            })
          )
        } else {
          setUiState({
            status: 'encrypted',
            message: `Encrypted; submit failed: ${result.reason}`,
            ciphertextPreview: preview,
            engine: prepared.engine,
          })
          toast.error(result.reason)
        }
      } else {
        setUiState({
          status: 'encrypted',
          message:
            'Ballot encrypted (+ lab proof). Set labCastBaseUrl or castContract to submit.',
          ciphertextPreview: preview,
          engine: prepared.engine,
        })
        toast.success(
          t('success.shieldedEncrypted', {
            defaultValue: 'Vote encrypted in browser (ciphertext only).',
          })
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setUiState({
        status: 'error',
        message: msg,
      })
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }, [
    selected,
    encryptReady,
    configOk,
    roundId,
    proposalId,
    eaPkHex,
    labMode,
    requireProof,
    labCastBaseUrl,
    castContract,
    t,
  ])

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : null}

      {/* Product-minimal cast surface */}
      <div className="flex flex-col gap-2 rounded-md border border-border-primary bg-background-base p-4">
        <p className="primary-text text-sm font-medium">
          {t('title.shieldedCast', { defaultValue: 'Cast (shielded)' })}
        </p>

        <div className="space-y-2">
          <p className="secondary-text text-xs">
            {t('form.voteChoice', { defaultValue: 'Vote choice' })}
          </p>
          {choices.length > 0 ? (
            <SegmentedControls
              onSelect={(id) => setChoiceId(id)}
              selected={selected?.id}
              tabs={choices.map((c) => ({
                label: c.label,
                value: c.id,
              }))}
            />
          ) : (
            <p className="secondary-text text-sm">No choices configured.</p>
          )}
          <p className="secondary-text text-[11px] opacity-70">
            {t('info.choicePrivacyHint', {
              defaultValue:
                'Choice is encrypted locally. Plaintext never leaves your device for encrypt.',
            })}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            disabled={encryptButtonDisabled}
            onClick={onCast}
            variant="primary"
          >
            {busy &&
            (uiState.status === 'encrypting' || uiState.status === 'proving')
              ? t('info.loading', { defaultValue: 'Working…' })
              : encryptReady
                ? t('button.castShieldedVote', {
                    defaultValue: 'Cast shielded vote',
                  })
                : t('button.encryptUnavailable', {
                    defaultValue: 'Encrypt unavailable',
                  })}
          </Button>
        </div>

        {productOutcome ? (
          <p
            className={`secondary-text text-sm ${
              uiState.status === 'error' ||
              uiState.status === 'encrypt_unavailable'
                ? 'text-text-interactive-error-body'
                : 'text-text-secondary'
            }`}
          >
            {productOutcome}
          </p>
        ) : null}

        {!encryptReady ? (
          <p className="secondary-text text-xs text-text-interactive-error-body">
            {encryptAvailabilityMessage(false)}
          </p>
        ) : null}
      </div>

      {/* Dev / lab only — closed by default; elevates product MUI */}
      {labMode ? (
        <details className="rounded-md border border-border-interactive-warning bg-background-base">
          <summary className="cursor-pointer select-none px-3 py-2 font-mono text-xs text-text-interactive-warning-body">
            Dev tools · round status · lab
          </summary>
          <div className="flex flex-col gap-3 border-t border-border-interactive-warning/40 p-3">
            <p className="secondary-text text-sm">
              {t('info.shieldedVoteLabBanner', {
                defaultValue:
                  'Lab cast surface. Client-side ElGamal only. V-UI-2 proof and V-UI-4 chain submit may be incomplete — never sends plaintext for encrypt.',
              })}
            </p>

            <RoundStatusVisualizer
              castMessage={uiState.message}
              castStatus={uiState.status}
              currentPhase={DEFAULT_DEV_LIFECYCLE_PHASE}
            />

            <div className="space-y-1">
              <p className="secondary-text text-xs">
                {t('form.roundId', { defaultValue: 'Round / session id' })}
              </p>
              <TextInput
                onChange={(e) => setRoundId(e.target.value)}
                placeholder="round or ceremony session id"
                value={roundId}
              />
            </div>

            <div className="space-y-1">
              <p className="secondary-text text-xs">
                {t('form.proposalId', {
                  defaultValue: 'Proposal id (optional)',
                })}
              </p>
              <TextInput
                onChange={(e) => setProposalId(e.target.value)}
                placeholder="optional"
                value={proposalId}
              />
            </div>

            <div className="space-y-1">
              <p className="secondary-text text-xs">
                {t('form.eaPkDisplay', {
                  defaultValue: 'EA public key (ea_pk)',
                })}
              </p>
              {eaPkOk ? (
                <p className="font-mono text-xs break-all text-text-body">
                  {eaPkHex.replace(/^0x/i, '').toLowerCase()}
                </p>
              ) : (
                <p className="secondary-text text-sm text-text-interactive-warning-body">
                  {t('error.eaPkMissing', {
                    defaultValue:
                      'ea_pk not configured or invalid (need 32-byte hex). Set in module editor.',
                  })}
                </p>
              )}
            </div>

            <div className="rounded-md border border-border-secondary bg-background-primary/40 p-3">
              <p className="font-mono text-[11px] text-text-tertiary">
                status · {uiState.status}
                {uiState.engine ? ` · engine ${uiState.engine}` : ''}
              </p>
              <p className="secondary-text mt-1 text-sm">{uiState.message}</p>
              {uiState.ciphertextPreview ? (
                <p className="secondary-text mt-1 font-mono text-xs break-all">
                  ciphertext · {uiState.ciphertextPreview}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <p className="secondary-text text-xs">labCastBaseUrl</p>
              <p className="font-mono text-[11px] break-all opacity-80">
                {labCastBaseUrl || '(empty — set in module editor)'}
              </p>
              <p className="secondary-text text-[11px]">
                requireProof · {requireProof ? 'true' : 'false'} · proof is
                lab_mock_prove_v1 (not Halo2)
              </p>
            </div>

            {preparedBodyJson ? (
              <details>
                <summary className="link-text cursor-pointer text-xs">
                  {t('button.viewCastBody', {
                    defaultValue:
                      'View prepared cast body (ciphertext only)',
                  })}
                </summary>
                <pre className="secondary-text mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {preparedBodyJson}
                </pre>
              </details>
            ) : null}

            {castContract ? (
              <p className="secondary-text font-mono text-[11px] break-all opacity-70">
                castContract · {castContract}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}
