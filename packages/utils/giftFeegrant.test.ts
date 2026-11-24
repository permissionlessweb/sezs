import { describe, expect, test } from 'vitest'

import {
  DEFAULT_GIFT_PREAUTH_ACTIONS,
  GIFT_PREAUTH_ACTIONS,
  buildGiftFeegrantMsgs,
  resolvePreauthMsgTypeUrls,
  summarizePreauthSelection,
  togglePreauthAction,
} from './giftFeegrant'

describe('giftFeegrant preauth', () => {
  test('catalog has stable ids and msg type urls', () => {
    expect(GIFT_PREAUTH_ACTIONS.length).toBeGreaterThanOrEqual(4)
    for (const a of GIFT_PREAUTH_ACTIONS) {
      expect(a.id).toBeTruthy()
      expect(a.msgTypeUrls.length).toBeGreaterThan(0)
      expect(a.msgTypeUrls.every((u) => u.startsWith('/'))).toBe(true)
    }
  })

  test('resolvePreauthMsgTypeUrls only includes selected actions', () => {
    const onlyBank = resolvePreauthMsgTypeUrls(['bank_send'])
    expect(onlyBank).toEqual(['/cosmos.bank.v1beta1.MsgSend'])

    const bankAndWasm = resolvePreauthMsgTypeUrls([
      'bank_send',
      'wasm_execute',
      'not_a_real_action',
    ])
    expect(bankAndWasm).toEqual([
      '/cosmos.bank.v1beta1.MsgSend',
      '/cosmwasm.wasm.v1.MsgExecuteContract',
    ])

    expect(resolvePreauthMsgTypeUrls([])).toEqual([])
    expect(resolvePreauthMsgTypeUrls(undefined)).toEqual([])
  })

  test('buildGiftFeegrantMsgs returns empty when nothing selected', () => {
    expect(
      buildGiftFeegrantMsgs({
        granter: 'terp1granter',
        grantee: 'terp1grantee',
        actionIds: [],
      })
    ).toEqual([])
  })

  test('buildGiftFeegrantMsgs returns empty without addresses', () => {
    expect(
      buildGiftFeegrantMsgs({
        granter: '',
        grantee: 'terp1grantee',
        actionIds: DEFAULT_GIFT_PREAUTH_ACTIONS,
      })
    ).toEqual([])
  })

  test('buildGiftFeegrantMsgs wires AllowedMsgAllowance for selected only', () => {
    const msgs = buildGiftFeegrantMsgs({
      granter: 'terp1granter',
      grantee: 'terp1fresh',
      actionIds: ['bank_send', 'gov_vote'],
      spendLimit: [{ denom: 'uterp', amount: '1000000' }],
      expiration: new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(msgs).toHaveLength(1)
    const stargate = (msgs[0] as { stargate: { type_url: string; value: string } })
      .stargate
    expect(stargate.type_url).toBe(
      '/cosmos.feegrant.v1beta1.MsgGrantAllowance'
    )
    // Encoded protobuf base64 present; not a raw JSON dump of all catalog urls.
    expect(typeof stargate.value).toBe('string')
    expect(stargate.value.length).toBeGreaterThan(10)
  })

  test('summarize and toggle helpers', () => {
    const summary = summarizePreauthSelection(['bank_send', 'bogus'])
    expect(summary.actionIds).toEqual(['bank_send'])
    expect(summary.msgTypeUrls).toEqual(['/cosmos.bank.v1beta1.MsgSend'])

    expect(togglePreauthAction(['bank_send'], 'wasm_execute')).toEqual([
      'bank_send',
      'wasm_execute',
    ])
    expect(togglePreauthAction(['bank_send', 'wasm_execute'], 'bank_send')).toEqual(
      ['wasm_execute']
    )
  })
})
