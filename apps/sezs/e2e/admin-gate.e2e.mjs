/**
 * /admin staff endpoints refuse anonymous callers. Loopback only.
 */
import assert from "node:assert/strict"

const APP = process.env.SEZS_APP || "http://127.0.0.1:3051"

const json = async (path, init = {}) => {
  const res = await fetch(APP + path, init)
  const body = await res.json()
  return { status: res.status, body }
}

const denied = await json("/sezs/frost/admin-set")
assert.equal(denied.status, 403)
assert.equal(denied.body.ok, false)
assert.ok(denied.body.error)

const grants = await json("/sezs/v2/door/device/grants")
assert.equal(grants.status, 403)
assert.equal(grants.body.ok, false)

const page = await fetch(APP + "/admin/")
assert.equal(page.ok, true)
const html = await page.text()
assert.match(html, /"page":"\/admin"/)
assert.doesNotMatch(html, /group key/)
assert.doesNotMatch(html, /role="tablist"/)
console.log("admin-gate e2e ok")
