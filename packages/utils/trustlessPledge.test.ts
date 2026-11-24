import { toHex, toUtf8 } from '@cosmjs/encoding'
import { describe, expect, test } from 'vitest'

import {
  AUTH_MSG_MAX_EXTRA,
  CW721SVG_DST,
  PLEDGE_AUTHENTICATOR_ID,
  PLEDGE_DEFAULT_DOMAIN,
  PLEDGE_DIGEST_LEN,
  PLEDGE_STORAGE_KEY,
  buildCosmosArbitraryExt,
  buildPledgeAuthMessage,
  buildPledgeMintExecuteMsg,
  buildPledgeSignDoc,
  buildPledgeTokenMetadata,
  canonicalizePledgeCommitments,
  digestPledgeSignDoc,
  generatePledgeAuthNonce,
  normalizeDigestHex,
  parseTrustlessPledgeStorage,
  resolveTrustlessPledgeDiscovery,
  serializeTrustlessPledgeStorage,
  signPledgeDigest,
} from './trustlessPledge'

describe('trustlessPledge', () => {
  test('buildPledgeSignDoc is null-byte separated with project + empty commitments', () => {
    const doc = buildPledgeSignDoc({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'morocco-1',
      account: 'terp1acct',
      manifestoCid: 'bafytestcid',
      projectId: '',
    })

    // domain \0 chain \0 account \0 authenticator \0 manifesto \0 project \0 commitments
    const expected = new Uint8Array([
      ...toUtf8(PLEDGE_DEFAULT_DOMAIN),
      0,
      ...toUtf8('morocco-1'),
      0,
      ...toUtf8('terp1acct'),
      0,
      ...toUtf8(PLEDGE_AUTHENTICATOR_ID),
      0,
      ...toUtf8('bafytestcid'),
      0,
      ...toUtf8(''),
      0,
      ...toUtf8(''),
    ])
    expect(toHex(doc)).toBe(toHex(expected))
  })

  test('project_id and commitments change digest', () => {
    const base = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'terp1acct',
      manifestoCid: 'bafy1',
    })
    const withProject = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'terp1acct',
      manifestoCid: 'bafy1',
      projectId: 'grant-zcg-369',
    })
    const withCmt = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'terp1acct',
      manifestoCid: 'bafy1',
      projectId: 'grant-zcg-369',
      commitments: [
        {
          kind: 'ipfs',
          ref: 'bafyboard',
          digestHex: '0x' + 'ab'.repeat(32),
        },
      ],
    })
    expect(base.digestHex).not.toBe(withProject.digestHex)
    expect(withProject.digestHex).not.toBe(withCmt.digestHex)
    expect(withCmt.commitmentsCanonical).toContain('ipfs|bafyboard|')
    expect(withCmt.signMessage).toContain('project_id=grant-zcg-369')
  })

  test('canonicalizePledgeCommitments sorts and normalizes hex', () => {
    const c = canonicalizePledgeCommitments([
      { kind: 'z', ref: '2', digestHex: '0xABCD' },
      { kind: 'a', ref: '1', digestHex: 'Ef01' },
    ])
    expect(c).toBe('a|1|ef01\nz|2|abcd')
    expect(normalizeDigestHex('0xAb')).toBe('ab')
  })

  test('commitment order does not affect digest', () => {
    const a = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'acct',
      manifestoCid: 'cid',
      commitments: [
        { kind: 'b', ref: 'y', digestHex: '11' },
        { kind: 'a', ref: 'x', digestHex: '22' },
      ],
    })
    const b = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'acct',
      manifestoCid: 'cid',
      commitments: [
        { kind: 'a', ref: 'x', digestHex: '22' },
        { kind: 'b', ref: 'y', digestHex: '11' },
      ],
    })
    expect(a.digestHex).toBe(b.digestHex)
  })

  test('blake2b256 and blake3 produce distinct 32-byte digests', () => {
    const zkpallasDoc = buildPledgeSignDoc({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'terp1acct',
      authenticatorId: '1',
      manifestoCid: 'hello',
    })

    const a = digestPledgeSignDoc('blake2b256', zkpallasDoc)
    const b = digestPledgeSignDoc('blake3', zkpallasDoc)
    expect(a.length).toBe(PLEDGE_DIGEST_LEN)
    expect(b.length).toBe(PLEDGE_DIGEST_LEN)
    expect(toHex(a)).not.toBe(toHex(b))
  })

  test('domain separation changes digest', () => {
    const d1 = signPledgeDigest({
      domain: PLEDGE_DEFAULT_DOMAIN,
      chainId: 'terp-1',
      account: 'acct',
      manifestoCid: 'same-body',
    })
    const d2 = signPledgeDigest({
      domain: 'other-domain/v1',
      chainId: 'terp-1',
      account: 'acct',
      manifestoCid: 'same-body',
    })
    expect(d1.digestHex).not.toBe(d2.digestHex)
    expect(d1.digestHex.startsWith('0x')).toBe(true)
    expect(d1.digestHex.length).toBe(2 + 64)
  })

  test('signPledgeDigest rejects empty cid/account', () => {
    expect(() =>
      signPledgeDigest({
        domain: PLEDGE_DEFAULT_DOMAIN,
        chainId: 'morocco-1',
        account: '',
        manifestoCid: 'cid',
      })
    ).toThrow(/account/)
    expect(() =>
      signPledgeDigest({
        domain: PLEDGE_DEFAULT_DOMAIN,
        chainId: 'morocco-1',
        account: 'terp1',
        manifestoCid: '  ',
      })
    ).toThrow(/manifestoCid/)
  })

  test('buildPledgeAuthMessage v1 and v2', () => {
    const v1 = buildPledgeAuthMessage({ nonce: 42 })
    expect(v1).toBe(`${CW721SVG_DST}42`)
    const bare = 'ab'.repeat(32)
    const v2 = buildPledgeAuthMessage({ nonce: '99', digestHexBare: bare })
    expect(v2).toBe(`${CW721SVG_DST}99|${bare}`)
    expect(v2.length).toBeLessThanOrEqual(CW721SVG_DST.length + AUTH_MSG_MAX_EXTRA)
    expect(() => buildPledgeAuthMessage({ nonce: 'nope' })).toThrow(/nonce/)
    expect(() =>
      buildPledgeAuthMessage({ nonce: 1, digestHexBare: 'zz' })
    ).toThrow(/64/)
  })

  test('generatePledgeAuthNonce is decimal digits', () => {
    const n = generatePledgeAuthNonce()
    expect(n).toMatch(/^\d+$/)
    expect(n.length).toBeGreaterThan(10)
  })

  test('buildCosmosArbitraryExt base64-encodes message bytes', () => {
    const authMessage = buildPledgeAuthMessage({ nonce: 7 })
    const ext = buildCosmosArbitraryExt({
      authMessage,
      signatureBase64: 'c2ln',
      pubkeyBase64: 'cHVi',
      hrp: 'terp',
    })
    expect(ext.hrp).toBe('terp')
    expect(ext.message).toBeTruthy()
    // round-trip: message field is base64 of utf8(authMessage)
    expect(new TextDecoder().decode(
      Uint8Array.from(atob(ext.message), (c) => c.charCodeAt(0))
    )).toBe(authMessage)
  })

  test('buildPledgeTokenMetadata includes project and commitments', () => {
    const meta = buildPledgeTokenMetadata({
      manifestoCid: 'bafy1',
      digestAlg: 'blake2b256',
      digestHex: '0xabc',
      signature: 'sigb64',
      pubkey: 'pubb64',
      pledgeDocUrl: 'https://docs.fileverse.io/example',
      projectId: 'proj-a',
      commitments: [
        { kind: 'ipfs', ref: 'cid2', digestHex: '0x' + 'cd'.repeat(32) },
      ],
      authNonce: '123',
    })
    expect(meta.external_url).toContain('fileverse')
    const types = meta.attributes.map((a) => a.trait_type)
    expect(types).toContain('manifesto_cid')
    expect(types).toContain('project_id')
    expect(types).toContain('commitments')
    expect(types).toContain('auth_nonce')
  })

  test('buildPledgeMintExecuteMsg requires ext and uses contract field names', () => {
    expect(() =>
      // @ts-expect-error intentional missing ext
      buildPledgeMintExecuteMsg({})
    ).toThrow(/requires ext/)

    const authMessage = buildPledgeAuthMessage({
      nonce: 1,
      digestHexBare: '11'.repeat(32),
    })
    const ext = buildCosmosArbitraryExt({
      authMessage,
      signatureBase64: 'c2lnbmF0dXJl',
      pubkeyBase64: 'cHVia2V5',
    })
    expect(buildPledgeMintExecuteMsg({ ext })).toEqual({
      mint: {
        amnt: 1,
        alloc: 0,
        proof_hashes: [],
        ext: {
          pubkey: 'cHVia2V5',
          signature: 'c2lnbmF0dXJl',
          message: ext.message,
          hrp: 'terp',
        },
      },
    })
  })

  test('empty sign-doc still hashes (blake2b256 non-zero)', () => {
    const d = digestPledgeSignDoc('blake2b256', new Uint8Array())
    expect(d.length).toBe(32)
    expect(d.every((b) => b === 0)).toBe(false)
  })

  test('PLEDGE_STORAGE_KEY is trustless_pledge.v1', () => {
    expect(PLEDGE_STORAGE_KEY).toBe('trustless_pledge.v1')
  })

  test('parseTrustlessPledgeStorage handles empty and JSON', () => {
    expect(parseTrustlessPledgeStorage(null)).toBeNull()
    expect(parseTrustlessPledgeStorage('')).toBeNull()
    expect(parseTrustlessPledgeStorage('not-json')).toBeNull()
    expect(
      parseTrustlessPledgeStorage(
        JSON.stringify({
          collection: '  terp1abc  ',
          minter: '',
          ethContract: '',
          manifestoCid: 'bafy1',
          ipfsGateway: 'https://ipfs.terp.network/ipfs/',
        })
      )
    ).toEqual({
      collection: 'terp1abc',
      minter: undefined,
      ethContract: undefined,
      documentTokenId: undefined,
      teamTokenId: undefined,
      manifestoCid: 'bafy1',
      teamCid: undefined,
      ipfsGateway: 'https://ipfs.terp.network/ipfs/',
    })
  })

  test('resolveTrustlessPledgeDiscovery: module wins over storage', () => {
    const storage = serializeTrustlessPledgeStorage({
      collection: 'terp1fromstorage',
      manifestoCid: 'bafy-store',
      ipfsGateway: 'https://gateway.store/ipfs/',
    })
    const r = resolveTrustlessPledgeDiscovery({
      module: {
        collection: 'terp1frommodule',
        manifestoCid: '',
        ipfsGateway: '',
      },
      storageRaw: storage,
    })
    expect(r.collection).toBe('terp1frommodule')
    expect(r.manifestoCid).toBe('bafy-store')
    expect(r.ipfsGateway).toBe('https://gateway.store/ipfs/')
    expect(r.source).toBe('merged')
  })

  test('resolveTrustlessPledgeDiscovery: storage alone when module empty', () => {
    const storage = serializeTrustlessPledgeStorage({
      collection: 'terp1onlystorage',
      manifestoCid: 'bafy-only',
    })
    const r = resolveTrustlessPledgeDiscovery({
      module: { collection: '', manifestoCid: '' },
      storageRaw: storage,
    })
    expect(r.collection).toBe('terp1onlystorage')
    expect(r.manifestoCid).toBe('bafy-only')
    expect(r.source).toBe('dao_storage')
  })

})
