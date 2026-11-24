/**
 * G-unit: one-hot selector, pad strip, envelope parse errors, auth headers.
 */
import { describe, expect, test } from 'vitest'

import {
  bearerAuthHeaders,
  buildOneHotSelector,
  createHeadstashNotesClient,
  decryptNoteOut,
  encryptNoteOut,
  fixtureCleartext382,
  HeadstashNotesError,
  isValidOneHot,
  resolveAuthHeaders,
  sortNoteKeys,
  stripTrailingNulPad,
  validateNoteId,
  SCHEME_XCHACHA20POLY1305,
  CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
  SEAM_NOTE_OUT_V0_LEN,
} from './index'
import { bytesToHex, hexToBytes } from './hex'

describe('G-unit: one-hot selector', () => {
  test('builds selector for middle key', () => {
    const keys = sortNoteKeys(['cm.bb', 'cm.aa', 'cm.cc'])
    expect(keys).toEqual(['cm.aa', 'cm.bb', 'cm.cc'])
    const sel = buildOneHotSelector(keys, 'cm.bb')
    expect(sel).toEqual([0, 1, 0])
    expect(isValidOneHot(sel, 3)).toBe(true)
  })

  test('throws when addr missing', () => {
    expect(() => buildOneHotSelector(['a', 'b'], 'c')).toThrow(/not in keys/)
  })

  test('single key selector', () => {
    expect(buildOneHotSelector(['only'], 'only')).toEqual([1])
  })

  test('rejects non one-hot', () => {
    expect(isValidOneHot([0, 0], 2)).toBe(false)
    expect(isValidOneHot([1, 1], 2)).toBe(false)
    expect(isValidOneHot([1, 0, 0], 2)).toBe(false)
    expect(isValidOneHot([2, 0], 2)).toBe(false)
  })
})

describe('G-unit: pad strip', () => {
  test('strips trailing NULs', () => {
    const raw = new TextEncoder().encode('{"a":1}')
    const padded = new Uint8Array(raw.length + 8)
    padded.set(raw)
    const stripped = stripTrailingNulPad(padded)
    expect(new TextDecoder().decode(stripped)).toBe('{"a":1}')
  })

  test('empty blob', () => {
    expect(stripTrailingNulPad(new Uint8Array(0)).length).toBe(0)
  })

  test('all zeros', () => {
    expect(stripTrailingNulPad(new Uint8Array(4)).length).toBe(0)
  })

  test('no pad', () => {
    const b = new Uint8Array([1, 2, 3])
    expect([...stripTrailingNulPad(b)]).toEqual([1, 2, 3])
  })

  test('internal zeros preserved', () => {
    const b = new Uint8Array([1, 0, 2, 0, 0])
    expect([...stripTrailingNulPad(b)]).toEqual([1, 0, 2])
  })
})

describe('G-unit: envelope parse / crypto errors', () => {
  const key = new Uint8Array(32).fill(0xe1)
  const clear = fixtureCleartext382(0x11)

  test('encrypt/decrypt roundtrip 382B', () => {
    const env = encryptNoteOut(clear, key)
    expect(env.scheme).toBe(SCHEME_XCHACHA20POLY1305)
    expect(env.cleartext_layout).toBe(CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0)
    expect(env.cleartext_len).toBe(SEAM_NOTE_OUT_V0_LEN)
    expect(hexToBytes(env.nonce).length).toBe(24)
    const pt = decryptNoteOut(env, key)
    expect(bytesToHex(pt)).toBe(bytesToHex(clear))
  })

  test('fixed nonce vector is stable', () => {
    const nonce = new Uint8Array(24).fill(0x07)
    const env = encryptNoteOut(clear, key, { nonce })
    expect(env.nonce).toBe('07'.repeat(24))
    const again = encryptNoteOut(clear, key, { nonce })
    expect(again.ciphertext).toBe(env.ciphertext)
    expect(bytesToHex(decryptNoteOut(env, key))).toBe(bytesToHex(clear))
  })

  test('wrong owner key fails closed', () => {
    const env = encryptNoteOut(clear, key)
    const wrong = new Uint8Array(32).fill(0xff)
    expect(() => decryptNoteOut(env, wrong)).toThrow(HeadstashNotesError)
    try {
      decryptNoteOut(env, wrong)
    } catch (e) {
      expect(e).toBeInstanceOf(HeadstashNotesError)
      expect((e as HeadstashNotesError).err.kind).toBe('decrypt')
    }
  })

  test('reject wrong scheme', () => {
    const env = encryptNoteOut(clear, key)
    env.scheme = 'aes-gcm'
    expect(() => decryptNoteOut(env, key)).toThrow(/unsupported scheme/)
  })

  test('reject wrong layout', () => {
    const env = encryptNoteOut(clear, key)
    env.cleartext_layout = 'OTHER'
    expect(() => decryptNoteOut(env, key)).toThrow(/unsupported layout/)
  })

  test('reject bad cleartext_len', () => {
    const env = encryptNoteOut(clear, key)
    env.cleartext_len = 100
    expect(() => decryptNoteOut(env, key)).toThrow(HeadstashNotesError)
  })

  test('reject bad nonce length', () => {
    const env = encryptNoteOut(clear, key)
    env.nonce = 'aa'
    expect(() => decryptNoteOut(env, key)).toThrow(/bad nonce/i)
  })

  test('reject bad hex ciphertext', () => {
    const env = encryptNoteOut(clear, key)
    env.ciphertext = 'zz'
    expect(() => decryptNoteOut(env, key)).toThrow(HeadstashNotesError)
  })

  test('reject wrong cleartext length on encrypt', () => {
    expect(() => encryptNoteOut(new Uint8Array(10), key)).toThrow(
      HeadstashNotesError
    )
  })

  test('optional ciphertext sha256', () => {
    const env = encryptNoteOut(clear, key, { includeCiphertextSha256: true })
    expect(env.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(bytesToHex(decryptNoteOut(env, key))).toBe(bytesToHex(clear))
  })
})

describe('G-unit: auth headers', () => {
  test('bearerAuthHeaders adds Bearer prefix', () => {
    expect(bearerAuthHeaders('tok')).toEqual({
      Authorization: 'Bearer tok',
    })
  })

  test('bearerAuthHeaders preserves existing Bearer', () => {
    expect(bearerAuthHeaders('Bearer already')).toEqual({
      Authorization: 'Bearer already',
    })
  })

  test('empty token yields empty headers', () => {
    expect(bearerAuthHeaders('')).toEqual({})
    expect(bearerAuthHeaders('   ')).toEqual({})
  })

  test('resolveAuthHeaders merges with explicit win', () => {
    const h = resolveAuthHeaders({
      bearerToken: 'from-token',
      authHeaders: { Authorization: 'Bearer explicit', 'X-Extra': '1' },
    })
    expect(h.Authorization).toBe('Bearer explicit')
    expect(h['X-Extra']).toBe('1')
  })

  test('client attaches Authorization on list (mocked fetch)', async () => {
    const seen: { url: string; auth?: string | null }[] = []
    const client = createHeadstashNotesClient({
      notesBase: 'http://notes.test',
      authHeaders: bearerAuthHeaders('secret-lab'),
      fetchImpl: async (input, init) => {
        const url = String(input)
        const headers = new Headers(init?.headers)
        seen.push({ url, auth: headers.get('Authorization') })
        if (url.endsWith('/notes/hs1')) {
          return new Response(JSON.stringify({ keys: ['cm.aa'] }), {
            status: 200,
          })
        }
        return new Response('nope', { status: 404 })
      },
    })
    const keys = await client.listNoteKeys('hs1')
    expect(keys).toEqual(['cm.aa'])
    expect(seen[0]?.auth).toBe('Bearer secret-lab')
    expect(seen[0]?.url).toBe('http://notes.test/notes/hs1')
  })

  test('client attaches auth on put/get/pir', async () => {
    const methods: string[] = []
    const client = createHeadstashNotesClient({
      notesBase: 'https://n.example/',
      authHeaders: bearerAuthHeaders('t'),
      fetchImpl: async (input, init) => {
        methods.push(`${init?.method} ${String(input)}`)
        const h = new Headers(init?.headers)
        expect(h.get('Authorization')).toBe('Bearer t')
        if (init?.method === 'PUT') {
          return new Response('{}', { status: 201 })
        }
        if (String(input).endsWith('/pir')) {
          // minimal JSON envelope padded
          const json = JSON.stringify({
            ciphertext: 'aa',
            nonce: 'bb'.repeat(24),
            scheme: SCHEME_XCHACHA20POLY1305,
            cleartext_layout: CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
            cleartext_len: 382,
          })
          const bytes = new TextEncoder().encode(json)
          return new Response(
            JSON.stringify({ result: bytesToHex(bytes) }),
            { status: 200 }
          )
        }
        if (String(input).match(/\/notes\/hs\/cm\./)) {
          return new Response(
            JSON.stringify({
              ciphertext: 'aa',
              nonce: 'bb'.repeat(24),
              scheme: SCHEME_XCHACHA20POLY1305,
              cleartext_layout: CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
              cleartext_len: 382,
            }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({ keys: ['cm.aa'] }), {
          status: 200,
        })
      },
    })
    const env = {
      ciphertext: 'aa',
      nonce: 'bb'.repeat(24),
      scheme: SCHEME_XCHACHA20POLY1305,
      cleartext_layout: CLEARTEXT_LAYOUT_SEAM_NOTE_OUT_V0,
      cleartext_len: 382,
    }
    await client.putNoteEnvelope('hs', 'cm.aa', env)
    await client.getNoteEnvelope('hs', 'cm.aa')
    await client.listNoteKeys('hs')
    await client.pirGetNoteEnvelope('hs', 'cm.aa')
    expect(methods.some((m) => m.startsWith('PUT'))).toBe(true)
    expect(methods.some((m) => m.startsWith('GET'))).toBe(true)
    expect(methods.some((m) => m.includes('/pir'))).toBe(true)
  })

  test('401 surfaces as http error', async () => {
    const client = createHeadstashNotesClient({
      notesBase: 'http://n',
      fetchImpl: async () => new Response('nope', { status: 401 }),
    })
    await expect(client.listNoteKeys('hs')).rejects.toMatchObject({
      err: { kind: 'http', status: 401 },
    })
  })
})

describe('G-unit: validateNoteId', () => {
  test('accepts cm. and season', () => {
    expect(() => validateNoteId('season-1')).not.toThrow()
    expect(() => validateNoteId('cm.' + 'ab'.repeat(32))).not.toThrow()
  })
  test('rejects path chars', () => {
    expect(() => validateNoteId('a/b')).toThrow()
    expect(() => validateNoteId('has space')).toThrow()
    expect(() => validateNoteId('')).toThrow()
  })
})

