import {
  requireConfig,
  requireOwner,
  getRepo,
  getDataBranch,
  getBundlePath,
  ghGetFile,
  decryptJson,
} from './_shared.js'

/**
 * GET /api/bundle — return the owner's latest decrypted snapshot.
 *
 * Auth:    Bearer <full-scope JWT from /api/unlock>
 * Returns: { ok: true, bundle, updated_at } | { ok: true, bundle: null }
 *
 * The plaintext bet log is only ever assembled server-side and handed to
 * an authenticated owner over HTTPS — the public `data` branch only ever
 * holds the AES-256-GCM ciphertext.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' })
  }

  const cfg = requireConfig()
  if (!cfg.ok) return res.status(500).json({ ok: false, reason: cfg.reason })

  const auth = requireOwner(req)
  if (!auth.ok) return res.status(auth.status).json({ ok: false, reason: auth.reason })

  const token = process.env.GITHUB_TOKEN
  const encKey = process.env.DATA_ENCRYPTION_KEY
  const repo = getRepo()
  const branch = getDataBranch()
  const path = getBundlePath()

  try {
    const file = await ghGetFile(repo, token, path, branch)
    // No branch / no file yet → nothing synced. Caller keeps local data.
    if (!file || !file.json) {
      return res.status(200).json({ ok: true, bundle: null })
    }
    const bundle = decryptJson(file.json, encKey)
    if (!bundle) {
      // Usually a rotated/wrong DATA_ENCRYPTION_KEY.
      return res.status(200).json({ ok: false, reason: 'decrypt_failed', bundle: null })
    }
    return res.status(200).json({ ok: true, bundle, updated_at: file.json.updated_at || '' })
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reason: 'github_error',
      detail: String(err?.message || err).slice(0, 200),
    })
  }
}
