import { ContentCopy, Link as LinkIcon, Refresh } from '@mui/icons-material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Loader,
  MarkdownRenderer,
  TextInput,
  useChain,
} from '@dao-dao/stateless'
import { ModuleRendererProps, UnifiedCosmosMsg } from '@dao-dao/types'
import { TokenJsonNoToken } from '@dao-dao/types/pfpk'
import {
  DEFAULT_GIFT_PREAUTH_ACTIONS,
  GiftPreauthActionId,
  ONBOARDING_INVITE_ROLE,
  ONBOARDING_PFPK_AUDIENCE,
  OnboardingInvitePayload,
  buildGiftFeegrantMsgs,
  buildOnboardingInviteUrl,
  createInviteDraft,
  formatInviteTokenName,
  parseInviteTokenName,
  processError,
  resolvePreauthMsgTypeUrls,
} from '@dao-dao/utils'

import { usePfpkClient } from '../../../hooks/usePfpkClient'
import { useWallet } from '../../../hooks/useWallet'
import { GiftPreauthActionSelector } from './GiftPreauthActionSelector'
import { OnboardingClaimPanel } from './OnboardingClaimPanel'
import { OnboardingModuleData } from './types'

type ListedInvite = {
  tokenMeta: TokenJsonNoToken
  inviteId: string
  label: string
}

/**
 * Sponsor: mint one-time PFPK invite tokens and copy shareable gift links.
 * At generation, select feegrant preauth actions; build MsgGrantAllowance for
 * selected type URLs only when a grantee address is provided.
 * Claim: two-step auth (token → ephemeral wallet → passkey bind → auto-migrate).
 */
export const OnboardingRenderer = ({
  variables: {
    description,
    defaultAuthPlane,
    autoMigrate,
    inviteTtlDays,
    defaultPreauthActions,
    defaultFeegrantSpendAmount,
    defaultFeegrantSpendDenom,
    feegrantTtlDays,
  },
}: ModuleRendererProps<OnboardingModuleData>) => {
  const { t } = useTranslation()
  const { chainId } = useChain()
  const { isWalletConnected, address: walletAddress } = useWallet()
  const { pfpkClient, isWalletConnected: pfpkReady } = usePfpkClient({
    chainId,
    defaultSignatureType: 'DAO DAO Onboarding',
  })

  const [claimMode, setClaimMode] = useState(false)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [listing, setListing] = useState(false)
  const [tokens, setTokens] = useState<ListedInvite[]>([])
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string>()
  const [preauthActions, setPreauthActions] = useState<GiftPreauthActionId[]>(
    () =>
      (defaultPreauthActions?.length
        ? defaultPreauthActions
        : DEFAULT_GIFT_PREAUTH_ACTIONS) as GiftPreauthActionId[]
  )
  const [granteeAddress, setGranteeAddress] = useState('')
  const [feegrantDraft, setFeegrantDraft] = useState<UnifiedCosmosMsg[] | null>(
    null
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (params.get('t') && (params.get('p') || params.get('invite'))) {
      setClaimMode(true)
    }
  }, [])

  const daoAddress =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/\/dao\/([^/]+)/)?.[1]
      : undefined

  const spendLimit = useMemo(() => {
    const amount = defaultFeegrantSpendAmount?.trim()
    const denom = defaultFeegrantSpendDenom?.trim() || 'uterp'
    if (!amount) {
      return undefined
    }
    return [{ denom, amount }]
  }, [defaultFeegrantSpendAmount, defaultFeegrantSpendDenom])

  const feegrantExpiration = useMemo(() => {
    const days = Number(feegrantTtlDays)
    if (!days || days <= 0) {
      return undefined
    }
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setMilliseconds(0)
    return d
  }, [feegrantTtlDays])

  const refreshTokens = useCallback(async () => {
    if (!isWalletConnected || !pfpkReady) {
      return
    }
    setListing(true)
    try {
      const list = await pfpkClient.fetchTokens(chainId)
      const onboarding = list.flatMap((tokenMeta) => {
        const parsed = parseInviteTokenName(tokenMeta.name)
        if (!parsed) {
          return []
        }
        return [
          {
            tokenMeta,
            inviteId: parsed.inviteId,
            label: parsed.label,
          },
        ]
      })
      setTokens(onboarding)
    } catch (err) {
      console.error(err)
      toast.error(processError(err))
    } finally {
      setListing(false)
    }
  }, [isWalletConnected, pfpkReady, pfpkClient, chainId])

  useEffect(() => {
    if (isWalletConnected && pfpkReady) {
      refreshTokens()
    }
  }, [isWalletConnected, pfpkReady, refreshTokens])

  const buildFeegrantForGrantee = useCallback(
    (grantee: string) => {
      const granter = walletAddress || ''
      const msgs = buildGiftFeegrantMsgs({
        granter,
        grantee,
        actionIds: preauthActions,
        spendLimit,
        expiration: feegrantExpiration,
      })
      setFeegrantDraft(msgs.length ? msgs : null)
      return msgs
    },
    [walletAddress, preauthActions, spendLimit, feegrantExpiration]
  )

  const createInvite = async () => {
    if (!isWalletConnected) {
      toast.error(t('error.logInToContinue'))
      return
    }

    setCreating(true)
    try {
      const feegrantSpendLimit =
        spendLimit?.[0] && preauthActions.length
          ? spendLimit[0]
          : undefined

      const invite: OnboardingInvitePayload = createInviteDraft({
        chainId,
        dao: daoAddress,
        label: label.trim() || undefined,
        authPlane: defaultAuthPlane,
        autoMigrate,
        ttlMs: (Number(inviteTtlDays) || 7) * 24 * 60 * 60 * 1000,
        preauthActions,
        feegrantSpendLimit,
        preauthGrantee: granteeAddress.trim() || undefined,
      })

      const created = await pfpkClient.createTokens({
        chainId,
        tokens: [
          {
            name: formatInviteTokenName(invite),
            audience: [ONBOARDING_PFPK_AUDIENCE],
            role: ONBOARDING_INVITE_ROLE,
          },
        ],
        withAdminIfNeeded: true,
      })

      const tokenRow = created[0]
      if (!tokenRow?.token) {
        throw new Error('No token returned from PFPK')
      }

      const url = buildOnboardingInviteUrl({
        token: tokenRow.token,
        invite,
      })
      setLastCreatedUrl(url)
      setLabel('')

      // Wire feegrant msgs for selected actions only when grantee is known.
      if (granteeAddress.trim() && preauthActions.length > 0) {
        const msgs = buildFeegrantForGrantee(granteeAddress.trim())
        if (msgs.length) {
          toast.success(
            t('success.feegrantDraftReady', {
              defaultValue:
                'Gift link created. Feegrant draft built for selected actions only — sign/broadcast separately with granter wallet.',
            })
          )
        } else {
          toast.success(
            t('success.inviteCreated', {
              defaultValue: 'Onboarding link created',
            })
          )
        }
      } else {
        setFeegrantDraft(null)
        toast.success(
          t('success.inviteCreated', {
            defaultValue:
              'Gift link created. Add a grantee address to build feegrant msgs for selected actions.',
          })
        )
      }

      await refreshTokens()
    } catch (err) {
      console.error(err)
      toast.error(processError(err))
    } finally {
      setCreating(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('info.copiedToClipboard'))
    } catch {
      toast.error(t('error.loadingData'))
    }
  }

  const invalidate = async (tokenId: string) => {
    try {
      await pfpkClient.invalidateTokens({ chainId, tokenIds: [tokenId] })
      await refreshTokens()
      toast.success(
        t('success.invalidated', { defaultValue: 'Invite revoked' })
      )
    } catch (err) {
      toast.error(processError(err))
    }
  }

  if (claimMode) {
    return (
      <div className="flex flex-col gap-4">
        <Button onClick={() => setClaimMode(false)} size="sm" variant="ghost">
          {t('button.back', { defaultValue: 'Back to invites' })}
        </Button>
        <OnboardingClaimPanel />
      </div>
    )
  }

  const allowedUrls = resolvePreauthMsgTypeUrls(preauthActions)

  return (
    <div className="flex flex-col gap-6">
      {description ? (
        <MarkdownRenderer className="text-base" markdown={description} />
      ) : (
        <p className="secondary-text text-sm">
          {t('info.onboardingModuleBlurb', {
            defaultValue:
              'Generate one-time gift / onboarding links. Recipients open the link, create a fresh wallet, bind a passkey, and — if auto-migrate is on — a durable account is prepared. Optional feegrant pays gas only for actions you select at generation (not airdrop funds).',
          })}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border-primary p-4">
        <div className="flex flex-row items-center gap-2">
          <LinkIcon className="!h-5 !w-5 text-icon-secondary" />
          <h3 className="primary-text">
            {t('title.createOnboardingLink', {
              defaultValue: 'Create gift / onboarding link',
            })}
          </h3>
        </div>

        <TextInput
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder={t('form.inviteLabel', {
            defaultValue: 'Label (optional)',
          })}
          value={label}
        />

        <p className="secondary-text text-xs">
          Auth: <strong>{defaultAuthPlane}</strong>
          {' · '}
          Auto-migrate: <strong>{autoMigrate ? 'on' : 'off'}</strong>
          {' · '}
          TTL: <strong>{Number(inviteTtlDays) || 7}d</strong>
        </p>

        <GiftPreauthActionSelector
          compact
          onChange={(next) => {
            setPreauthActions(next)
            setFeegrantDraft(null)
          }}
          selected={preauthActions}
        />

        <div className="space-y-1">
          <p className="secondary-text text-xs">
            {t('form.preauthGrantee', {
              defaultValue:
                'Fresh wallet address (grantee) — optional at generation; required to build feegrant msgs now',
            })}
          </p>
          <TextInput
            onChange={(e) => {
              setGranteeAddress(e.currentTarget.value)
              setFeegrantDraft(null)
            }}
            placeholder="terp1…"
            value={granteeAddress}
          />
        </div>

        <div className="flex flex-row flex-wrap gap-2">
          <Button
            disabled={!isWalletConnected}
            loading={creating}
            onClick={createInvite}
            variant="primary"
          >
            {t('button.createInvite', {
              defaultValue: 'Create one-time gift link',
            })}
          </Button>
          <Button
            disabled={
              !walletAddress ||
              !granteeAddress.trim() ||
              preauthActions.length === 0
            }
            onClick={() => {
              const msgs = buildFeegrantForGrantee(granteeAddress.trim())
              if (!msgs.length) {
                toast.error(
                  t('error.feegrantEmpty', {
                    defaultValue:
                      'No feegrant msgs — select actions and set granter + grantee.',
                  })
                )
                return
              }
              toast.success(
                t('success.feegrantDraftBuilt', {
                  defaultValue: `Built ${msgs.length} feegrant msg(s) for ${allowedUrls.length} allowed type(s).`,
                  count: msgs.length,
                  types: allowedUrls.length,
                })
              )
            }}
            variant="secondary"
          >
            {t('button.buildFeegrant', {
              defaultValue: 'Build feegrant (selected only)',
            })}
          </Button>
        </div>

        {lastCreatedUrl && (
          <div className="flex flex-col gap-2 rounded-md bg-background-tertiary p-3">
            <p className="secondary-text break-all text-xs">{lastCreatedUrl}</p>
            <Button
              onClick={() => copy(lastCreatedUrl)}
              size="sm"
              variant="secondary"
            >
              <ContentCopy className="!h-4 !w-4" />
              {t('button.copy', { defaultValue: 'Copy link' })}
            </Button>
          </div>
        )}

        {feegrantDraft && feegrantDraft.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-border-secondary bg-background-secondary p-3">
            <p className="primary-text text-sm">
              {t('title.feegrantDraft', {
                defaultValue: 'Feegrant draft (selected actions only)',
              })}
            </p>
            <p className="secondary-text text-xs">
              {t('info.feegrantDraftHonesty', {
                defaultValue:
                  'MsgGrantAllowance with AllowedMsgAllowance. Gas only for the type URLs listed above. Not bank funding, not membership, not auto-broadcast — copy and sign with the granter wallet (or DAO proposal).',
              })}
            </p>
            <pre className="max-h-48 overflow-auto rounded bg-background-base p-2 font-mono text-xs">
              {JSON.stringify(feegrantDraft, null, 2)}
            </pre>
            <Button
              onClick={() => copy(JSON.stringify(feegrantDraft, null, 2))}
              size="sm"
              variant="secondary"
            >
              <ContentCopy className="!h-4 !w-4" />
              {t('button.copyFeegrantMsgs', {
                defaultValue: 'Copy feegrant msgs',
              })}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-row items-center justify-between">
          <h3 className="primary-text">
            {t('title.yourInvites', { defaultValue: 'Your invites' })}
          </h3>
          <Button
            disabled={listing || !isWalletConnected}
            onClick={() => refreshTokens()}
            size="sm"
            variant="ghost"
          >
            <Refresh className="!h-4 !w-4" />
          </Button>
        </div>

        {listing ? (
          <Loader fill={false} size={24} />
        ) : tokens.length === 0 ? (
          <p className="secondary-text text-sm">
            {t('info.noInvites', {
              defaultValue: 'No onboarding invites yet.',
            })}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.map(({ tokenMeta, inviteId, label: invLabel }) => (
              <li
                key={tokenMeta.id || inviteId}
                className="flex flex-row items-center justify-between gap-2 rounded-md bg-background-tertiary px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="primary-text truncate text-sm">{invLabel}</p>
                  <p className="secondary-text font-mono text-xs">
                    {inviteId}
                    {tokenMeta.expiresAt
                      ? ` · exp ${new Date(tokenMeta.expiresAt).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                {tokenMeta.id && (
                  <Button
                    onClick={() => invalidate(tokenMeta.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {t('button.revoke', { defaultValue: 'Revoke' })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button onClick={() => setClaimMode(true)} size="sm" variant="secondary">
        {t('button.openClaimFlow', {
          defaultValue: 'Open claim / passkey bind flow',
        })}
      </Button>
    </div>
  )
}
