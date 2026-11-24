import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(join(here, 'CheckInPanel.tsx'), 'utf8')
const door = readFileSync(join(here, 'door.ts'), 'utf8')
const usherDoor = readFileSync(join(here, 'UsherDoor.tsx'), 'utf8')
const checkin = readFileSync(join(here, '../../pages/check-in.tsx'), 'utf8')

test('check-in is the usher door for a ticket QR', () => {
  assert.match(checkin, /CheckInPanel/)
  assert.match(checkin, /isSignedInUsher/)
  assert.match(checkin, /TicketVault/)
  assert.match(checkin, /usher=\{usher\}/)
  assert.doesNotMatch(checkin, /\b(mock|placeholder|lorem|TODO)\b/)
})

test('panel shows the guest ticket and, for ushers only, the door', () => {
  assert.match(panel, /UsherDoor/)
  assert.match(panel, /Your ticket/)
  assert.match(panel, /\{usher \? <UsherDoor \/> : null\}/)
  assert.doesNotMatch(panel, /commitPaid/)
  assert.doesNotMatch(panel, /ListMembers/)
  assert.doesNotMatch(panel, /\b(mock|placeholder|lorem|TODO)\b/)
})

test('usher door scans a compact QR, proves on this device, and relays the consume', () => {
  assert.match(usherDoor, /parseGuestQr/)
  assert.match(usherDoor, /createProver/)
  assert.match(usherDoor, /submitConsumeV3/)
  assert.match(usherDoor, /Authorize with Zafu/)
  assert.match(usherDoor, /signAmino/)
  assert.match(usherDoor, /already admitted/i)
  assert.doesNotMatch(usherDoor, /commitPaid/)
  assert.doesNotMatch(usherDoor, /\b(mock|placeholder|lorem)\b/)
})

test('door query is GuestRoot only, credentials omitted', () => {
  assert.match(door, /guest_root:\s*\{\s*\}/)
  assert.match(door, /credentials:\s*'omit'/)
  assert.match(door, /FORBIDDEN_DOOR_QUERIES/)
  assert.match(door, /['"]list_members['"]/)
  assert.doesNotMatch(door, /method:\s*['"]POST['"]/)
  assert.doesNotMatch(door, /mnemonic|PRIVATE_KEY|password/i)
  assert.doesNotMatch(door, /b64json\(\s*\{[^}]*list_members/)
})
