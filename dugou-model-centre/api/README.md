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
