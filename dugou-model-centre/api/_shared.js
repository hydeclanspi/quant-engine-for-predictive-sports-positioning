import {
  createHmac,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Shared helpers for the git-as-sync serverless endpoints
 * (`/api/commit-bundle` and `/api/bundle`).
 *
 * Files prefixed with `_` inside `/api` are treated by Vercel as support
 * modules, not routes — so this never becomes an endpoint. The default
 * export below is a defensive 404 in case that ever changes.
 *
 * Design (see api/README.md for the full picture):
 *   - The owner's live snapshot is stored AES-256-GCM encrypted on a
 *     dedicated `data` branch of the (public) repo, so the ciphertext is
 *     world-readable but the plaintext bet log never is.
 *   - Both endpoints require a valid FULL-scope JWT (the same token
 *     `/api/unlock` issues), so only the unlocked owner can read the
 *     decrypted data or write to the store.
 *   - Writes union-merge with whatever is already stored (incoming wins
 *     per record id, but nothing already stored is ever dropped), so two
 *     devices committing near-simultaneously can never lose each other's
 *     records — strictly safer than the previous last-write-wins upsert.
 */

const GH = 'https://api.github.com'

// ── env / config ──────────────────────────────────────────────────────

export const getRepo = () => {
  const explicit = String(process.env.GITHUB_REPO || '').trim()
  if (explicit) return explicit
  // Vercel injects these automatically for git-connected projects, so the
  // owner usually doesn't need to set GITHUB_REPO at all.
  const owner = String(process.env.VERCEL_GIT_REPO_OWNER || '').trim()
  const slug = String(process.env.VERCEL_GIT_REPO_SLUG || '').trim()
  return owner && slug ? `${owner}/${slug}` : ''
}

export const getDataBranch = () => String(process.env.GITHUB_DATA_BRANCH || 'data').trim()
export const getBundlePath = () => String(process.env.GITHUB_BUNDLE_PATH || 'data/liveBundle.enc.json').trim()
export const getDefaultBranch = () =>
  String(process.env.GITHUB_DEFAULT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || 'main').trim()

export const requireConfig = () => {
  if (!process.env.GITHUB_TOKEN) return { ok: false, reason: 'missing_github_token' }
  if (!process.env.DATA_ENCRYPTION_KEY) return { ok: false, reason: 'missing_encryption_key' }
  if (!process.env.JWT_SECRET) return { ok: false, reason: 'missing_jwt_secret' }
  if (!getRepo()) return { ok: false, reason: 'missing_repo' }
  return { ok: true }
}

// ── request parsing ───────────────────────────────────────────────────

export const parseBody = (req) => {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return req.body
}

// ── JWT (HS256) verification — mirrors the token `/api/unlock` signs ────

const b64urlToBuffer = (input) => {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

export const verifyJwt = (token, secret) => {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  let provided
  try {
    provided = b64urlToBuffer(signature)
  } catch {
    return null
  }
  if (expected.length !== provided.length) return null
  if (!timingSafeEqual(expected, provided)) return null
  let claims
  try {
    claims = JSON.parse(b64urlToBuffer(payload).toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null
  return claims
}

/**
 * Gate an endpoint behind a valid FULL-scope owner token. Returns
 * `{ ok: true, claims }` or `{ ok: false, status, reason }`.
 */
export const requireOwner = (req) => {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 16) return { ok: false, status: 500, reason: 'server_misconfigured' }
  const raw = req.headers?.authorization || req.headers?.Authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(String(raw))
  if (!match) return { ok: false, status: 401, reason: 'unauthorized' }
  const claims = verifyJwt(match[1].trim(), secret)
  if (!claims) return { ok: false, status: 401, reason: 'invalid_token' }
  if (claims.scope !== 'full') return { ok: false, status: 403, reason: 'forbidden_scope' }
  return { ok: true, claims }
}

// ── AES-256-GCM envelope ──────────────────────────────────────────────

// Any passphrase works — we hash it to a fixed 32-byte key, so the owner
// can paste a random string into DATA_ENCRYPTION_KEY just like JWT_SECRET.
const deriveKey = (secret) => createHash('sha256').update(String(secret)).digest()

export const encryptJson = (obj, secret) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    schema: 'dugou_enc_v1',
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
    updated_at: new Date().toISOString(),
  }
}

export const decryptJson = (envelope, secret) => {
  if (!envelope || typeof envelope !== 'object' || envelope.alg !== 'aes-256-gcm') return null
  try {
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    const ciphertext = Buffer.from(envelope.ct, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    return null
  }
}

// ── snapshot merge (server-side, union — never drops a stored record) ──

const indexById = (arr) => {
  const map = new Map()
  ;(Array.isArray(arr) ? arr : []).forEach((item) => {
    if (item && item.id != null) map.set(String(item.id), item)
  })
  return map
}

// Pool settlements & capital injections are append-only ledgers stored
// inside system_config — union them by id so an empty/stale config can
// never drop them (mirrors mergeSystemConfig on the client).
const LEDGER_CONFIG_KEYS = ['poolSettlements', 'capitalInjections']

const mergeSystemConfig = (baseCfg, nextCfg) => {
  const merged = { ...(baseCfg || {}), ...(nextCfg || {}) }
  for (const key of LEDGER_CONFIG_KEYS) {
    const map = new Map()
    ;(Array.isArray(baseCfg?.[key]) ? baseCfg[key] : []).forEach((x) => {
      if (x && x.id != null) map.set(String(x.id), x)
    })
    ;(Array.isArray(nextCfg?.[key]) ? nextCfg[key] : []).forEach((x) => {
      if (x && x.id != null) map.set(String(x.id), x)
    })
    merged[key] = [...map.values()]
  }
  return merged
}

export const mergeBundles = (stored, incoming) => {
  const base = stored && typeof stored === 'object' ? stored : {}
  const next = incoming && typeof incoming === 'object' ? incoming : {}

  // investments: start from stored, overlay incoming (incoming wins per id,
  // stored-only records survive a stale writer).
  const investmentMap = indexById(base.investments)
  indexById(next.investments).forEach((value, key) => investmentMap.set(key, value))

  // team_profiles: keyed by teamId (fallback teamName), incoming wins.
  const teamKey = (team) => String(team?.teamId ?? team?.teamName ?? '')
  const teamMap = new Map()
  ;(Array.isArray(base.team_profiles) ? base.team_profiles : []).forEach((t) => teamMap.set(teamKey(t), t))
  ;(Array.isArray(next.team_profiles) ? next.team_profiles : []).forEach((t) => teamMap.set(teamKey(t), t))

  // access_logs: union by id, newest wins, capped.
  const logMap = indexById(base.access_logs)
  indexById(next.access_logs).forEach((value, key) => {
    const existing = logMap.get(key)
    if (!existing || new Date(value.created_at || 0).getTime() >= new Date(existing.created_at || 0).getTime()) {
      logMap.set(key, value)
    }
  })
  const accessLogs = [...logMap.values()]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 600)

  return {
    version: Number(next.version) || Number(base.version) || 1,
    exported_at: new Date().toISOString(),
    system_config: mergeSystemConfig(base.system_config, next.system_config),
    team_profiles: [...teamMap.values()],
    investments: [...investmentMap.values()],
    access_logs: accessLogs,
  }
}

// ── GitHub REST helpers (uses global fetch — Node 18+ on Vercel) ───────

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dugou-git-sync',
})

const encodePath = (path) =>
  String(path)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

const ghGetRefSha = async (repo, token, branch) => {
  const res = await fetch(`${GH}/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get ref ${branch} -> ${res.status}`)
  const json = await res.json()
  return json?.object?.sha || null
}

/** Create `branch` from `fromBranch` if it doesn't already exist. */
export const ghEnsureBranch = async (repo, token, branch, fromBranch) => {
  const existing = await ghGetRefSha(repo, token, branch)
  if (existing) return
  const baseSha = await ghGetRefSha(repo, token, fromBranch)
  if (!baseSha) throw new Error(`base branch ${fromBranch} not found`)
  const res = await fetch(`${GH}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  })
  // 422 = ref already exists (race with a concurrent writer) — fine.
  if (!res.ok && res.status !== 422) throw new Error(`create branch ${branch} -> ${res.status}`)
}

/** Returns `{ sha, json }` for the file, or null if it doesn't exist. */
export const ghGetFile = async (repo, token, path, branch) => {
  const res = await fetch(`${GH}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get file -> ${res.status}`)
  const json = await res.json()
  let parsed = null
  try {
    parsed = JSON.parse(Buffer.from(json.content || '', 'base64').toString('utf8'))
  } catch {
    parsed = null
  }
  return { sha: json.sha, json: parsed }
}

/** PUT file contents. Returns the raw Response so callers can detect 409/422. */
export const ghPutFile = async (repo, token, path, branch, jsonObj, sha, message) => {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8').toString('base64'),
    branch,
  }
  if (sha) body.sha = sha
  return fetch(`${GH}/repos/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Defensive: inert if Vercel ever exposes this support module as a route.
export default function handler(req, res) {
  return res.status(404).json({ ok: false, reason: 'not_found' })
}
