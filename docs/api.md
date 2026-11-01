# API overview

The REST API is versioned at `/api/v1`; Swagger is served at `/docs`.

## Authentication

- `POST /auth/register` — create a resident account (`email`, `password`, `displayName`).
- `POST /auth/login` — return a 15-minute bearer access token.
- `POST /auth/logout` — client-side token discard; access tokens remain usable until expiry.
- `GET /auth/me` — return the authenticated account and server-assigned roles.

Registration always grants only `RESIDENT`. Administrative role grants are audited.

## Reports and workflow

- `POST /reports` — authenticated resident creates a report.
- `GET /reports?category=ROAD&status=NEW&page=1&pageSize=20&search=street` — public paginated explorer.
- `GET /reports/:reportId` — public report projection without reporter identity or stored coordinates.
- `GET /reports/:reportId/history` — public append-only status history and record digests.
- `POST /reports/:reportId/status` — authorized transition with `status`, `reason`, and optional `evidenceIds`.
- `POST /reports/:reportId/assignments` — administrator assigns a verified organization.
- `POST /reports/:reportId/anchor` — administrator anchors a case, status-history record, or evidence manifest using the configured registry. The contract address and transaction payload are server-controlled.
- `GET /reports/:reportId/blockchain` — public transaction processing/confirmation history.
- `GET /reports/:reportId/integrity` — compare persisted commitments to the configured registry; explicitly reports `NOT_CONFIGURED` when no registry is set.

Possible transitions are checked server-side; callers cannot set the report status with a general update operation.

## Evidence

- `POST /reports/:reportId/evidence` — multipart field `file`; JPEG, PNG, and WebP only.
- `POST /reports/:reportId/evidence` may include multipart `evidenceType=REPAIR` for an assigned organization member.
- `GET /reports/:reportId/evidence` — authenticated, privacy-restricted metadata.
- `GET /evidence/:evidenceId` — authenticated download.
- `POST /evidence/:evidenceId/verify-integrity` — compare the stored file's exact bytes to the recorded SHA-256.

Evidence bytes are stored in the API's private local directory during development. A production deployment must replace this with private object storage and expiring signed access.

## Organizations and administration

- `GET /organizations` — publicly list verified organizations.
- `POST /organizations` — administrator creates an organization.
- `PATCH /organizations/:organizationId/verification` — administrator changes verification status.
- `POST /organizations/:organizationId/members` — administrator adds a representative.
- `POST /admin/users/:userId/roles` — administrator grants a role.
- `GET /admin/audit-events` — administrator reads paginated operational events.
- `GET /admin/blockchain-transactions` — administrator reviews transaction status and failure categories.
- `POST /admin/blockchain-transactions/:transactionId/retry` — retry a failed write or confirm an already-submitted transaction.

All authenticated endpoints use `Authorization: Bearer <accessToken>`. Requests are validated and errors use a consistent JSON envelope. The API does not expose private storage keys.
