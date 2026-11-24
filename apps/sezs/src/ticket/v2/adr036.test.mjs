import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adr036SignDoc, verifyAdr036, utf8 } from './adr036.mjs'

// Public Keplr / Zafu fixtures (zafu packages/wallet adr036.test.ts on origin/main).
// No seed material is stored here — only the published signature and pubkey.
const SIGNER = 'cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4'
const PUBKEY = 'Ak9OKtmcNNYLm6YoPJQxqEGK+GcyEpYfl6d7Y3f80Fti'
const sig = (pubkey, signature) => ({
  pub_key: { type: 'tendermint/PubKeySecp256k1', value: pubkey },
  signature,
})

const KEPLR_HELLO = {
  data: utf8('hello from zafu'),
  doc: '{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":"aGVsbG8gZnJvbSB6YWZ1","signer":"cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"}}],"sequence":"0"}',
  signature: 'INXJIBwvKgWVWGvXWPfeiu4xfuvi5HJ6qErH8LpwszQZMdkXGZDHLj8LHFdikiXIbhNAKe3NhZGdMh+etdxz3w==',
}

test('adr036 sign doc serializes like Keplr for the published fixture', () => {
  assert.equal(JSON.stringify(adr036SignDoc(SIGNER, KEPLR_HELLO.data)), KEPLR_HELLO.doc)
})

test('verifyAdr036 accepts the published Keplr signature over hello from zafu', () => {
  assert.equal(verifyAdr036('cosmos', SIGNER, KEPLR_HELLO.data, sig(PUBKEY, KEPLR_HELLO.signature)), true)
})

test('verifyAdr036 accepts a published in-the-wild Keplr signature (juno)', () => {
  const juno = sig(
    'Avt8e5UqfoRAh0RBUzHCu9arv7UFEFdfcv657h6TtSZE',
    '9PrDYrTb1tv/TALC/lgRIIekfwNMBPOra0QpaAqNCbADXT8vR9n0SS7L2OSaXma3UMrOLGTbWlLDImNhcZVgzA==',
  )
  const signer = 'juno105asxv7pt0fzxlz642pf4svm29u39zxzdq2ad5'
  assert.equal(verifyAdr036('juno', signer, utf8('test'), juno), true)
  assert.equal(verifyAdr036('juno', signer, utf8('not test'), juno), false)
})

test('verifyAdr036 refuses a changed message, prefix, or key type', () => {
  assert.equal(verifyAdr036('cosmos', SIGNER, utf8('hello from zafu.'), sig(PUBKEY, KEPLR_HELLO.signature)), false)
  assert.equal(verifyAdr036('osmo', SIGNER, KEPLR_HELLO.data, sig(PUBKEY, KEPLR_HELLO.signature)), false)
  assert.equal(
    verifyAdr036('cosmos', SIGNER, KEPLR_HELLO.data, {
      pub_key: { type: 'ethermint/PubKeyEthSecp256k1', value: PUBKEY },
      signature: KEPLR_HELLO.signature,
    }),
    false,
  )
})
