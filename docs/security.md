# Security and privacy notes

## Trust boundaries

- PostgreSQL is the operational source of truth.
- Public report projections omit reporter identity and stored latitude/longitude.
- Evidence is private and served only to the reporter, uploader, or authorized reviewer/verifier/administrator.
- Role claims are created by the server; registration cannot select a role.
- Status transitions, assignment, and organization membership are checked in the API and recorded with an audit digest.
- The registry stores commitments only. It does not establish that a report or repair is truthful.

## Current safeguards

- Passwords use bcrypt with a work factor of 12.
- Bearer JWTs expire after 15 minutes; the web client keeps them in session storage.
- Authentication routes have an 8-request-per-minute throttle, and the API has a global request throttle.
- Helmet is enabled, CORS is restricted to the configured web origin, and JSON request bodies are validated with Zod.
- Evidence accepts JPEG, PNG, and WebP after a file-signature check, is limited to 10 MiB by default, stored under a random non-user-controlled key, and written with private file permissions.
- SHA-256 evidence hashes are calculated from the exact uploaded bytes. Manifest fields are serialized with sorted object keys before hashing.
- On-chain writes use only the configured contract and an environment-provided relayer key. A database uniqueness key and contract-level duplicate guards prevent duplicate case/evidence/status commitments.
- Sensitive administrator role, organization, and workflow actions are audit logged.

## Limitations before deployment

Local disk evidence storage, a single signing secret, and the in-process API are development choices. Production requires secure secret storage/rotation, managed private object storage, malware scanning, backup/restore testing, stronger operational monitoring, account recovery and token revocation, privacy/legal review, and an independent contract audit. Exact location is stored only when supplied, but there is currently no privileged endpoint for reading it. Blockchain submission is synchronous; no transaction worker, reorg monitor, or automatic RPC retry process is part of the current MVP.

Never put personal data, secrets, file URLs, or user wallet credentials on-chain. Do not rely on a transaction or hash as proof that submitted content is true.
