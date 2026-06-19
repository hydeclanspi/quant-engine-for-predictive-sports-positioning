# Vercel Serverless API · `/api/unlock`

This folder contains the password-verification endpoint that gates the
**Preview → Full** display-mode flip in the DuGou UI. Vercel
automatically picks up any file under `api/` at the project root and
deploys it as a serverless function — no extra config required.

## Endpoint

```
POST /api/unlock
Content-Type: application/json

{ "password": "<the shared unlock password>" }
```

### Successful response

```json
{
  "ok": true,
  "token": "<HS256-signed JWT>",
  "expSeconds": 1735603200,
  "ttlHours": 12
}
```

The frontend stores `token` in `sessionStorage` (key:
`dugou.preview_unlock_token.v1`) and uses it to flag the session as
`FULL_MODE`. When the visitor closes the tab the token is lost and the
site reverts to preview on the next visit.

### Failure responses

| Status | `reason`                | When                                                      |
| -----: | ----------------------- | --------------------------------------------------------- |
| 400    | `password_required`     | Empty password                                            |
| 400    | `invalid_body`          | Malformed JSON                                            |
| 401    | `invalid_password`      | Wrong password                                            |
| 405    | `method_not_allowed`    | Anything other than POST                                  |
| 500    | `server_misconfigured`  | Missing `UNLOCK_PASSWORD` or `JWT_SECRET` env var         |
| 500    | `jwt_secret_too_short`  | `JWT_SECRET` shorter than 16 chars                        |

## Required environment variables

Set these in **Vercel project settings → Environment Variables** (apply
to both Production and Preview environments):

| Variable          | Required | Description                                                                                  |
| ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| `UNLOCK_PASSWORD` | ✅       | Plaintext shared password. Anyone who submits this string gets a token.                       |
| `JWT_SECRET`      | ✅       | Random ≥32-char string. Used to sign/verify HS256 JWTs. Rotate to invalidate all live tokens. |
| `UNLOCK_TTL_HOURS`| optional | Token lifetime in hours (default 12).                                                         |

### Generating a JWT secret

```sh
# 48-char random base64url string
openssl rand -base64 36 | tr '+/' '-_' | tr -d '='
```

### Setting via Vercel CLI

```sh
vercel env add UNLOCK_PASSWORD production
vercel env add JWT_SECRET production
```

After adding env vars, **redeploy** (Vercel won't auto-redeploy on env
changes alone): `vercel --prod` or push a new commit.

## Local development

`vite dev` does not run Vercel functions. The frontend will detect the
absent `/api/unlock` (404) and fall back to a frontend mock: any
non-empty password unlocks. If you want to test the real endpoint
locally, install Vercel CLI and run `vercel dev` instead of `vite dev`.

## Threat model

The token only gates the *visual* unlock — the demo data store lives
entirely on the visitor's own browser, so no owner data lives behind
the JWT. The endpoint exists to keep the proprietary parameter naming
out of casual recruiters' first-glance view, not to protect financial
data. Constant-time comparison is used to prevent password-length
leaks via response timing.

---

# Git-as-sync · `/api/commit-bundle` + `/api/bundle`

The **live** cross-device snapshot syncs through git instead of Supabase.
(Time Machine snapshots still use Supabase — see `src/lib/cloudSync.js`.)
Client side lives in `src/lib/gitSync.js`; the live-sync entry points in
`src/lib/localData.js` (`bootstrapCloudSnapshotOnLoad`, `runCloudSyncNow`,
`pullCloudSnapshotNow`) are wired to these endpoints.

## How it works

```
owner edits (any device, FULL mode)
  → debounced/threshold trigger (gitSync.scheduleGitCommit)
  → POST /api/commit-bundle  { snapshot }   (Bearer = unlock JWT)
  → server: read data branch → decrypt → union-merge → encrypt → commit
  → other devices: GET /api/bundle on load / on unlock → decrypt → merge
```

- The snapshot is stored **AES-256-GCM encrypted** at
  `data/liveBundle.enc.json` on a dedicated **`data` branch**. The repo is
  public, so the ciphertext is world-readable but the plaintext bet log
  never is. Only a request bearing a valid **FULL-scope JWT** gets the
  decrypted data back from `/api/bundle`.
- The `data` branch is excluded from Vercel deploys (`vercel.json` →
  `git.deploymentEnabled.data = false`), so data commits **don't trigger
  redeploys or burn build minutes**. Reads are always live from GitHub.
- The branch + file are **created on first write** — no manual git setup.
- Writes **union-merge** server-side (incoming wins per record id, but
  nothing already stored is ever dropped), with blob-SHA optimistic
  locking + retry. Two devices committing at once can't lose each other's
  records — strictly safer than the old last-write-wins upsert.

## Endpoints

| Method | Route                 | Auth                | Purpose                          |
| ------ | --------------------- | ------------------- | -------------------------------- |
| POST   | `/api/commit-bundle`  | Bearer full JWT     | Union-merge + commit a snapshot  |
| GET    | `/api/bundle`         | Bearer full JWT     | Return latest decrypted snapshot |

## Required environment variables (Vercel project settings)

| Variable              | Required | Description                                                                  |
| --------------------- | -------- | ---------------------------------------------------------------------------- |
| `GITHUB_TOKEN`        | ✅       | Fine-grained PAT, **Contents: Read and write** on this repo only.            |
| `DATA_ENCRYPTION_KEY` | ✅       | Any random string (hashed to the AES-256 key). Rotating it orphans old data. |
| `JWT_SECRET`          | ✅       | Already set for `/api/unlock` — reused to verify the owner token.            |
| `GITHUB_REPO`         | optional | `owner/repo`. Defaults to the Vercel-injected repo, so usually unneeded.     |
| `GITHUB_DATA_BRANCH`  | optional | Defaults to `data`.                                                          |
| `GITHUB_BUNDLE_PATH`  | optional | Defaults to `data/liveBundle.enc.json`.                                      |

### One-time setup

1. Create a fine-grained PAT at GitHub → Settings → Developer settings →
   Fine-grained tokens. Repository access = **only this repo**, Permissions
   → **Contents: Read and write**. Copy the token.
2. Vercel → project → Settings → Environment Variables (Production): add
   `GITHUB_TOKEN` and `DATA_ENCRYPTION_KEY` (e.g. `openssl rand -base64 36`).
   `JWT_SECRET` is already there.
3. Redeploy (env changes don't auto-redeploy).

## Caveats

- **Hard deletes don't propagate.** Union-merge never drops a stored
  record, so removing a bet on one device won't remove it elsewhere — it
  reappears on next sync. Use **archive** (`is_archived`) instead, which
  syncs cleanly. (Safer failure mode: data resurrected, never lost.)
- **Key rotation** orphans the existing encrypted bundle — `/api/bundle`
  returns `decrypt_failed` and the next commit re-seeds from local data.
- `vite dev` doesn't run these functions; `gitSync` detects the 404 and
  silently disables for the session (local data still works).
