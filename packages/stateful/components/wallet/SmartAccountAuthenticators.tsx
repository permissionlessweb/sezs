import { DeleteOutline, Key, Refresh } from '@mui/icons-material'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { Button, InputErrorMessage, Loader, TextInput } from '@dao-dao/stateless'
import { processError } from '@dao-dao/utils'

import { useSmartAccount } from '../../hooks/useSmartAccount'

/**
 * Minimal manage surface for x/smartaccount authenticators.
 * Shown only on chains that support smartaccount (e.g. Terp).
 */
export const SmartAccountAuthenticators = () => {
  const { t } = useTranslation()
  const {
    supported,
    authenticators,
    isLoading,
    isError,
    error: queryError,
    selectedAuthenticatorId,
    setPreferredAuthenticatorId,
    addAuthenticator,
    removeAuthenticator,
    refresh,
  } = useSmartAccount()

  const [authenticatorType, setAuthenticatorType] = useState(
    'CosmwasmAuthenticatorV1'
  )
  const [configBase64, setConfigBase64] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  if (!supported) {
    return null
  }

  const onAdd = async () => {
    setError(undefined)
    setSubmitting(true)
    try {
      let data: Uint8Array
      try {
        // Accept raw base64 config bytes from authenticator builders.
        const binary = atob(configBase64.trim())
        data = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      } catch {
        throw new Error('Config must be base64-encoded authenticator data')
      }

      await addAuthenticator({
        authenticatorType: authenticatorType.trim(),
        data,
      })
      setConfigBase64('')
      toast.success(t('success.saved', { defaultValue: 'Authenticator added' }))
    } catch (err) {
      console.error(err)
      const msg = processError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const onRemove = async (id: bigint) => {
    setError(undefined)
    setSubmitting(true)
    try {
      await removeAuthenticator(id)
      toast.success(
        t('success.saved', { defaultValue: 'Authenticator removed' })
      )
    } catch (err) {
      console.error(err)
      const msg = processError(err)
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border-primary p-4">
      <div className="flex flex-row items-center justify-between gap-2">
        <div className="flex flex-row items-center gap-2">
          <Key className="!h-5 !w-5 text-icon-secondary" />
          <h3 className="primary-text">
            {t('title.smartAccount', {
              defaultValue: 'Smart account authenticators',
            })}
          </h3>
        </div>
        <Button
          disabled={submitting}
          onClick={() => refresh()}
          size="sm"
          variant="ghost"
        >
          <Refresh className="!h-4 !w-4" />
        </Button>
      </div>

      <p className="secondary-text text-sm">
        {t('info.smartAccountDescription', {
          defaultValue:
            'Custom message authenticators for this account. Selected authenticator is attached as a transaction extension when you sign.',
        })}
      </p>

      {isLoading ? (
        <Loader fill={false} size={24} />
      ) : isError ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-interactive-error">
            {t('error.failedToLoadAuthenticators', {
              defaultValue:
                'Could not load authenticators. Signing with custom authenticators is blocked until this succeeds — retry or check RPC.',
            })}
          </p>
          <InputErrorMessage error={queryError} />
          <Button onClick={() => refresh()} size="sm" variant="secondary">
            {t('button.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      ) : authenticators.length === 0 ? (
        <p className="secondary-text text-sm">
          {t('info.noAuthenticators', {
            defaultValue: 'No authenticators registered on this account.',
          })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {authenticators.map((auth) => {
            const selected = selectedAuthenticatorId === auth.id
            return (
              <li
                key={auth.id.toString()}
                className="flex flex-row items-center justify-between gap-2 rounded-md bg-background-tertiary px-3 py-2"
              >
                <button
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                  onClick={() => setPreferredAuthenticatorId(auth.id)}
                  type="button"
                >
                  <span className="primary-text text-sm">
                    #{auth.id.toString()} · {auth.type}
                    {selected ? ' · selected' : ''}
                  </span>
                  <span className="secondary-text truncate font-mono text-xs">
                    {auth.config?.length
                      ? `${auth.config.length} bytes config`
                      : 'empty config'}
                  </span>
                </button>
                <Button
                  disabled={submitting}
                  onClick={() => onRemove(auth.id)}
                  size="sm"
                  variant="ghost"
                >
                  <DeleteOutline className="!h-4 !w-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-border-secondary pt-4">
        <p className="primary-text text-sm">
          {t('title.addAuthenticator', { defaultValue: 'Add authenticator' })}
        </p>
        <TextInput
          onChange={(e) => setAuthenticatorType(e.currentTarget.value)}
          placeholder="Authenticator type (e.g. CosmwasmAuthenticatorV1)"
          value={authenticatorType}
        />
        <textarea
          className="secondary-text w-full appearance-none rounded-md bg-transparent py-3 px-4 text-text-body ring-1 ring-border-primary transition placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-border-interactive-focus"
          onChange={(e) => setConfigBase64(e.currentTarget.value)}
          placeholder="Base64-encoded authenticator config"
          rows={3}
          value={configBase64}
        />
        <InputErrorMessage error={error} />
        <Button
          disabled={
            submitting || !configBase64.trim() || !authenticatorType.trim()
          }
          loading={submitting}
          onClick={onAdd}
          variant="primary"
        >
          {t('button.add', { defaultValue: 'Add' })}
        </Button>
      </div>
    </div>
  )
}
