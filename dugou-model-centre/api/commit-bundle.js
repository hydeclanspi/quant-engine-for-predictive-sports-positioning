import {
  requireConfig,
  requireOwner,
  parseBody,
  getRepo,
  getDataBranch,
  getBundlePath,
  getDefaultBranch,
  ghEnsureBranch,
  ghGetFile,
  ghPutFile,
  decryptJson,
  encryptJson,
  mergeBundles,
} from './_shared.js'

/**
 * POST /api/commit-bundle — persist the owner's live snapshot to git.
 *
 * Body:    { snapshot: <DUGOU data bundle> }
 * Auth:    Bearer <full-scope JWT from /api/unlock>
 * Effect:  union-merges `snapshot` into the encrypted bundle on the
 *          `data` branch and commits it. The branch + file are created on
 *          first write, so there is no manual git setup.
 *
 * Reads stay fresh via GET /api/bundle (no redeploy needed); the `data`
 * branch is excluded from Vercel deploys in vercel.json, so these commits
 * don't burn build minutes.
 *
 * Required env (Vercel project settings):
 *   GITHUB_TOKEN          fine-grained PAT, Contents: read+write on this repo
 *   DATA_ENCRYPTION_KEY   any random string (hashed to the AES key)
 *   JWT_SECRET            already set for /api/unlock — reused to verify owner
 *   GITHUB_REPO           optional — defaults to the Vercel-injected repo
 */
const MAX_ATTEMPTS = 4

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' })
  }

  const cfg = requireConfig()
  if (!cfg.ok) return res.status(500).json({ ok: false, reason: cfg.reason })

  const auth = requireOwner(req)
  if (!auth.ok) return res.status(auth.status).json({ ok: false, reason: auth.reason })

  const body = parseBody(req)
  if (!body || typeof body.snapshot !== 'object' || !body.snapshot) {
    return res.status(400).json({ ok: false, reason: 'invalid_snapshot' })
  }

  const token = process.env.GITHUB_TOKEN
  const encKey = process.env.DATA_ENCRYPTION_KEY
  const repo = getRepo()
  const branch = getDataBranch()
  const path = getBundlePath()
  const defaultBranch = getDefaultBranch()
  const incoming = body.snapshot

  try {
    await ghEnsureBranch(repo, token, branch, defaultBranch)

    // Optimistic concurrency: re-read + re-merge on every attempt so a
    // sha conflict from a concurrent writer just retries against the
    // latest state rather than clobbering it.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const file = await ghGetFile(repo, token, path, branch)
      const stored = file?.json ? decryptJson(file.json, encKey) : null
      const merged = mergeBundles(stored, incoming)
      const envelope = encryptJson(merged, encKey)
      const count = Array.isArray(merged.investments) ? merged.investments.length : 0

      const putRes = await ghPutFile(
        repo,
        token,
        path,
        branch,
        envelope,
        file?.sha,
        `chore(data): sync bundle (${count} records)`,
      )

      if (putRes.ok) {
        return res.status(200).json({ ok: true, count, updated_at: envelope.updated_at })
      }
      // 409/422 — the file sha moved under us; loop and re-merge.
      if (putRes.status === 409 || putRes.status === 422) continue

      const detail = await putRes.text().catch(() => '')
      return res.status(502).json({
        ok: false,
        reason: 'github_put_failed',
        status: putRes.status,
        detail: detail.slice(0, 200),
      })
    }

    return res.status(409).json({ ok: false, reason: 'conflict_retry_exhausted' })
  } catch (err) {
    return res.status(502).json({
      ok: false,
      reason: 'github_error',
      detail: String(err?.message || err).slice(0, 200),
    })
  }
}
