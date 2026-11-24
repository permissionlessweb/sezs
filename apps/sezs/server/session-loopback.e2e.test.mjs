import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import { dirname, extname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { ed25519 } from "@noble/curves/ed25519"

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(__dirname, "..")
const OUT_DIR = join(APP_DIR, "out")
const SERVER_ENTRY = join(__dirname, "http-server.mjs")

const BALTIMORE = "terp1qf4plkes8hmtpdjp06qmggdd69z067gt2jz6ffgymunxmwcj5p6s60vkyz"
const CHICAGO = "terp1tz0setr8vkh9udp8xyxgpqc89ns27k4d0jx2h942hr0ax63yjhmqx7ajem"
const PHILA = "terp1dyxlfhc3gtlvcerlrsag75vqfx2hukea4723ffqvygu6ta2j98eqct2jsl"
const COORDINATOR = "terp1fxccvvhhy43tvet2ah7jqwq4cwl9k3dxmww052"

const sha256 = (d) => createHash("sha256").update(d).digest()
const bytesToHex = (u8) => Buffer.from(u8).toString("hex")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
}

function makePasskey(credId = "cred-e2e-loopback-012345") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const spki = publicKey.export({ format: "der", type: "spki" })
  const rawPub = spki.subarray(spki.length - 65)
  assert.equal(rawPub.length, 65)
  return {
    credId,
    publicKeyB64: rawPub.toString("base64"),
    signAssertion: (challengeB64, { origin = "https://permissionless.money", rpId = "permissionless.money", signCount = 1 } = {}) => {
      const clientBytes = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challengeB64, origin, crossOrigin: false }), "utf8")
      const authData = Buffer.alloc(37)
      sha256(rpId).copy(authData, 0)
      authData[32] = 0x05 // UP + UV
      authData.writeUInt32BE(signCount, 33)
      const sig = cryptoSign("sha256", Buffer.concat([authData, sha256(clientBytes)]), privateKey)
      return {
        clientDataJSON: clientBytes.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: sig.toString("base64url"),
      }
    },
  }
}

async function startMockLcd() {
  const map = {
    [BALTIMORE]: { curators: [COORDINATOR], coordinators: [COORDINATOR], ushers: [] },
    [CHICAGO]: { curators: [COORDINATOR], coordinators: [COORDINATOR], ushers: [] },
    [PHILA]: { curators: [COORDINATOR], coordinators: [COORDINATOR], ushers: [] },
  }
  const srv = http.createServer((req, res) => {
    const m = (req.url || "").match(/\/cosmwasm\/wasm\/v1\/contract\/([^/]+)\/smart\//)
    if (!m || !map[m[1]]) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ message: "not found" }))
      return
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: map[m[1]] }))
  })
  await new Promise((r) => srv.listen(0, "127.0.0.1", r))
  const { port } = srv.address()
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) }
}

async function startSessionChild(env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let logs = ""
  const port = await new Promise((resolvePort, rejectPort) => {
    const timer = setTimeout(() => rejectPort(new Error(`timeout starting server: ${logs}`)), 8000)
    child.stdout.on("data", (chunk) => {
      logs += chunk.toString("utf8")
      const m = logs.match(/listening on 127\.0\.0\.1:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolvePort(Number(m[1]))
      }
    })
    child.stderr.on("data", (chunk) => {
      logs += chunk.toString("utf8")
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      rejectPort(new Error(`server exited early (${code}): ${logs}`))
    })
  })
  return {
    port,
    close: () =>
      new Promise((r) => {
        child.once("exit", r)
        child.kill("SIGTERM")
      }),
  }
}

async function startReverseProxy(sessionPort) {
  const srv = http.createServer(async (req, res) => {
    const urlPath = (req.url || "/").split("?")[0]
    const qs = (req.url || "").includes("?") ? (req.url || "").slice((req.url || "").indexOf("?")) : ""
    if (urlPath.startsWith("/alpha/sezs/api/")) {
      const stripped = "/" + urlPath.slice("/alpha/sezs/api/".length) + qs
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = chunks.length ? Buffer.concat(chunks) : undefined
      const headers = { ...req.headers }
      delete headers.host
      headers["x-forwarded-for"] = "203.0.113.10"
      headers["x-forwarded-proto"] = "https"
      const upstream = await fetch(`http://127.0.0.1:${sessionPort}${stripped}`, {
        method: req.method,
        headers,
        body,
      })
      const respBuf = Buffer.from(await upstream.arrayBuffer())
      const outHeaders = { "content-type": upstream.headers.get("content-type") || "application/json" }
      const setCookie = upstream.headers.getSetCookie?.()
      if (setCookie && setCookie.length) outHeaders["set-cookie"] = setCookie
      res.writeHead(upstream.status, outHeaders)
      res.end(respBuf)
      return
    }
    if (urlPath.startsWith("/alpha/sezs")) {
      let rel = urlPath.slice("/alpha/sezs".length) || "/"
      if (rel === "/") rel = "/index.html"
      else if (rel.endsWith("/")) rel = rel + "index.html"
      const candidate = join(OUT_DIR, rel)
      const indexCandidate = join(OUT_DIR, rel, "index.html")
      const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : existsSync(indexCandidate) ? indexCandidate : null
      if (!file) {
        res.writeHead(404)
        res.end("not found")
        return
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" })
      res.end(readFileSync(file))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  await new Promise((r) => srv.listen(0, "127.0.0.1", r))
  const { port } = srv.address()
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) }
}

test("loopback e2e: built alpha static bundle + production session server on subpath /alpha/sezs/api", async (t) => {
  assert.equal(existsSync(join(OUT_DIR, "index.html")), true, "apps/sezs/out/index.html must exist (build first)")
  const indexHtml = readFileSync(join(OUT_DIR, "index.html"), "utf8")
  if (!indexHtml.includes("/alpha/sezs/")) {
    t.skip("static export was not built with NEXT_PUBLIC_BASE_PATH=/alpha/sezs (run just build, then just test-loopback-e2e)")
    return
  }
  const dir = mkdtempSync(join(tmpdir(), "sezs-e2e-loop-"))
  const secretFile = join(dir, "session.secret")
  writeFileSync(secretFile, randomBytes(32).toString("hex") + "\n", { mode: 0o600 })
  chmodSync(secretFile, 0o600)

  const lcd = await startMockLcd()
  const child = await startSessionChild({
    NODE_ENV: "production",
    SEZS_SESSION_HOST: "127.0.0.1",
    SEZS_SESSION_PORT: "0",
    SEZS_STATE_DIR: dir,
    SEZS_SESSION_DB: join(dir, "sessions.sqlite"),
    SEZS_SESSION_SECRET_FILE: secretFile,
    SEZS_ALLOWED_ORIGINS: "https://permissionless.money",
    SEZS_WEBAUTHN_RP_ID: "permissionless.money",
    SEZS_COOKIE_NAME: "sezs_session",
    SEZS_COOKIE_PATH: "/alpha/sezs/api",
    SEZS_COOKIE_SECURE: "1",
    SEZS_TRUST_PROXY: "1",
    SEZS_EVENT_LCD: lcd.url,
    SEZS_EVENT_CONTRACTS: [BALTIMORE, CHICAGO, PHILA].join(","),
  })
  const proxy = await startReverseProxy(child.port)
  const origin = "https://permissionless.money"

  try {
    // 1. Static alpha pages serve cleanly under /alpha/sezs/
    for (const p of ["/alpha/sezs/", "/alpha/sezs/admin/", "/alpha/sezs/check-in/", "/alpha/sezs/tickets/"]) {
      const r = await fetch(`${proxy.base}${p}`)
      assert.equal(r.status, 200, `${p} returned ${r.status}`)
      const html = await r.text()
      assert.match(html, /\/alpha\/sezs\//)
    }

    // 2. ZID login -> signed cookie -> /sezs/session/me -> /sezs/v2/event/roles -> logout revokes
    const sk = ed25519.utils.randomPrivateKey()
    const pkHex = bytesToHex(ed25519.getPublicKey(sk))
    const chRes = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({ origin, kind: "zid" }),
    })
    assert.equal(chRes.status, 200)
    const ch = await chRes.json()
    assert.equal(ch.ok, true)

    const zidSig = bytesToHex(ed25519.sign(Buffer.from(ch.message, "utf8"), sk))
    const verRes = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({
        origin,
        nonce: ch.nonce,
        ts: ch.ts,
        method: "zid",
        publicKey: pkHex,
        signature: zidSig,
      }),
    })
    assert.equal(verRes.status, 200)
    const verJson = await verRes.json()
    assert.equal(verJson.ok, true)
    assert.equal(verJson.kind, "ed25519/zid")

    const cookies = verRes.headers.getSetCookie()
    assert.equal(cookies.length, 1)
    assert.match(cookies[0], /^sezs_session=v1\./)
    assert.match(cookies[0], /HttpOnly/)
    assert.match(cookies[0], /SameSite=Strict/)
    assert.match(cookies[0], /Secure/)
    assert.match(cookies[0], /Path=\/alpha\/sezs\/api/)
    const cookieHeader = cookies[0].split(";")[0]

    const meRes = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/me?contract=${BALTIMORE}`, {
      headers: { cookie: cookieHeader },
    })
    assert.equal(meRes.status, 200)
    const meJson = await meRes.json()
    assert.equal(meJson.ok, true)
    assert.equal(meJson.kind, "ed25519/zid")
    assert.equal(meJson.login_id, pkHex)

    const rolesRes = await fetch(`${proxy.base}/alpha/sezs/api/sezs/v2/event/roles?contract=${CHICAGO}`)
    assert.equal(rolesRes.status, 200)
    const rolesJson = await rolesRes.json()
    assert.deepEqual(rolesJson.coordinators, [COORDINATOR])

    const outRes = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1", cookie: cookieHeader },
      body: "{}",
    })
    assert.equal(outRes.status, 200)
    const meAfterLogout = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/me`, {
      headers: { cookie: cookieHeader },
    })
    assert.equal(meAfterLogout.status, 200)
    assert.equal((await meAfterLogout.json()).ok, false)

    // 3. Passkey registration login + subsequent discoverable login without publicKey (rpId=permissionless.money)
    const pk = makePasskey()
    const pkCh1Res = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({ origin, kind: "passkey" }),
    })
    assert.equal(pkCh1Res.status, 200)
    const pkCh1 = await pkCh1Res.json()
    assert.equal(pkCh1.rpId, "permissionless.money")
    const assertion1 = pk.signAssertion(pkCh1.challengeB64, { signCount: 1 })
    const pkVer1Res = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({
        origin,
        nonce: pkCh1.nonce,
        ts: pkCh1.ts,
        method: "passkey",
        credId: pk.credId,
        publicKey: pk.publicKeyB64,
        assertion: assertion1,
      }),
    })
    assert.equal(pkVer1Res.status, 200)
    const pkCookie1 = pkVer1Res.headers.getSetCookie()[0].split(";")[0]
    const pkMe1 = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/me`, { headers: { cookie: pkCookie1 } })
    assert.equal((await pkMe1.json()).kind, "p256/passkey")

    // Re-login with same passkey without passing publicKey (discoverable sign-in)
    const pkCh2Res = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({ origin, kind: "passkey" }),
    })
    const pkCh2 = await pkCh2Res.json()
    const assertion2 = pk.signAssertion(pkCh2.challengeB64, { signCount: 2 })
    const pkVer2Res = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-sezs-frost": "1" },
      body: JSON.stringify({
        origin,
        nonce: pkCh2.nonce,
        ts: pkCh2.ts,
        method: "passkey",
        credId: pk.credId,
        assertion: assertion2,
      }),
    })
    assert.equal(pkVer2Res.status, 200)
    const pkCookie2 = pkVer2Res.headers.getSetCookie()[0].split(";")[0]
    const pkMe2 = await fetch(`${proxy.base}/alpha/sezs/api/sezs/session/me`, { headers: { cookie: pkCookie2 } })
    assert.equal((await pkMe2.json()).ok, true)

    // 4. Dev-only endpoints must be 404
    for (const devPath of ["/__splash/health", "/sezs/v2/pay", "/sezs/v2/guest-tickets"]) {
      const r = await fetch(`${proxy.base}/alpha/sezs/api${devPath}`)
      assert.equal(r.status, 404, `${devPath} should be 404`)
    }
  } finally {
    await proxy.close()
    await child.close()
    await lcd.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
