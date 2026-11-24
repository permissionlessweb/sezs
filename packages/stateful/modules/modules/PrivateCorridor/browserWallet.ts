/**
 * Browser-side deposit wallet for production Private Bridge deployments.
 *
 * Same generation pattern as dao-dao SelfRelay:
 *   DirectSecp256k1HdWallet.generate(24) — keys only exist in the client.
 *
 * BTC receive: native segwit P2WPKH (BIP173) from the compressed secp256k1 pubkey
 * so Cash App / wallet QR funding targets a real address format on the configured
 * Bitcoin network (mainnet | testnet).
 *
 * Auth link carries intent + client proof digests only — never the mnemonic.
 */

import { toHex } from '@cosmjs/encoding'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'

import {
  BtcNetwork,
  bitcoinPaymentUri,
  p2wpkhAddressFromCompressedPubkey,
} from './btcAddress'

const STORAGE_PREFIX = 'dao-dao:private-corridor:deposit-mnemonic:'

export type BrowserDepositWallet = {
  mnemonic: string
  /** CosmJS bech32 account (Terp/Cosmos identity handle for the same seed). */
  cosmosStyleAddress: string
  publicKeyHex: string
  /** P2WPKH address (bc1… / tb1…) for production funding QR. */
  btcDepositAddress: string
  bitcoinPaymentUri: string
  btcNetwork: BtcNetwork
}

export type GenerateWalletOptions = {
  /** CosmJS bech32 prefix for the cosmos-style account (default terp). */
  cosmosPrefix?: string
  /** Bitcoin network for P2WPKH receive address. */
  btcNetwork?: BtcNetwork
  /** Optional amount for bitcoin: URI (BTC decimal string). */
  amountBtc?: string
  label?: string
}

/** Generate a fresh 24-word HD wallet in the browser (SelfRelay parity). */
export const generateBrowserDepositWallet = async (
  opts: GenerateWalletOptions = {}
): Promise<BrowserDepositWallet> => {
  const cosmosPrefix = opts.cosmosPrefix ?? 'terp'
  const btcNetwork = opts.btcNetwork ?? 'mainnet'
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: cosmosPrefix,
  })
  return materializeWallet(wallet, btcNetwork, opts)
}

export const walletFromMnemonic = async (
  mnemonic: string,
  opts: GenerateWalletOptions = {}
): Promise<BrowserDepositWallet> => {
  const cosmosPrefix = opts.cosmosPrefix ?? 'terp'
  const btcNetwork = opts.btcNetwork ?? 'mainnet'
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: cosmosPrefix,
  })
  return materializeWallet(wallet, btcNetwork, opts)
}

const materializeWallet = async (
  wallet: DirectSecp256k1HdWallet,
  btcNetwork: BtcNetwork,
  opts: GenerateWalletOptions
): Promise<BrowserDepositWallet> => {
  const [account] = await wallet.getAccounts()
  const publicKeyHex = toHex(account.pubkey)
  const btcDepositAddress = await p2wpkhAddressFromCompressedPubkey(
    account.pubkey,
    btcNetwork
  )
  return {
    mnemonic: wallet.mnemonic,
    cosmosStyleAddress: account.address,
    publicKeyHex,
    btcDepositAddress,
    bitcoinPaymentUri: bitcoinPaymentUri(btcDepositAddress, {
      amountBtc: opts.amountBtc,
      label: opts.label ?? 'Terp Private Bridge deposit',
      message: 'Private corridor deposit',
    }),
    btcNetwork,
  }
}

export const persistDepositMnemonic = (
  intentId: string,
  mnemonic: string
): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + intentId, mnemonic)
  } catch {
    // private mode
  }
}

export const loadDepositMnemonic = (intentId: string): string | null => {
  try {
    return localStorage.getItem(STORAGE_PREFIX + intentId)
  } catch {
    return null
  }
}

export const clearDepositMnemonic = (intentId: string): void => {
  try {
    localStorage.removeItem(STORAGE_PREFIX + intentId)
  } catch {
    // ignore
  }
}

/**
 * Client-side binding of wallet material to sealed intent (production-shaped).
 * v0: commitment digest; production hardening: secp256k1 sign(domain_bind) with HD key.
 */
export const buildClientWalletProof = async (args: {
  domainBind: string
  publicKeyHex: string
  btcDepositAddress: string
  destOwnerBinding: string
}): Promise<ClientWalletProof> => {
  const message = [
    'terp-corridor-client-proof-v0',
    args.domainBind,
    args.publicKeyHex,
    args.btcDepositAddress,
    args.destOwnerBinding,
  ].join('|')

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto required for client proof in production UI')
  }
  const data = new TextEncoder().encode(message)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const proofDigest = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')

  return {
    version: 0,
    scheme: 'client-commitment-sha256-v0',
    public_key_hex: args.publicKeyHex,
    btc_deposit_addr: args.btcDepositAddress,
    dest_owner_binding: args.destOwnerBinding,
    domain_bind: args.domainBind,
    proof_digest: proofDigest,
    created_at: Math.floor(Date.now() / 1000),
  }
}

export type ClientWalletProof = {
  version: 0
  scheme: 'client-commitment-sha256-v0' | 'secp256k1-sign-v1'
  public_key_hex: string
  btc_deposit_addr: string
  dest_owner_binding: string
  domain_bind: string
  proof_digest: string
  created_at: number
}

/** Auth / intent deep link after client proof — no mnemonic. */
export const buildCorridorAuthLink = (args: {
  baseUrl?: string
  intentId: string
  domainBind: string
  btcDepositAddress: string
  destOwnerBinding: string
  proofDigest: string
  corridorId: string
}): string => {
  const origin =
    args.baseUrl?.replace(/\/$/, '') ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  const params = new URLSearchParams({
    corridor: args.corridorId,
    intent: args.intentId,
    bind: args.domainBind,
    deposit: args.btcDepositAddress,
    dest: args.destOwnerBinding,
    proof: args.proofDigest,
  })
  return `${origin}/private-bridge/auth?${params.toString()}`
}
