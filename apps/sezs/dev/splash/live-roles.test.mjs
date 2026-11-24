import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, it } from 'node:test'

import { refuseLcd, resolveLiveRole } from './live-roles.mjs'

describe('live cw420 / event role query', () => {
  it('refuses a public or mainnet LCD', () => {
    assert.equal(refuseLcd('https://terp.network'), 'lcd_refused')
    assert.equal(refuseLcd('http://127.0.0.1:1317'), null)
  })

  it('classifies a coordinator from a live group query and an usher from the usher group', async () => {
    const members = {
      'terp1coordgroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx': { data: { members: [{ addr: 'terp1coordinator000000000000000000000000' }] } },
      'terp1ushergroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx': { data: { members: [{ addr: 'terp1usher00000000000000000000000000000' }] } },
    }
    const server = http.createServer((req, res) => {
      const m = /\/contract\/(terp1[a-z0-9]+)\/smart\//.exec(req.url || '')
      const body = members[m?.[1]] || { data: { members: [] } }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    const lcd = `http://127.0.0.1:${port}`
    const cfg = {
      lcd,
      coordinatorsGroup: 'terp1coordgroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      usherGroup: 'terp1ushergroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    }
    const coord = await resolveLiveRole(cfg, { address: 'terp1coordinator000000000000000000000000', sessionRole: 'guest' })
    assert.equal(coord.role, 'coordinator')
    assert.equal(coord.live, true)
    const usher = await resolveLiveRole(cfg, { address: 'terp1usher00000000000000000000000000000', sessionRole: 'usher' })
    assert.equal(usher.role, 'usher')
    const stranger = await resolveLiveRole(cfg, { address: 'terp1nobody0000000000000000000000000000', sessionRole: 'coordinator' })
    assert.equal(stranger.role, 'guest')
    server.close()
  })
})

describe('event contract Roles query', () => {
  it('classifies from the event Roles query and refuses a stranger', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        data: {
          curators: [{ addr: 'terp1curator00000000000000000000000000000' }],
          coordinators: { members: [{ addr: 'terp1coordinator000000000000000000000000' }] },
          ushers: [{ addr: 'terp1usher00000000000000000000000000000' }],
          coordinators_group: 'terp1coordgroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          usher_group: 'terp1ushergroupxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        },
      }))
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    const cfg = { lcd: `http://127.0.0.1:${port}`, contract: 'terp182uvgv8vmzk8yusmtusnq55xs3x3dtp3y69xmmlvcasedtr0ueuqh8f22z' }
    const { queryEventRoles, resolveLiveRole } = await import('./live-roles.mjs')
    const roles = await queryEventRoles(cfg.lcd, cfg.contract)
    assert.equal(roles.coordinators.includes('terp1coordinator000000000000000000000000'), true)
    const coord = await resolveLiveRole(cfg, { address: 'terp1coordinator000000000000000000000000', sessionRole: 'guest' })
    assert.equal(coord.role, 'coordinator')
    assert.equal(coord.source, 'event_roles')
    const curator = await resolveLiveRole(cfg, { address: 'terp1curator00000000000000000000000000000', sessionRole: null })
    assert.equal(curator.role, 'coordinator')
    const usher = await resolveLiveRole(cfg, { address: 'terp1usher00000000000000000000000000000', sessionRole: 'guest' })
    assert.equal(usher.role, 'usher')
    const stranger = await resolveLiveRole(cfg, { address: 'terp1nobody0000000000000000000000000000', sessionRole: 'coordinator' })
    assert.equal(stranger.role, 'guest')
    server.close()
  })
})
