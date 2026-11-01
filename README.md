# CivicFix

CivicFix is a civic infrastructure reporting MVP designed to distinguish resident claims, reviewer decisions, organization repair claims, and independent verification. PostgreSQL is the operational database; the EVM registry is an integrity and audit layer only.

## Repository plan and current scope

This project is intentionally isolated from the other workspace repositories. Work is organized in these phases:

1. Establish the monorepo, local services, shared validation, and architecture.
2. Implement a versioned API with authentication, privacy-aware reports, server-side workflow validation, and evidence integrity.
3. Implement and test a minimal access-controlled audit registry.
4. Connect an accessible web interface to the API.
5. Run checks and document tested behavior and limitations.

## Prerequisites

- Node.js 20.19+ (Node.js 24 is also supported by the selected toolchain)
- npm 10+
- Docker Compose

## Setup

```sh
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The API is served on `http://localhost:4000/api/v1`; the web app is served on `http://localhost:3000`. Local credentials and test data must be synthetic. Never use these development settings in production.

Set a unique `SEED_ADMIN_PASSWORD` in `.env` before seeding. To use the local registry, start `npm run contracts:node` in a separate terminal, deploy with `npm run contracts:deploy:local`, and copy the displayed contract address to `REGISTRY_CONTRACT_ADDRESS`. Use a funded local Hardhat account for `ANCHOR_PRIVATE_KEY`; never use a personal or production wallet key. Blockchain actions remain explicitly unavailable until these values are configured.

## Commands

```sh
npm test
npm run typecheck
npm run build
npm run contracts:test
```

## Configuration and integrations

See [.env.example](./.env.example). PostgreSQL is required for application persistence. Redis is included for future background work but is not currently used as a queue. The API's local evidence adapter is for development only. A local Hardhat node is used for blockchain integration; no paid service or public testnet is required for the local workflow.

## Security and deployment limitations

Do not put personal information or evidence on-chain. Public coordinates are approximate; exact coordinates and evidence must be access-controlled. Passwords must be stored as strong password hashes. Local evidence storage, authentication configuration, and synchronous blockchain transaction handling require security review before deployment. Manual retries are available, but automatic queue processing and chain-reorganization monitoring are not implemented. An MVP is not production-ready without privacy review, monitoring, backup/recovery procedures, managed secrets, and an independent smart-contract audit.
