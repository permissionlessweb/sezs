import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pages = join(here, '../../pages')
const frame = readFileSync(join(here, '../ui/Frame.tsx'), 'utf8')

const skip = new Set(['_app.tsx', '_document.tsx'])
const redirects = new Set(['artist.tsx', 'checkin.tsx', 'usher.tsx', 'calendar.tsx', 'raffles.tsx', 'notes.tsx'])

test('every page route uses the shared frame (redirect stubs use Redirect)', () => {
  const files = readdirSync(pages).filter((f) => f.endsWith('.tsx') && !f.startsWith('._'))
  assert.ok(files.includes('404.tsx'))
  for (const f of files) {
    if (skip.has(f)) continue
    const src = readFileSync(join(pages, f), 'utf8')
    if (redirects.has(f)) assert.match(src, /Redirect/, `${f} missing Redirect`)
    else assert.match(src, /Frame|Shell/, `${f} missing Frame`)
  }
})

test('frame mounts the field on every page', () => {
  assert.match(frame, /<Field/)
})
