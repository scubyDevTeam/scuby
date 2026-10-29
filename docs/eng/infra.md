# Infra — Where the Backend Runs

> Infrastructure doc. Decided 2026-10-23. Decision log rows:
> [00 · #31 (infra), #32 (media)](../product/00-product-map.md). The application itself:
> [backend.md](backend.md). Monthly spend: [costs.md](costs.md). The client is hosted on Vercel
> and is out of scope here ([frontend.md](frontend.md)).

## The decision in one line

**AWS, all of it in Terraform: one EC2 running the backend in Docker, CloudFront in front of
everything, managed services for the rest.** Staging keeps Postgres on the same EC2; production
moves it to RDS before real users arrive.

**Why:** the backend engineers know AWS; a new account's credits cover the first months; and every
piece besides the EC2 and the database (SQS, S3, CloudFront, Lambda, ACM) costs ~$0 at launch
volume while needing no operation from us.

## Topology

```
                         Route 53 (DNS)   ACM (certificates)
                                │
             ┌──────────────────┴───────────────────┐
             ▼                                      ▼
   CloudFront `api.<domain>`              CloudFront `img.<domain>`
   no caching, forwards all               variants cached at the edge
             │                                      │ cache miss
             ▼                                      ▼
   EC2 t4g.small (ARM64)                  Lambda (Node + sharp), Function URL
   Docker Compose:                                  │
     backend (api + worker roles)                   ▼
     postgres (staging only)              S3 `media` bucket ◀── ingest Lambda ◀── S3 `incoming/`
             │                                                                        ▲
             ├──▶ SQS `notifications` (+ DLQ)                       presigned PUT from the client
             ├──▶ RDS Postgres (production)
             └──▶ Twilio · Resend · Web Push · Google (outbound)
```

## Account

A **new AWS account**. New accounts get credits ($100 at sign-up, up to $200) on a *Free Plan*
that **closes after 6 months or when credits run out**. Move the account to the *Paid Plan* before
then; unused credits keep applying. AWS Budgets alarms from day one ([costs.md](costs.md)).

## Environments

| | Staging | Production |
|---|---|---|
| Purpose | Testing functionality end to end; the client's e2e suite runs against it | Real users |
| Compute | EC2 `t4g.small` (2 GB, ARM64), Docker Compose | Same |
| Database | **Postgres in Docker on the EC2**, data on a dedicated EBS volume, DLM snapshots | **RDS `db.t4g.micro`**, automated backups |
| When | Now | **Before the first real users** — a step of the launch phase in [backend-plan.md](backend-plan.md) |

Moving staging data to RDS, if any is worth keeping, is `pg_dump` / `pg_restore`; the application
only changes its connection settings.

**Sandbox.** A throwaway environment in a separate test AWS account
(`infra/terraform/envs/sandbox`, local state): applied, smoke-tested end to end and destroyed in the
same run, to prove the Terraform before staging exists. It uses the CloudFront default domains, so
it needs no domain. How to run it: `infra/README.md`.

## Edge: CloudFront, ACM, Route 53

- **TLS lives at CloudFront.** ACM certificates are free but attach only to CloudFront, load
  balancers or API Gateway — never to an EC2. So no web server on the instance terminates TLS.
- **`api.<domain>`**: a distribution with caching disabled, forwarding all headers, cookies and
  query strings. The session cookie is set on this same-site subdomain (decision #37).
- **The origin is closed to everything but CloudFront**: the EC2 security group admits only AWS's
  managed prefix list for CloudFront origin-facing addresses, and the backend rejects requests
  without a secret origin header.
- **Trade-off accepted for launch:** CloudFront → EC2 is plain HTTP. Encrypting that hop later means
  CloudFront VPC origins with the instance in a private subnet — which then needs a NAT for outbound
  calls (a managed NAT gateway is ~$32/month). Revisit when the cost is worth it.
- **Route 53** hosts the zone ($0.50/month).

## Compute

- One EC2 in a public subnet (it needs outbound internet for Twilio, Resend, Web Push, Google),
  with a public IPv4 address. Inbound restricted as above.
- **No SSH.** Access and deploys through **SSM** (Session Manager, Run Command); the instance role
  carries the permissions it needs.
- Docker Compose runs the backend image (and Postgres, in staging). The JVM is tuned for the
  instance's RAM.
- **Memory budget on the 2 GB instance:** the backend container is capped at 1 GB (`mem_limit`, so
  the JVM's `MaxRAMPercentage=60` sizes the heap from that) and Postgres at 512 MB; the rest is the
  OS and Docker.

## Database

- **PostgreSQL 17 + PostGIS.** `pgvector` joins when photo matching needs it ([O7](../open-items.md)), not before.
- **A project-built image** for staging, CI and local development:
  `FROM postgres:17` + `postgresql-17-postgis-3` from the PGDG
  repository, which publishes ARM64 builds. The official `postgis/postgis` images are amd64-only,
  which breaks both the `t4g` instance and Testcontainers on Apple-silicon laptops. If an extension
  is unavailable for 17, Postgres 16 is the tested fallback.
- **Production on RDS**, which supports PostGIS and pgvector natively; backups are RDS's.
- **Backups in staging:** DLM snapshots of the data volume. Before production: a restore performed
  once end to end — a backup never restored is not a backup.

## Queues

**SQS Standard**, one queue per kind of work, each with a dead-letter queue. First queue:
`notifications`. SQS has 1M requests/month free permanently (every call counts, including empty
long polls). Locally and in CI: ElasticMQ. How messages get there: [outbox-relay.md](outbox-relay.md).

## Media (closes O10)

The pipeline's rules — what the device does, what the server repeats, variants, visibility,
retention — are in [media-pipeline.md](media-pipeline.md). This is how AWS implements them:

| Pipeline step | AWS |
|---|---|
| Upload | The backend issues a **presigned S3 PUT URL**, scoped to the photo's purpose and to who asks ([api.md](api.md) · Uploads), into `incoming/`. The URL is signed with the photo's **SHA-256** (`x-amz-checksum-sha256`), so S3 rejects bytes that do not match the declared hash |
| Server-side safety steps (validate, strip EXIF, re-encode to the JPEG master) | **Ingest Lambda** on the S3 upload event: writes `media/{sha256}.jpg`, removes the `incoming/` object. Heavy image work never runs in the JVM |
| Variants on demand, AVIF → WebP → JPEG | **CloudFront `img.<domain>` → Lambda (Node + sharp) via Function URL** on cache miss; results cached at the edge |
| Restricted images (claim proof, orphan sightings) | **CloudFront signed URLs**, short TTL, issued by the backend to the viewer allowed to see them |
| CORS for the poster canvas | Response headers on the image distribution |
| `og` variant | Plain cover crop in v1. Status text composited on the image («YA ESTÁ EN CASA», [10](../product/10-sharing.md)) is later |

Not built yet: restricted images (claim proofs, orphan sightings) still need a visibility in the
upload key and CloudFront signed URLs; until then every master is reachable through `/img/…`. It
arrives with the backend's upload slots, which know each photo's purpose.

## Secrets

- **SSM Parameter Store, `SecureString`, one parameter per value**, under `/scuby/{env}/…`. The
  backend imports its environment's prefix at start-up with the instance role (Spring Cloud AWS
  Parameter Store support, or a small loader on the AWS SDK if that integration lags Spring Boot).
- One parameter per value — not one JSON blob — so a value changes alone, permissions and history
  are per value, and no size limit is hit. Standard parameters are free.
- **Never in the image, never at build time.** The same image runs in every environment.
- **Terraform creates each parameter with a placeholder and ignores later value changes**
  (`lifecycle { ignore_changes = [value] }`); a person sets the real value through the CLI or
  console. Terraform state stores values in plain text, so real secrets never pass through it.

## Infrastructure as code

- **Terraform** for every resource; nothing created by hand except the account itself and the
  secret values above.
- State in an S3 bucket with S3-native locking (no DynamoDB table).
- `terraform plan` runs on every pull request touching `infra/`; `apply` is run manually.

## CI/CD

- **GitHub Actions**, a backend workflow beside the client's `web.yml`, triggered by path filters.
- **OIDC from GitHub to AWS** — no stored AWS keys.
- Build and test; Jib builds the ARM64 image and pushes it to **ECR**.
- Deploy: SSM Run Command on the instance pulls the new image and restarts the Compose service.
  Flyway migrates at application start-up.

## Rejected

| Decision | Rejected & why |
|---|---|
| One EC2 with Compose | **Several micro instances in a VPC** — on the old free tier the 750 free hours are per account, not per instance, and under credits every instance spends them; adds networking and discovery for no gain. **ECS Fargate / App Runner** — higher floor cost for one service |
| CloudFront + ACM for TLS | **Caddy / Let's Encrypt on the instance** — works, but CloudFront is needed for media anyway and adds managed TLS and DDoS protection. **Application Load Balancer** — ~$16+/month for one instance |
| Postgres on the EC2 for staging | **RDS from day one** — ~$15/month before there is anything to protect |
| Lambda for image transforms | **Transforms in the JVM** — CPU and memory spikes on the API's instance. **A paid image service** (Cloudflare Images, imgproxy hosted) — a second vendor for what the AWS free tier covers |
| Parameter Store | **Secrets Manager** — $0.40/secret/month for rotation we do not need yet. **Secrets injected at build** — leaks them into the image and ties an image to one environment |
