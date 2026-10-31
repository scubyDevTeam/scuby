# Staging Rollout — What the Sandbox Leaves Undone

> Checklist for building staging (phase I of [backend-plan.md](backend-plan.md)). Written
> 2026-10-30. The infrastructure itself is decided in [infra.md](infra.md); this doc only lists
> the gaps between it and the Terraform proven so far.

## Where this comes from

The Terraform modules in `infra/terraform/modules/` were proven by the **sandbox**
(`infra/terraform/envs/sandbox`, [infra.md](infra.md) · Environments): applied in a test AWS
account, smoke-tested end to end and destroyed in the same run (2026-10-29). The sandbox takes
shortcuts that are fine for a throwaway environment and wrong for one that holds data. Each row
below is one of them, or a piece the sandbox did not need. Staging composes the same modules in
`envs/staging`; it must not copy the sandbox's settings blindly.

An item is done when staging has it and the row is deleted, in the same PR. When this table is
empty, delete this doc and its links.

## Backend settings a deployed profile requires

The backend refuses to start on `staging` or `prod` without these (the list lives in
`ProfileStartupTest.REQUIRED`; [backend.md](backend.md) · Security). Staging must supply each one;
the sandbox supplies them from `infra/compose/sandbox/compose.yaml` and `sandbox-deploy.sh`.

| Environment variable | Property | Where staging gets it | Sandbox value |
|---|---|---|---|
| `SCUBY_WEB_ALLOWED_ORIGINS` | `scuby.web.allowed-origins` | The web app's public origin(s); not a secret | The API's CloudFront URL (`api_url` output); there is no web client |
| `SCUBY_AUTH_CODE_HASH_KEY` | `scuby.auth.code-hash-key` | SSM `/scuby/<env>/auth/code-hash-key`, 32+ characters, a secret ([infra.md](infra.md) · Secrets) | Created by the deploy script if missing |
| `SCUBY_AUTH_GOOGLE_CLIENT_ID` | `scuby.auth.google.client-id` | The web client's Google OAuth client ID; not a secret | Placeholder `sandbox-placeholder.apps.googleusercontent.com`: the sandbox never tests Google sign-in |
| `SCUBY_MEDIA_BUCKET` | `scuby.media.bucket` | `media_bucket` Terraform output | Same |
| `SCUBY_MEDIA_REGION` | `scuby.media.region` | The media bucket's region | `us-east-1` |
| `SCUBY_MEDIA_PUBLIC_BASE_URL` | `scuby.media.public-base-url` | `image_url` Terraform output (the image distribution) | Same |

## Checklist

| Area | Gap today | Staging does | Step |
|---|---|---|---|
| CI | No workflow runs on `infra/`. Provider lock files only carry macOS hashes | A workflow runs the media Lambda tests and `terraform fmt` / `validate` / `plan` on PRs touching `infra/`. Lock files gain `terraform providers lock -platform=linux_amd64` | I.1 |
| GitHub OIDC | The module creates the account's GitHub OIDC provider, and an account holds only one | Make the provider optional, or read it as data, if staging and production share an account. The deploy role's trust `sub` changes if the job uses a GitHub `environment` | I.1 |
| Data that deletes itself | The sandbox opts into `force_destroy` (media bucket) and `force_delete` (ECR); the modules default to keeping data | Keep the module defaults, and add `prevent_destroy` on the media bucket (the only copy of every master photo) and on the Postgres data volume | I.2 · I.5 |
| Instance permissions | `AmazonSSMManagedInstanceCore` grants `ssm:GetParameter(s)` on every parameter in the account | Replace it with a custom core policy; the instance reads only its own prefix | I.2 |
| Origin address | CloudFront's origin is the instance's public DNS name, which changes on stop/start | An Elastic IP | I.2 · I.3 |
| Snapshots | DLM snapshots carry `Project=scuby` and survive `terraform destroy` | Expected for staging; whoever tears an environment down deletes them on purpose | I.2 |
| Secrets at start-up | The sandbox's deploy script writes the database password into a `.env` on the instance | The backend imports its SSM prefix at start-up with the instance role ([infra.md](infra.md) · Secrets); the `.env` goes away. The New Relic license key is one more parameter under the prefix | I.2 · I.4 |
| Origin secret | CloudFront sends a secret origin header the backend never checks, and the secret sits in the Terraform state (`random_password`; distribution headers are read back on refresh) | Decide: keep the header (the state bucket is encrypted and only deployers read it), with the backend reading the value from SSM and rejecting requests without it; or drop it for CloudFront VPC origins ([infra.md](infra.md) · Edge) | I.3 |
| Certificate | ACM DNS validation has no timeout | Set one, so a stuck validation fails the apply instead of hanging it | I.3 |
| Price class | Both distributions use `PriceClass_100`, which leaves out South American edge locations | Decide consciously for a Colombia-first product, with the cost in [costs.md](costs.md) | I.3 · I.5 |
| Lambdas | No reserved concurrency; default async retries | Reserved concurrency and async retry settings on the ingest and transform Lambdas | I.5 |
| Image cache | Raw `Accept` headers fragment the image cache | A CloudFront Function normalizes `Accept` to the variants served (AVIF, WebP, JPEG) | I.5 |
| CORS | `*` on the S3 upload rule and on the image distribution (`Managed-SimpleCORS`) | Restricted to the app's origin | I.5 |
