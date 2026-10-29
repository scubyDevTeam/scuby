# Infra Sandbox (Track B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the Terraform and the media Lambdas that implement `docs/eng/infra.md`, apply them to a throwaway AWS test account, prove the whole chain works end to end (backend on EC2 behind CloudFront, photo upload → master → variant, SQS), then destroy everything and prove nothing is left.

**Architecture:** Reusable Terraform modules under `infra/terraform/modules/`, composed by one environment, `infra/terraform/envs/sandbox/` (local state, applied then destroyed in the same run). The media Lambdas are one Node package (`infra/lambda/media/`) with two handlers sharing a small library, built for linux-arm64. Shell scripts in `infra/scripts/` deploy the backend onto the EC2 through SSM, run the smoke tests, and sweep the account for leftovers. Route 53/ACM and the remote state bucket are written and validated but **not applied** (no domain yet; sandbox uses the `*.cloudfront.net` domains).

**Tech Stack:** Terraform ≥ 1.15 (AWS provider ~> 6.71, archive ~> 2.8, random ~> 3.9), AWS CLI v2, Node 22+ (local Node 24; Lambda runtime `nodejs22.x`, arm64), sharp 0.35.5, AWS SDK for JS v3 3.1159.0, Docker, the existing Maven backend (Jib).

## Global Constraints

- Read first: `docs/eng/infra.md` (whole), `docs/eng/media-pipeline.md` §1–§4, `docs/eng/backend.md` · Configuration. Docs win on behaviour; if this plan and a doc disagree, record it in the run report and follow the doc unless that would leave resources behind.
- **AWS identity — every `aws` and `terraform` command:** `export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1` first. Account `590765348638`. **Never** use any other profile (e.g. `dvora`, `default`).
- **Never touch pre-existing resources:** the default VPC `vpc-9d15b4e0` and the S3 bucket `wc2026-tfstate-itslauyalejo` belong to something else. Nothing in this plan may create, modify or delete them. Only delete resources tagged `Project=scuby` or created by this plan's Terraform state.
- **Tags:** every taggable resource carries `Project=scuby`, `Env=sandbox`, `ManagedBy=terraform` (provider `default_tags`). Resource names start with `scuby-sandbox`.
- **Session gates.** The SSO session lasts 8 hours from the human's login; the cached access token refreshes itself hourly, so its `expiresAt` is NOT the session end. Before sleeping, the human runs `aws sso login --profile itslauyalejo-sso && date -u +%s > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/sso-login`. `infra/scripts/sso-remaining.sh` prints `login + 480 min − now`, and `0` if that file is missing or `aws sts get-caller-identity` fails (fail closed).
  - **G1:** must print **≥ 150** before Task 6 runs `terraform apply`. If not: do **not** apply; skip Tasks 6–8; finish Task 9 and report.
  - **G2:** must print **≥ 90** before Task 7 starts. If not: go straight to Task 8.
  - **Retry invariant:** before ANY retry or fix loop in Tasks 6–7, check `sso-remaining.sh`; if **≤ 50**, stop and go to Task 8 now.
  - **Teardown is mandatory:** once Task 6 has started `terraform apply` — success or failure — Task 8 runs next, regardless of anything else. A detached **watchdog** started in Task 6 runs the destroy by itself at the session deadline in case the controller stops.
- **Long-running commands never run in the foreground** (the agent's Bash tool kills commands after a few minutes, and a kill during a CloudFront wait leaves resources outside the state). `terraform apply`, `terraform destroy`, `sandbox-build.sh`, `sandbox-deploy.sh`, `sandbox-smoke.sh` and `sandbox-destroy.sh` run as `nohup bash <script> > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/<name>.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/<name>.exit` launched in the background (`run_in_background`), and are waited on by watching for the `.exit` file (Monitor), never with `sleep` in the foreground.
- **Shell:** the agents' shell is zsh. Run scripts with `bash <script>`; never paste lines from the scripts into the shell.
- **Deleting things:** only Terraform (`terraform destroy`, via `sandbox-destroy.sh`) deletes. **Never** `terraform import`, never manual `aws … delete-*` calls. If the sweep still reports leftovers after `sandbox-destroy.sh` has been re-run, write the exact cleanup commands into the run report for the human instead of running them.
- **Never** `git push`, open PRs, or change files outside `infra/`, `docs/eng/infra.md`, `docs/eng/media-pipeline.md` (Task 9's HEIC correction only), `docs/superpowers/plans/`, the root `.gitignore`, and `README.md`'s infra row.
- Terraform state is **local** (`infra/terraform/envs/sandbox/terraform.tfstate`) and **git-ignored** — it contains secrets. Commit `.terraform.lock.hcl`.
- Commit prefixes: `feat:` (infra code), `test:`, `doc:`, `ci:`, `fix:` — one kind per commit where it can be split.
- Java builds (Task 6, building the backend image): `export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH` and run Maven from `backend/`.
- Write files with absolute paths under `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo`. Branch `infra/b1-sandbox` (already created from `main`).
- **Stuck rule:** if a step fails 3 times after honest fixes, stop that task, record it, and continue — but the teardown rule above always holds.
- Run report (outside the repo): `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/infra-sandbox-report.md`.

## File map

```
.gitignore                                   (root) Terraform state, .terraform/, Lambda build output
infra/
  README.md                                  Spanish: what is here, how to run the sandbox
  scripts/
    sso-remaining.sh                         minutes left on the SSO token
    sweep.sh                                 lists anything of ours left in the account; exit 1 if any
    sandbox-build.sh                         build the backend and Postgres images locally (before apply)
    sandbox-deploy.sh                        push images to ECR, start backend+postgres on the EC2 via SSM
    sandbox-smoke.sh                         end-to-end checks against the applied sandbox
    sandbox-destroy.sh                       terraform destroy + sweep
    sandbox-watchdog.sh                      detached: runs sandbox-destroy.sh at the session deadline
  compose/sandbox/compose.yaml               what runs on the EC2
  lambda/media/
    package.json, package-lock.json
    lib/variants.mjs                         variant table, path parsing, format choice, rendering
    lib/master.mjs                           validate + normalize an upload into the JPEG master
    ingest.mjs                               S3 incoming/ → media/{sha256}.jpg
    transform.mjs                            Function URL: /img/{sha256}/{variant} → image
    test/variants.test.mjs, test/master.test.mjs, test/handlers.test.mjs
    smoke/upload-smoke.mjs                   presigned upload + variant fetch against the sandbox
    build.sh                                 → dist/media-lambdas.zip (linux-arm64 sharp)
  terraform/
    bootstrap/                               remote-state bucket (validated, never applied here)
    modules/network/  modules/registry/  modules/queues/  modules/params/
    modules/media/    modules/compute/   modules/edge_api/ modules/github_oidc/  modules/dns/
    envs/sandbox/                            versions.tf, variables.tf, main.tf, outputs.tf
```

---

### Task 0: Guards — session timer and leftover sweep

**Files:**
- Create: `.gitignore` (root), `infra/scripts/sso-remaining.sh`, `infra/scripts/sweep.sh`

**Interfaces:**
- Produces: `infra/scripts/sso-remaining.sh` → prints an integer (minutes until the SSO token expires; `0` if expired/unknown), exit 0. `infra/scripts/sweep.sh` → prints every leftover it finds, exit 0 if none, exit 1 otherwise.

- [ ] **Step 1: Root `.gitignore`**

```gitignore
# Terraform: local state holds secrets; provider cache is downloaded
infra/terraform/**/.terraform/
infra/terraform/**/*.tfstate
infra/terraform/**/*.tfstate.*
infra/terraform/**/*.tfplan
infra/terraform/**/.terraform.tfstate.lock.info
infra/terraform/**/crash.log
# Media Lambdas build output
infra/lambda/media/node_modules/
infra/lambda/media/build/
infra/lambda/media/dist/
```

- [ ] **Step 2: `infra/scripts/sso-remaining.sh`**

```bash
#!/usr/bin/env bash
# Minutes left in the 8-hour SSO session, counted from the login time the human recorded:
#   aws sso login --profile itslauyalejo-sso && date -u +%s > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/sso-login
# The cached access token refreshes hourly, so its expiresAt is not the session end.
# Prints 0 (fail closed) when the login file is missing or the credentials do not work.
set -uo pipefail
LOGIN_FILE="${SSO_LOGIN_FILE:-/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/sso-login}"
SESSION_MINUTES="${SSO_SESSION_MINUTES:-480}"
if [ ! -s "$LOGIN_FILE" ] || ! AWS_PROFILE=itslauyalejo-sso aws sts get-caller-identity >/dev/null 2>&1; then
  echo 0
  exit 0
fi
login=$(cat "$LOGIN_FILE")
now=$(date -u +%s)
left=$(( (login + SESSION_MINUTES * 60 - now) / 60 ))
[ "$left" -lt 0 ] && left=0
echo "$left"
```

- [ ] **Step 3: `infra/scripts/sweep.sh`**

```bash
#!/usr/bin/env bash
# Lists anything this project left in the sandbox account. Exit 1 if anything is found OR if any
# check could not run (fail closed). Pre-existing, not ours, must survive: default VPC
# vpc-9d15b4e0, bucket wc2026-tfstate-itslauyalejo.
set -uo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
found=0

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "SWEEP ERROR: credentials expired or invalid — run 'aws sso login --profile itslauyalejo-sso' and re-run"
  exit 2
fi

# check <label> <aws args...>: runs the query; an error is a failure, any output is a leftover.
check() {
  local label=$1; shift
  local out
  if ! out=$(aws "$@" 2>&1); then
    echo "SWEEP ERROR: $label — $out"; found=1; return
  fi
  if [ -n "$out" ] && [ "$out" != "None" ]; then echo "LEFTOVER $label: $out"; found=1; fi
}

check "tagged resources" resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=scuby \
  --query 'ResourceTagMappingList[].ResourceARN' --output text
check "ec2 instances" ec2 describe-instances --filters Name=tag:Project,Values=scuby \
  Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text
check "ebs volumes" ec2 describe-volumes --filters Name=tag:Project,Values=scuby --query 'Volumes[].VolumeId' --output text
check "ebs snapshots" ec2 describe-snapshots --owner-ids self --filters Name=tag:Project,Values=scuby --query 'Snapshots[].SnapshotId' --output text
check "vpcs" ec2 describe-vpcs --filters Name=tag:Project,Values=scuby --query 'Vpcs[].VpcId' --output text
check "s3 buckets" s3api list-buckets --query "Buckets[?starts_with(Name, 'scuby-')].Name" --output text
check "ecr repositories" ecr describe-repositories --query "repositories[?starts_with(repositoryName, 'scuby-')].repositoryName" --output text
check "lambda functions" lambda list-functions --query "Functions[?starts_with(FunctionName, 'scuby-')].FunctionName" --output text
check "log groups" logs describe-log-groups --log-group-name-prefix /aws/lambda/scuby- --query 'logGroups[].logGroupName' --output text
check "sqs queues" sqs list-queues --queue-name-prefix scuby- --query 'QueueUrls' --output text
check "ssm parameters" ssm get-parameters-by-path --path /scuby --recursive --query 'Parameters[].Name' --output text
check "cloudfront distributions" cloudfront list-distributions --query "DistributionList.Items[?starts_with(Comment, 'scuby')].Id" --output text
check "cloudfront origin access controls" cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?starts_with(Name, 'scuby')].Id" --output text
check "cloudfront cache policies" cloudfront list-cache-policies --type custom --query "CachePolicyList.Items[?starts_with(CachePolicy.CachePolicyConfig.Name, 'scuby')].CachePolicy.Id" --output text
check "iam roles" iam list-roles --query "Roles[?starts_with(RoleName, 'scuby-')].RoleName" --output text
check "iam instance profiles" iam list-instance-profiles --query "InstanceProfiles[?starts_with(InstanceProfileName, 'scuby-')].InstanceProfileName" --output text
check "dlm policies" dlm get-lifecycle-policies --query "Policies[?starts_with(Description, 'scuby')].PolicyId" --output text

# OIDC providers have no name to filter on: only ours carries Project=scuby.
if ! arns=$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text 2>&1); then
  echo "SWEEP ERROR: oidc providers — $arns"; found=1
else
  for arn in $arns; do
    if aws iam list-open-id-connect-provider-tags --open-id-connect-provider-arn "$arn" \
         --query "Tags[?Key=='Project' && Value=='scuby'] | length(@)" --output text | grep -qx 1; then
      echo "LEFTOVER oidc provider: $arn"; found=1
    fi
  done
fi

# The pre-existing resources must still be there.
aws ec2 describe-vpcs --vpc-ids vpc-9d15b4e0 >/dev/null 2>&1 || { echo "MISSING pre-existing default VPC vpc-9d15b4e0"; found=1; }
aws s3api head-bucket --bucket wc2026-tfstate-itslauyalejo >/dev/null 2>&1 || { echo "MISSING pre-existing bucket wc2026-tfstate-itslauyalejo"; found=1; }

[ "$found" -eq 0 ] && echo "sweep: clean"
exit "$found"
```

Note: the tagging API can keep listing a resource for a few minutes after deletion. If only "tagged resources" reports leftovers while every service-specific line is clean, wait 5 minutes and run the sweep again before calling it a leftover.

- [ ] **Step 4: Run both against the account as it is now (the baseline)**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
chmod +x infra/scripts/*.sh
bash infra/scripts/sso-remaining.sh
bash infra/scripts/sweep.sh
SSO_LOGIN_FILE=/nonexistent bash infra/scripts/sso-remaining.sh   # must print 0
```

Expected: a positive integer (if 0, the human has not recorded the login in `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/sso-login` or the session is not valid — record it and stop the plan: nothing in Tasks 2–8 can run). Then `sweep: clean`, exit 0. The third command prints `0`. If the sweep reports anything, the account is not in the baseline state — record what and stop before Task 6.

- [ ] **Step 5: Commit**

```bash
git add .gitignore infra/scripts/sso-remaining.sh infra/scripts/sweep.sh
git commit -m "feat: sandbox guards — SSO time left, and a sweep for anything left behind"
```

---

### Task 1: Media Lambdas (ingest + variants), tested locally, built for linux-arm64

**Files:**
- Create: `infra/lambda/media/package.json`, `lib/variants.mjs`, `lib/master.mjs`, `ingest.mjs`, `transform.mjs`, `test/variants.test.mjs`, `test/master.test.mjs`, `test/handlers.test.mjs`, `build.sh` (all under `infra/lambda/media/`); `package-lock.json` generated by npm.

**Interfaces:**
- Produces:
  - `lib/variants.mjs`: `VARIANTS` (`thumb|card|full|og|match` → `{width,height,fit}`), `parseImagePath(path: string) → {hash, variant} | null`, `pickFormat(accept: string) → 'avif'|'webp'|'jpeg'`, `renderVariant(master: Buffer, variant: string, format: string) → Promise<Buffer>`.
  - `lib/master.mjs`: `normalizeMaster(input: Buffer) → Promise<Buffer>` (throws `Error` with a reason for invalid input), `masterKeyFor(incomingKey: string) → string | null`.
  - `ingest.mjs`: `handler(event)` for S3 `ObjectCreated` events on `incoming/`. `transform.mjs`: `handler(event)` for Lambda Function URL (payload v2) events. Both read the bucket name from env `BUCKET`.
  - `build.sh` → `infra/lambda/media/dist/media-lambdas.zip` (handlers `ingest.handler`, `transform.handler`).
- Rules implemented (docs/eng/media-pipeline.md): master = JPEG ≤ 1600 px long edge, sRGB, orientation applied, **all metadata stripped**; reject non-images, > 10 MB, > 8000 px; key = SHA-256 hex of the uploaded bytes; variants `thumb` 240, `card` 800, `full` 1600 (long edge, never enlarged), `og` 1200×630 cover, `match` 512×512 cover sRGB; format by `Accept`: AVIF → WebP → JPEG.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "scuby-media-lambdas",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test 'test/*.test.mjs'",
    "build": "./build.sh"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1159.0",
    "sharp": "0.35.5"
  },
  "devDependencies": {
    "@aws-sdk/s3-request-presigner": "3.1159.0"
  }
}
```

Run: `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/infra/lambda/media && npm install` (creates `package-lock.json` and a macOS `node_modules` for local tests).

- [ ] **Step 2: Failing tests**

`test/variants.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseImagePath, pickFormat, renderVariant, VARIANTS } from '../lib/variants.mjs';

const HASH = 'a'.repeat(64);

test('parses a variant path', () => {
  assert.deepEqual(parseImagePath(`/img/${HASH}/card`), { hash: HASH, variant: 'card' });
});

test('rejects unknown variants, bad hashes and other paths', () => {
  assert.equal(parseImagePath(`/img/${HASH}/huge`), null);
  assert.equal(parseImagePath(`/img/${'a'.repeat(63)}/card`), null);
  assert.equal(parseImagePath(`/img/${'A'.repeat(64)}/card`), null);
  assert.equal(parseImagePath(`/other/${HASH}/card`), null);
  assert.equal(parseImagePath(`/img/${HASH}/card/extra`), null);
});

test('picks AVIF, then WebP, then JPEG from Accept', () => {
  assert.equal(pickFormat('image/avif,image/webp,*/*'), 'avif');
  assert.equal(pickFormat('image/webp,*/*'), 'webp');
  assert.equal(pickFormat('*/*'), 'jpeg');
  assert.equal(pickFormat(undefined), 'jpeg');
});

test('renders card as WebP inside 800 px and never enlarges', async () => {
  const master = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#a0522d' } }).jpeg().toBuffer();
  const out = await renderVariant(master, 'card', 'webp');
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 600);

  const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).jpeg().toBuffer();
  const thumb = await sharp(await renderVariant(small, 'thumb', 'jpeg')).metadata();
  assert.equal(thumb.width, 200);
});

test('og is exactly 1200x630', async () => {
  const master = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const meta = await sharp(await renderVariant(master, 'og', 'jpeg')).metadata();
  assert.deepEqual([meta.width, meta.height], [VARIANTS.og.width, VARIANTS.og.height]);
});
```

`test/master.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeMaster, masterKeyFor } from '../lib/master.mjs';

const HASH = 'b'.repeat(64);

test('downscales to 1600 px long edge, JPEG, without metadata', async () => {
  const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#336699' } })
    .withExif({ IFD0: { Copyright: 'owner home' } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif, 'fixture must carry EXIF');

  const out = await normalizeMaster(input);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 1067);
  assert.equal(meta.exif, undefined);
});

test('accepts PNG and keeps small images at their size', async () => {
  const input = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#00000000' } }).png().toBuffer();
  const meta = await sharp(await normalizeMaster(input)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 400, 300]);
});

test('rejects bytes that are not an image', async () => {
  await assert.rejects(normalizeMaster(Buffer.from('not an image at all')), /not an image/);
});

test('rejects more than 10 MB', async () => {
  await assert.rejects(normalizeMaster(Buffer.alloc(10 * 1024 * 1024 + 1)), /too large/);
});

test('rejects dimensions above 8000 px', async () => {
  const input = await sharp({ create: { width: 8001, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeMaster(input), /dimensions/);
});

test('maps incoming/<sha256> to media/<sha256>.jpg and nothing else', () => {
  assert.equal(masterKeyFor(`incoming/${HASH}`), `media/${HASH}.jpg`);
  assert.equal(masterKeyFor(`incoming/${HASH}.jpg`), null);
  assert.equal(masterKeyFor(`media/${HASH}.jpg`), null);
  assert.equal(masterKeyFor('incoming/short'), null);
});
```

`test/handlers.test.mjs` (handlers with an in-memory fake S3 — no AWS):

```js
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';

const HASH = 'c'.repeat(64);
const store = new Map();

mock.method(S3Client.prototype, 'send', async (cmd) => {
  const { Key } = cmd.input;
  switch (cmd.constructor.name) {
    case 'GetObjectCommand': {
      if (!store.has(Key)) { const e = new Error('missing'); e.name = 'NoSuchKey'; throw e; }
      const bytes = store.get(Key);
      return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
    }
    case 'PutObjectCommand': store.set(Key, Buffer.from(cmd.input.Body)); return {};
    case 'DeleteObjectCommand': store.delete(Key); return {};
    default: throw new Error(`unexpected ${cmd.constructor.name}`);
  }
});

process.env.BUCKET = 'test-bucket';
const { handler: ingest } = await import('../ingest.mjs');
const { handler: transform } = await import('../transform.mjs');

const s3Event = (key, size = 1000) => ({ Records: [{ s3: { bucket: { name: 'test-bucket' }, object: { key, size } } }] });

test('ingest writes the master and removes the upload', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123' } }).png().toBuffer());
  await ingest(s3Event(`incoming/${HASH}`));
  assert.ok(store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
  assert.equal((await sharp(store.get(`media/${HASH}.jpg`)).metadata()).width, 1600);
});

test('ingest drops an invalid upload without writing a master', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, Buffer.from('garbage'));
  await ingest(s3Event(`incoming/${HASH}`));
  assert.ok(!store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
});

test('ingest deletes an oversized upload without downloading it', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, Buffer.from('pretend this is 11 MB'));
  await ingest(s3Event(`incoming/${HASH}`, 11 * 1024 * 1024));
  assert.ok(!store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
});

test('transform serves a variant in the negotiated format with immutable caching', async () => {
  store.clear();
  store.set(`media/${HASH}.jpg`, await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#456' } }).jpeg().toBuffer());
  const res = await transform({ rawPath: `/img/${HASH}/thumb`, headers: { accept: 'image/webp,*/*' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(res.isBase64Encoded, true);
  assert.equal((await sharp(Buffer.from(res.body, 'base64')).metadata()).width, 240);
});

test('transform answers 404 for an unknown photo or path', async () => {
  store.clear();
  assert.equal((await transform({ rawPath: `/img/${HASH}/card`, headers: {} })).statusCode, 404);
  assert.equal((await transform({ rawPath: '/nope', headers: {} })).statusCode, 404);
});
```

- [ ] **Step 3: Run to see them fail** — `cd .../infra/lambda/media && npm test` → failures: modules `../lib/variants.mjs` etc. not found.

- [ ] **Step 4: Implementation**

`lib/variants.mjs`:

```js
// Variant table and rendering — docs/eng/media-pipeline.md §3.
import sharp from 'sharp';

export const VARIANTS = {
  thumb: { width: 240, height: 240, fit: 'inside' },
  card: { width: 800, height: 800, fit: 'inside' },
  full: { width: 1600, height: 1600, fit: 'inside' },
  og: { width: 1200, height: 630, fit: 'cover' },
  match: { width: 512, height: 512, fit: 'cover' },
};

const PATH = /^\/img\/([0-9a-f]{64})\/([a-z]+)$/;

export function parseImagePath(path) {
  const m = PATH.exec(path ?? '');
  if (!m || !Object.hasOwn(VARIANTS, m[2])) return null;
  return { hash: m[1], variant: m[2] };
}

export function pickFormat(accept = '') {
  if (/image\/avif/.test(accept ?? '')) return 'avif';
  if (/image\/webp/.test(accept ?? '')) return 'webp';
  return 'jpeg';
}

const QUALITY = { avif: 50, webp: 75, jpeg: 80 };

export async function renderVariant(master, variant, format) {
  const v = VARIANTS[variant];
  return sharp(master)
    .rotate()
    .resize({ width: v.width, height: v.height, fit: v.fit, withoutEnlargement: v.fit === 'inside' })
    .toColorspace('srgb')
    .toFormat(format, { quality: QUALITY[format] })
    .toBuffer();
}
```

`lib/master.mjs`:

```js
// The server-side safety steps of docs/eng/media-pipeline.md §1: validate, strip metadata, re-encode.
import sharp from 'sharp';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8000;
// HEIC (HEVC) is not here on purpose: prebuilt sharp decodes only AVIF through libheif, so the
// client converts iPhone photos before upload (docs/eng/media-pipeline.md §1).
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'avif']);
const INCOMING = /^incoming\/([0-9a-f]{64})$/;

export async function normalizeMaster(input) {
  if (input.length > MAX_BYTES) throw new Error('too large');
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error('not an image');
  }
  if (!ACCEPTED.has(meta.format)) throw new Error('not an image');
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) throw new Error('dimensions above 8000 px');
  // sharp drops all metadata unless asked to keep it: EXIF (GPS included) never reaches the master.
  return sharp(input)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

export function masterKeyFor(incomingKey) {
  const m = INCOMING.exec(incomingKey);
  return m ? `media/${m[1]}.jpg` : null;
}
```

`ingest.mjs`:

```js
// S3 ObjectCreated on incoming/<sha256> → media/<sha256>.jpg; the upload is always removed.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { normalizeMaster, masterKeyFor } from './lib/master.mjs';

const s3 = new S3Client({});
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const target = masterKeyFor(key);
    if (!target) {
      console.warn(JSON.stringify({ msg: 'ignored key', key }));
      continue;
    }
    // Never download an oversized object: the presigned URL does not bound the size.
    if ((record.s3.object.size ?? 0) > MAX_UPLOAD_BYTES) {
      console.warn(JSON.stringify({ msg: 'upload rejected', key, reason: 'too large' }));
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      continue;
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const input = Buffer.from(await obj.Body.transformToByteArray());
    try {
      const master = await normalizeMaster(input);
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: target, Body: master,
        ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
      }));
    } catch (e) {
      console.warn(JSON.stringify({ msg: 'upload rejected', key, reason: e.message }));
    }
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
```

`transform.mjs`:

```js
// Lambda Function URL behind CloudFront: /img/<sha256>/<variant> → the variant, format by Accept.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseImagePath, pickFormat, renderVariant } from './lib/variants.mjs';

const s3 = new S3Client({});
const notFound = { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };

export async function handler(event) {
  const parsed = parseImagePath(event.rawPath);
  if (!parsed) return notFound;
  let master;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: `media/${parsed.hash}.jpg` }));
    master = Buffer.from(await obj.Body.transformToByteArray());
  } catch (e) {
    if (e.name === 'NoSuchKey') return notFound;
    throw e;
  }
  const format = pickFormat(event.headers?.accept);
  const body = await renderVariant(master, parsed.variant, format);
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': `image/${format}`,
      'cache-control': 'public, max-age=31536000, immutable',
      vary: 'Accept',
    },
    body: body.toString('base64'),
  };
}
```

`build.sh`:

```bash
#!/usr/bin/env bash
# Packages both handlers with sharp's linux-arm64 binaries → dist/media-lambdas.zip.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build dist
mkdir -p build dist
cp package.json package-lock.json ingest.mjs transform.mjs build/
cp -R lib build/
(cd build && npm ci --omit=dev --os=linux --cpu=arm64 --libc=glibc --no-audit --no-fund)
(cd build && zip -qr ../dist/media-lambdas.zip .)
echo "built $(pwd)/dist/media-lambdas.zip"
```

- [ ] **Step 5: Run to see them pass** — `npm test` → all tests pass.

- [ ] **Step 6: Build** — `chmod +x build.sh && ./build.sh`, then confirm the Linux binary is inside: `unzip -l dist/media-lambdas.zip | grep -E 'sharp-linux-arm64|ingest.mjs|transform.mjs'` → all three present.

- [ ] **Step 7: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
git add infra/lambda/media/package.json infra/lambda/media/package-lock.json infra/lambda/media/lib \
  infra/lambda/media/ingest.mjs infra/lambda/media/transform.mjs infra/lambda/media/build.sh
git commit -m "feat: media Lambdas — the master without metadata, and variants negotiated by Accept"
git add infra/lambda/media/test
git commit -m "test: media Lambdas — master rules, variant sizes and formats, handlers on a fake S3"
```

---

### Task 2: Terraform foundation — environment, network, registry, queues, parameters; bootstrap and DNS validated only

**Files:**
- Create: `infra/terraform/envs/sandbox/{versions.tf,variables.tf,main.tf,outputs.tf}`, `infra/terraform/modules/{network,registry,queues,params,dns}/main.tf`, `infra/terraform/bootstrap/main.tf`

**Interfaces:**
- Produces module outputs used by later tasks:
  - `network`: `vpc_id`, `public_subnet_id`, `availability_zone`
  - `registry`: `repository_urls` (map: `backend`, `postgres` → URL), `repository_arns` (list)
  - `queues`: `queue_url`, `queue_arn`, `dlq_arn`
  - `params`: `prefix` (e.g. `/scuby/sandbox`), `parameter_arns` (list)
- Env locals: `local.name = "scuby-${var.env}"`; `random_id.suffix.hex` (6 hex chars) for globally unique names.

- [ ] **Step 1: `envs/sandbox/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.71" }
    archive = { source = "hashicorp/archive", version = "~> 2.8" }
    random  = { source = "hashicorp/random", version = "~> 3.9" }
  }
  # Sandbox state is local and git-ignored: this environment is applied and destroyed in one run.
  # Staging uses the S3 backend created by ../../bootstrap (docs/eng/infra.md · Infrastructure as code).
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "scuby"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
```

- [ ] **Step 2: `envs/sandbox/variables.tf`**

```hcl
variable "region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "itslauyalejo-sso"
}

variable "env" {
  type    = string
  default = "sandbox"
}

variable "github_repo" {
  description = "owner/name allowed to assume the deploy role through GitHub OIDC"
  type        = string
  default     = "scubyDevTeam/scuby"
}

variable "domain" {
  description = "Apex domain for Route 53 + ACM. Empty = no DNS; the CloudFront default domains are used."
  type        = string
  default     = ""
}
```

- [ ] **Step 3: Modules**

`modules/network/main.tf`:

```hcl
variable "name" { type = string }
variable "cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "instance_type" {
  description = "The subnet's AZ is chosen among those that offer this type (not every AZ has t4g)"
  type        = string
  default     = "t4g.small"
}

data "aws_ec2_instance_type_offerings" "available" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name }
}

# One public subnet: the instance needs outbound internet (Twilio, Resend, Web Push) and a NAT
# gateway costs ~$32/month (docs/eng/infra.md · Edge).
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.cidr, 8, 1)
  availability_zone       = sort(data.aws_ec2_instance_type_offerings.available.locations)[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

output "vpc_id" { value = aws_vpc.this.id }
# Depends on the route association so nothing boots in the subnet before it can reach the internet.
output "public_subnet_id" {
  value      = aws_subnet.public.id
  depends_on = [aws_route_table_association.public]
}
output "availability_zone" { value = aws_subnet.public.availability_zone }
```

`modules/registry/main.tf`:

```hcl
variable "name" { type = string }
variable "repositories" { type = list(string) }

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.name}-${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the 10 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

output "repository_urls" { value = { for k, r in aws_ecr_repository.this : k => r.repository_url } }
output "repository_arns" { value = [for r in aws_ecr_repository.this : r.arn] }
```

`modules/queues/main.tf`:

```hcl
variable "name" { type = string }

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-notifications-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${var.name}-notifications"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

output "queue_url" { value = aws_sqs_queue.notifications.url }
output "queue_arn" { value = aws_sqs_queue.notifications.arn }
output "dlq_arn" { value = aws_sqs_queue.dlq.arn }
```

`modules/params/main.tf`:

```hcl
# One SecureString per secret, created with a placeholder. Terraform never sees the real value:
# a person (or the deploy script, in the sandbox) sets it with the CLI (docs/eng/infra.md · Secrets).
variable "prefix" { type = string }
variable "secret_names" { type = list(string) }

resource "aws_ssm_parameter" "secret" {
  for_each = toset(var.secret_names)
  name     = "${var.prefix}/${each.key}"
  type     = "SecureString"
  value    = "placeholder"
  lifecycle { ignore_changes = [value] }
}

output "prefix" { value = var.prefix }
output "parameter_arns" { value = [for p in aws_ssm_parameter.secret : p.arn] }
```

`modules/dns/main.tf` (validated, not applied while `domain` is empty):

```hcl
# Route 53 zone + an ACM certificate (us-east-1, as CloudFront requires) validated by DNS.
# Wiring the certificate into the distributions arrives with the domain (open item O16).
variable "domain" { type = string }

resource "aws_route53_zone" "this" { name = var.domain }

resource "aws_acm_certificate" "this" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id         = aws_route53_zone.this.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

output "zone_id" { value = aws_route53_zone.this.zone_id }
output "certificate_arn" { value = aws_acm_certificate_validation.this.certificate_arn }
```

`bootstrap/main.tf` (validated only — creates the remote-state bucket for staging/production, never in this run):

```hcl
# Run once per real account: creates the bucket that holds Terraform state for staging and
# production (S3-native locking, no DynamoDB — docs/eng/infra.md · Infrastructure as code).
terraform {
  required_version = ">= 1.15.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.71" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "bucket_name" { type = string }

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "scuby", ManagedBy = "terraform" } }
}

resource "aws_s3_bucket" "state" {
  bucket = var.bucket_name
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "bucket" { value = aws_s3_bucket.state.bucket }
```

- [ ] **Step 4: `envs/sandbox/main.tf` (foundation only; later tasks append modules)**

```hcl
locals {
  name = "scuby-${var.env}"
}

resource "random_id" "suffix" {
  byte_length = 3
}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "registry" {
  source       = "../../modules/registry"
  name         = local.name
  repositories = ["backend", "postgres"]
}

module "queues" {
  source = "../../modules/queues"
  name   = local.name
}

module "params" {
  source = "../../modules/params"
  prefix = "/scuby/${var.env}"
  secret_names = [
    "db/password",
    "twilio/auth-token",
    "resend/api-key",
    "vapid/private-key",
    "google/client-secret",
    "sentry/dsn",
  ]
}

module "dns" {
  source = "../../modules/dns"
  count  = var.domain == "" ? 0 : 1
  domain = var.domain
}
```

`envs/sandbox/outputs.tf`:

```hcl
output "ecr_repository_urls" { value = module.registry.repository_urls }
output "queue_url" { value = module.queues.queue_url }
output "ssm_prefix" { value = module.params.prefix }
```

- [ ] **Step 5: Validate and plan (read-only against AWS)**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/infra/terraform
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
terraform fmt -recursive && terraform fmt -recursive -check
(cd bootstrap && terraform init -backend=false -input=false >/dev/null && terraform validate)
(cd envs/sandbox && terraform init -input=false >/dev/null && terraform validate && terraform plan -input=false -out=/dev/null | tail -3)
```

Expected: `fmt -check` prints nothing; both `validate` say `Success!`; the plan ends `Plan: N to add, 0 to change, 0 to destroy.` (N ≈ 20). Nothing is created by a plan. Delete any `.terraform` dirs' downloads only via `.gitignore` — never commit them. To check the DNS module also validates, run once: `terraform plan -input=false -var domain=example.com -out=/dev/null | tail -1` → a plan with more resources and no error.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
git add infra/terraform
git commit -m "feat: Terraform foundation — sandbox environment, network, registry, queues, parameters; state bucket and DNS ready for a domain"
```

---

### Task 3: Terraform media module — bucket, ingest and transform Lambdas, image CloudFront

**Files:**
- Create: `infra/terraform/modules/media/main.tf`
- Modify: `infra/terraform/envs/sandbox/main.tf` (append the module), `outputs.tf`

**Interfaces:**
- Consumes: `infra/lambda/media/dist/media-lambdas.zip` (Task 1 — run `infra/lambda/media/build.sh` first if missing); `random_id.suffix.hex`.
- Produces (`module.media`): `bucket_name`, `bucket_arn`, `image_domain` (CloudFront domain), `image_distribution_id`.
- One bucket, two prefixes: `incoming/<sha256>` (uploads; expire after 1 day) and `media/<sha256>.jpg` (masters).
- **Known gap, deliberately not built here:** every master is public through `/img/…`. Restricted images (claim proofs, orphan sightings — `media-pipeline.md` §4) need a visibility in the key and CloudFront signed URLs; that arrives with the backend's upload slots (purpose is known there). Record this in the run report.

- [ ] **Step 1: `modules/media/main.tf`**

```hcl
variable "name" { type = string }
variable "bucket_suffix" { type = string }
variable "lambda_zip" { type = string }
variable "cors_allowed_origins" { type = list(string) }

data "aws_cloudfront_response_headers_policy" "simple_cors" { name = "Managed-SimpleCORS" }

# --- Bucket -----------------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = "${var.name}-media-${var.bucket_suffix}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Browsers PUT the photo straight to S3 with the presigned URL.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "expire-unprocessed-uploads"
    status = "Enabled"
    filter { prefix = "incoming/" }
    expiration { days = 1 }
  }
}

# --- Lambdas ----------------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# One role per function: the transform can only read masters; only ingest touches incoming/.
resource "aws_iam_role" "ingest" {
  name               = "${var.name}-ingest"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role" "transform" {
  name               = "${var.name}-transform"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${var.name}-ingest"
  retention_in_days = 1
}

resource "aws_cloudwatch_log_group" "transform" {
  name              = "/aws/lambda/${var.name}-transform"
  retention_in_days = 1
}

data "aws_iam_policy_document" "ingest" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.ingest.arn}:*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/incoming/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
}

data "aws_iam_policy_document" "transform" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.transform.arn}:*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
  # Without ListBucket a missing key answers AccessDenied instead of NoSuchKey (→ 404).
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
}

resource "aws_iam_role_policy" "ingest" {
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

resource "aws_iam_role_policy" "transform" {
  role   = aws_iam_role.transform.id
  policy = data.aws_iam_policy_document.transform.json
}

resource "aws_lambda_function" "ingest" {
  function_name    = "${var.name}-ingest"
  role             = aws_iam_role.ingest.arn
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  handler          = "ingest.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 1024
  timeout          = 30
  environment { variables = { BUCKET = aws_s3_bucket.media.bucket } }
  depends_on       = [aws_cloudwatch_log_group.ingest, aws_iam_role_policy.ingest]
}

resource "aws_lambda_function" "transform" {
  function_name    = "${var.name}-transform"
  role             = aws_iam_role.transform.arn
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  handler          = "transform.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  memory_size      = 1536
  timeout          = 15
  environment { variables = { BUCKET = aws_s3_bucket.media.bucket } }
  depends_on       = [aws_cloudwatch_log_group.transform, aws_iam_role_policy.transform]
}

resource "aws_lambda_permission" "s3_invokes_ingest" {
  statement_id  = "s3-invokes-ingest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.media.arn
}

resource "aws_s3_bucket_notification" "incoming" {
  bucket = aws_s3_bucket.media.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
  }
  depends_on = [aws_lambda_permission.s3_invokes_ingest]
}

resource "aws_lambda_function_url" "transform" {
  function_name      = aws_lambda_function.transform.function_name
  authorization_type = "AWS_IAM"
}

# --- Image distribution -----------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "transform" {
  name                              = "${var.name}-transform"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Accept is part of the cache key because the format depends on it. Follow-up: normalize Accept
# to avif|webp|jpeg in a CloudFront Function so the cache does not fragment by browser.
resource "aws_cloudfront_cache_policy" "images" {
  name        = "${var.name}-images"
  default_ttl = 31536000
  max_ttl     = 31536000
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    cookies_config { cookie_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
    headers_config {
      header_behavior = "whitelist"
      headers { items = ["Accept"] }
    }
  }
}

resource "aws_cloudfront_distribution" "images" {
  enabled     = true
  comment     = "${var.name} images"
  price_class = "PriceClass_100"

  origin {
    origin_id                = "transform"
    domain_name              = replace(replace(aws_lambda_function_url.transform.function_url, "https://", ""), "/", "")
    origin_access_control_id = aws_cloudfront_origin_access_control.transform.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "transform"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.images.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.simple_cors.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

# CloudFront signs requests to the Function URL (OAC); both permissions are granted so the
# invocation is allowed whichever one Lambda checks.
resource "aws_lambda_permission" "cloudfront_invokes_url" {
  statement_id           = "cloudfront-invokes-url"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.transform.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.images.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invokes_function" {
  statement_id  = "cloudfront-invokes-function"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transform.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.images.arn
}

output "bucket_name" { value = aws_s3_bucket.media.bucket }
output "bucket_arn" { value = aws_s3_bucket.media.arn }
output "image_domain" { value = aws_cloudfront_distribution.images.domain_name }
output "image_distribution_id" { value = aws_cloudfront_distribution.images.id }
```

- [ ] **Step 2: Append to `envs/sandbox/main.tf`**

```hcl
module "media" {
  source        = "../../modules/media"
  name          = local.name
  bucket_suffix = random_id.suffix.hex
  lambda_zip    = "${path.root}/../../../lambda/media/dist/media-lambdas.zip"
  # Sandbox: any origin may PUT with a presigned URL. Staging restricts this to the app's origin.
  cors_allowed_origins = ["*"]
}
```

Append to `outputs.tf`:

```hcl
output "media_bucket" { value = module.media.bucket_name }
output "image_url" { value = "https://${module.media.image_domain}" }
```

- [ ] **Step 3: Validate and plan**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
[ -f infra/lambda/media/dist/media-lambdas.zip ] || infra/lambda/media/build.sh
cd infra/terraform && export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
terraform fmt -recursive && terraform fmt -recursive -check
(cd envs/sandbox && terraform init -input=false >/dev/null && terraform validate && terraform plan -input=false -out=/dev/null | tail -1)
```

Expected: `Success!` and a plan with more resources than Task 2's, 0 to change, 0 to destroy, no errors or deprecation warnings (record any warning in the report).

- [ ] **Step 4: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
git add infra/terraform
git commit -m "feat: media on AWS — one bucket, ingest and transform Lambdas, images through CloudFront"
```

---

### Task 4: Terraform compute, API edge and GitHub OIDC

**Files:**
- Create: `infra/terraform/modules/compute/main.tf`, `infra/terraform/modules/compute/user_data.sh`, `infra/terraform/modules/edge_api/main.tf`, `infra/terraform/modules/github_oidc/main.tf`
- Modify: `infra/terraform/envs/sandbox/main.tf`, `outputs.tf`

**Interfaces:**
- Consumes: `module.network.*`, `module.registry.repository_arns`, `module.queues.queue_arn`/`dlq_arn`, `module.params.prefix`, `module.media.bucket_arn`.
- Produces outputs: `api_url`, `origin_public_dns`, `instance_id`, `github_deploy_role_arn`.
- Instance facts later tasks rely on: Amazon Linux 2023 arm64, Docker + Compose plugin installed by user data, the data volume mounted at `/srv/pgdata`, directory `/opt/scuby` exists, app port **8080** reachable only from CloudFront.

- [ ] **Step 1: `modules/compute/user_data.sh`**

```bash
#!/bin/bash
# Amazon Linux 2023: Docker + Compose, and the Postgres data volume mounted at /srv/pgdata.
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v5.6.1/docker-compose-linux-aarch64
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# The data volume is attached after boot; wait for the second disk (NVMe names are not stable).
root_disk="/dev/$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")"
data_disk=""
for _ in $(seq 1 60); do
  data_disk=$(lsblk -dpno NAME,TYPE | awk '$2 == "disk" {print $1}' | grep -v "^$${root_disk}$" | head -1 || true)
  [ -n "$data_disk" ] && break
  sleep 5
done
[ -n "$data_disk" ]
blkid "$data_disk" || mkfs -t xfs "$data_disk"
mkdir -p /srv/pgdata
uuid=$(blkid -s UUID -o value "$data_disk")
grep -q "$uuid" /etc/fstab || echo "UUID=$uuid /srv/pgdata xfs defaults,nofail 0 2" >> /etc/fstab
mount -a
mkdir -p /opt/scuby
touch /opt/scuby/.bootstrapped

# Cost backstop for throwaway environments: power off (→ terminate) after N minutes.
if [ "${auto_shutdown_minutes}" -gt 0 ]; then
  shutdown -h "+${auto_shutdown_minutes}"
fi
```

(This file is a Terraform `templatefile`: `${auto_shutdown_minutes}` is filled by Terraform. Any literal `${…}` meant for bash must be written `$${…}`; the script above uses plain `$var` forms for bash, so only `${auto_shutdown_minutes}` is interpolated. `"${root_disk}"` in the grep must become `"$${root_disk}"`.)

- [ ] **Step 2: `modules/compute/main.tf`**

```hcl
variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "availability_zone" { type = string }
variable "instance_type" {
  type    = string
  default = "t4g.small"
}
variable "app_port" {
  type    = number
  default = 8080
}
variable "data_volume_size_gb" {
  type    = number
  default = 20
}
variable "ecr_repository_arns" { type = list(string) }
variable "queue_arns" { type = list(string) }
variable "ssm_prefix" { type = string }
variable "media_bucket_arn" { type = string }
variable "snapshots_enabled" {
  description = "Daily DLM snapshots of the data volume. Off for throwaway environments."
  type        = bool
  default     = true
}
variable "auto_shutdown_minutes" {
  description = "If > 0, the instance powers off (and terminates) this many minutes after boot — a cost backstop for throwaway environments."
  type        = number
  default     = 0
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# --- Network access: only CloudFront reaches the app (docs/eng/infra.md · Edge) ----------------

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "${var.name}: app port from CloudFront only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_cloudfront" {
  security_group_id = aws_security_group.app.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = var.app_port
  to_port           = var.app_port
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Instance role -----------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = var.ecr_repository_arns
  }
  statement {
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
    resources = var.queue_arns
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*"]
  }
  # The backend presigns uploads into incoming/ and reads masters for restricted images.
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${var.media_bucket_arn}/incoming/*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.media_bucket_arn}/media/*"]
  }
  # Lets the backend tell "not processed yet" (404) from "forbidden" (403).
  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.media_bucket_arn]
  }
}

resource "aws_iam_role_policy" "instance" {
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.name}-instance"
  role = aws_iam_role.instance.name
}

# --- Instance and data volume ------------------------------------------------------------------

resource "aws_instance" "app" {
  ami                         = nonsensitive(data.aws_ssm_parameter.al2023_arm64.value)
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  user_data                   = templatefile("${path.module}/user_data.sh", { auto_shutdown_minutes = var.auto_shutdown_minutes })
  user_data_replace_on_change = true

  instance_initiated_shutdown_behavior = var.auto_shutdown_minutes > 0 ? "terminate" : "stop"

  metadata_options {
    http_tokens = "required"
    # Containers reach the instance role through IMDS: one extra hop.
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  tags = { Name = var.name }

  lifecycle { ignore_changes = [ami] }
}

resource "aws_ebs_volume" "pg_data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true
  tags = {
    Name     = "${var.name}-pg-data"
    Snapshot = "${var.name}-pg-data"
  }
}

resource "aws_volume_attachment" "pg_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.pg_data.id
  instance_id = aws_instance.app.id
  # Postgres has the volume mounted: detaching a running instance's busy volume hangs destroy.
  stop_instance_before_detaching = true
}

# --- Daily snapshots of the data volume (DLM) --------------------------------------------------

data "aws_iam_policy_document" "dlm_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  count              = var.snapshots_enabled ? 1 : 0
  name               = "${var.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_trust.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = var.snapshots_enabled ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "pg_data" {
  count              = var.snapshots_enabled ? 1 : 0
  description        = "${var.name} postgres data daily"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Snapshot = "${var.name}-pg-data" }

    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["05:00"]
      }
      retain_rule { count = 7 }
    }
  }
}

output "instance_id" { value = aws_instance.app.id }
output "instance_arn" { value = aws_instance.app.arn }
output "public_dns" { value = aws_instance.app.public_dns }
output "app_port" { value = var.app_port }
```

- [ ] **Step 3: `modules/edge_api/main.tf`**

```hcl
variable "name" { type = string }
variable "origin_domain" { type = string }
variable "origin_port" { type = number }
variable "origin_secret" {
  type      = string
  sensitive = true
}

data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_viewer" { name = "Managed-AllViewer" }

# api.<domain> later; for now the CloudFront default domain. TLS ends here; the hop to the EC2 is
# plain HTTP to a port only CloudFront can reach (docs/eng/infra.md · Edge, trade-off accepted).
resource "aws_cloudfront_distribution" "api" {
  enabled     = true
  comment     = "${var.name} api"
  price_class = "PriceClass_100"

  origin {
    origin_id   = "app"
    domain_name = var.origin_domain
    custom_origin_config {
      http_port              = var.origin_port
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    # The backend will reject requests without this header (docs/eng/infra.md · Edge).
    custom_header {
      name  = "X-Origin-Secret"
      value = var.origin_secret
    }
  }

  default_cache_behavior {
    target_origin_id         = "app"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

output "domain_name" { value = aws_cloudfront_distribution.api.domain_name }
output "distribution_id" { value = aws_cloudfront_distribution.api.id }
```

- [ ] **Step 4: `modules/github_oidc/main.tf`**

```hcl
# GitHub Actions assumes this role with OIDC — no stored AWS keys (docs/eng/infra.md · CI/CD).
variable "name" { type = string }
variable "github_repo" { type = string }
variable "ecr_repository_arns" { type = list(string) }
variable "instance_arns" { type = list(string) }

data "aws_region" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Only workflows on main — never a pull request — may assume the deploy role.
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
    ]
    resources = var.ecr_repository_arns
  }
  statement {
    actions = ["ssm:SendCommand"]
    resources = concat(var.instance_arns, [
      "arn:aws:ssm:${data.aws_region.current.region}::document/AWS-RunShellScript",
    ])
  }
  statement {
    actions   = ["ssm:GetCommandInvocation"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "role_arn" { value = aws_iam_role.deploy.arn }
```

- [ ] **Step 5: Append to `envs/sandbox/main.tf`**

```hcl
resource "random_password" "origin_secret" {
  length  = 32
  special = false
}

module "compute" {
  source              = "../../modules/compute"
  name                = local.name
  vpc_id              = module.network.vpc_id
  subnet_id           = module.network.public_subnet_id
  availability_zone   = module.network.availability_zone
  ecr_repository_arns = module.registry.repository_arns
  queue_arns          = [module.queues.queue_arn, module.queues.dlq_arn]
  ssm_prefix          = module.params.prefix
  media_bucket_arn    = module.media.bucket_arn
  # Throwaway: no daily snapshots, and the instance terminates itself after 6 hours.
  snapshots_enabled     = false
  auto_shutdown_minutes = 360
}

module "edge_api" {
  source        = "../../modules/edge_api"
  name          = local.name
  origin_domain = module.compute.public_dns
  origin_port   = module.compute.app_port
  origin_secret = random_password.origin_secret.result
}

module "github_oidc" {
  source              = "../../modules/github_oidc"
  name                = local.name
  github_repo         = var.github_repo
  ecr_repository_arns = module.registry.repository_arns
  instance_arns       = [module.compute.instance_arn]
}
```

Append to `outputs.tf`:

```hcl
output "api_url" { value = "https://${module.edge_api.domain_name}" }
output "origin_public_dns" { value = module.compute.public_dns }
output "instance_id" { value = module.compute.instance_id }
output "github_deploy_role_arn" { value = module.github_oidc.role_arn }
```

- [ ] **Step 6: Validate and plan the whole environment**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/infra/terraform
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
terraform fmt -recursive && terraform fmt -recursive -check
(cd envs/sandbox && terraform init -input=false >/dev/null && terraform validate && terraform plan -input=false -out=/dev/null | tail -1)
```

Expected: `Success!`; `Plan: N to add, 0 to change, 0 to destroy.` (N ≈ 60); no errors. If the security-group rule fails validation on the CloudFront prefix list size, record it — that limit is real (the list counts as ~55 rules against the default 60) and is fine with only this one ingress rule.

- [ ] **Step 7: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
git add infra/terraform
git commit -m "feat: compute behind CloudFront — EC2 reachable only from CloudFront, data volume with daily snapshots, GitHub OIDC deploy role"
```

---

### Task 5: Deploy, smoke and destroy scripts

**Files:**
- Create: `infra/compose/sandbox/compose.yaml`, `infra/scripts/sandbox-build.sh`, `infra/scripts/sandbox-deploy.sh`, `infra/scripts/sandbox-smoke.sh`, `infra/scripts/sandbox-destroy.sh`, `infra/scripts/sandbox-watchdog.sh`, `infra/lambda/media/smoke/upload-smoke.mjs`

**Interfaces:**
- Consumes: Terraform outputs `ecr_repository_urls`, `instance_id`, `api_url`, `origin_public_dns`, `queue_url`, `media_bucket`, `image_url`, `ssm_prefix` (read with `terraform -chdir=infra/terraform/envs/sandbox output -json`).
- Produces: `sandbox-build.sh` (local images `scuby/postgres:17` and `scuby-backend`, both linux/arm64; no AWS calls), `sandbox-deploy.sh` (exit 0 when the backend answers UP on the instance), `sandbox-watchdog.sh <deadline-epoch>` (sleeps, then runs `sandbox-destroy.sh` unless the state is already empty), `sandbox-smoke.sh` (exit 0 when every check passes; prints PASS/FAIL per check), `sandbox-destroy.sh` (destroy + sweep; exit = sweep's exit).

- [ ] **Step 1: `infra/compose/sandbox/compose.yaml`**

```yaml
# What runs on the sandbox EC2. Memory is capped so the JVM and Postgres share 2 GB safely:
# the JVM's MaxRAMPercentage=60 applies to the backend's 1 GB limit, not to the host.
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    environment:
      POSTGRES_DB: scuby
      POSTGRES_USER: scuby
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - /srv/pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U scuby -d scuby"]
      interval: 2s
      retries: 60
    mem_limit: 512m
    restart: unless-stopped

  backend:
    image: ${BACKEND_IMAGE}
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SPRING_PROFILES_ACTIVE: staging
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/scuby
      SPRING_DATASOURCE_USERNAME: scuby
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}
    ports:
      - "8080:8080"
    mem_limit: 1g
    restart: unless-stopped
```

- [ ] **Step 2: `infra/scripts/sandbox-build.sh`** (runs before apply — no AWS needed)

```bash
#!/usr/bin/env bash
# Builds both images locally for linux/arm64, so the slow part happens before any resource exists.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
docker build --platform linux/arm64 -t scuby/postgres:17 "$REPO/infra/docker/postgres"
cd "$REPO/backend"
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH
./mvnw -q -B -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker image inspect scuby/postgres:17 scuby-backend --format '{{.RepoTags}} {{.Architecture}}'
```

- [ ] **Step 3: `infra/scripts/sandbox-deploy.sh`**

```bash
#!/usr/bin/env bash
# Pushes the locally built images to ECR and starts them on the sandbox EC2 through SSM.
# Run sandbox-build.sh first.
set -euo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
json=$($TF output -json)
get() { python3 -I -c "import json,sys; d=json.loads(sys.argv[1]); v=d[sys.argv[2]]['value']; print(v[sys.argv[3]] if len(sys.argv) > 3 else v)" "$json" "$@"; }

BACKEND_REPO=$(get ecr_repository_urls backend)
POSTGRES_REPO=$(get ecr_repository_urls postgres)
INSTANCE=$(get instance_id)
PREFIX=$(get ssm_prefix)
REGISTRY="${BACKEND_REPO%%/*}"

echo "== push images"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
docker tag scuby/postgres:17 "$POSTGRES_REPO:17" && docker push "$POSTGRES_REPO:17"
docker tag scuby-backend "$BACKEND_REPO:sandbox" && docker push "$BACKEND_REPO:sandbox"

echo "== database password (set by the CLI, never by Terraform)"
aws ssm put-parameter --name "$PREFIX/db/password" --type SecureString --overwrite \
  --value "$(openssl rand -hex 24)" >/dev/null

echo "== waiting for the instance to register with SSM"
status=""
for _ in $(seq 1 60); do
  status=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" \
    --query 'InstanceInformationList[0].PingStatus' --output text)
  [ "$status" = "Online" ] && break
  sleep 10
done
[ "$status" = "Online" ] || { echo "instance never came online in SSM"; exit 1; }

echo "== start the stack on the instance"
# The remote script is shipped base64-encoded: no quoting survives JSON + SSM + bash otherwise.
REMOTE=$(cat <<EOF
set -euo pipefail
for i in \$(seq 1 60); do [ -f /opt/scuby/.bootstrapped ] && break; sleep 5; done
test -f /opt/scuby/.bootstrapped
cd /opt/scuby
echo '$(base64 < "$REPO/infra/compose/sandbox/compose.yaml" | tr -d '\n')' | base64 -d > compose.yaml
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $REGISTRY
DB=\$(aws ssm get-parameter --region us-east-1 --name $PREFIX/db/password --with-decryption --query Parameter.Value --output text)
umask 077
{ echo "BACKEND_IMAGE=$BACKEND_REPO:sandbox"; echo "POSTGRES_IMAGE=$POSTGRES_REPO:17"; echo "DB_PASSWORD=\$DB"; } > .env
docker compose up -d
for i in \$(seq 1 90); do curl -sf localhost:8080/actuator/health && exit 0; sleep 5; done
docker compose logs --tail 100
exit 1
EOF
)
REMOTE_B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
printf '{"commands":["echo %s | base64 -d > /opt/scuby-run.sh", "bash /opt/scuby-run.sh"]}' "$REMOTE_B64" > "$SCRATCH/ssm-commands.json"
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "file://$SCRATCH/ssm-commands.json" --timeout-seconds 900 \
  --query Command.CommandId --output text)
rm -f "$SCRATCH/ssm-commands.json"
st=Pending
for _ in $(seq 1 100); do
  st=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 10
done
# Print status and the tail of stdout only — never the .env or the password.
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent]' --output text | tail -20
[ "$st" = "Success" ]
```

Test the remote script's rendering without AWS: run the `REMOTE=$(cat <<EOF … EOF)` block with dummy values for `REPO`, `REGISTRY`, `PREFIX`, `BACKEND_REPO`, `POSTGRES_REPO`, then `printf '%s' "$REMOTE" | bash -n` → no syntax error, and `printf '%s' "$REMOTE" | grep -c 'DB_PASSWORD=\$DB'` → 1.

- [ ] **Step 4: `infra/lambda/media/smoke/upload-smoke.mjs`**

```js
// Presigned upload → ingest → variant, against the applied sandbox. Exit 1 on the first failure.
// Usage: node smoke/upload-smoke.mjs <bucket> <image-url>
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const [bucket, imageUrl] = process.argv.slice(2);
if (!bucket || !imageUrl) { console.error('usage: upload-smoke.mjs <bucket> <image-url>'); process.exit(2); }

// Only the checksum we choose is signed; no automatic CRC32 on presigned URLs.
const s3 = new S3Client({ region: 'us-east-1', requestChecksumCalculation: 'WHEN_REQUIRED' });
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exit(1);
};

const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#8b5a2b' } })
  .withExif({ IFD0: { Copyright: 'smoke' } }).jpeg().toBuffer();
const digest = createHash('sha256').update(photo).digest();
const hex = digest.toString('hex');
const b64 = digest.toString('base64');

const url = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: bucket, Key: `incoming/${hex}`, ContentType: 'image/jpeg', ChecksumSHA256: b64 }),
  { expiresIn: 300, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) },
);

const wrong = await fetch(url, { method: 'PUT', body: Buffer.concat([photo, Buffer.from('x')]),
  headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': b64 } });
const wrongBody = await wrong.text();
// Must be the checksum refusal (BadDigest), not a signature error that would also be a 4xx.
check('S3 rejects bytes that do not match the signed SHA-256', wrong.status === 400 && /BadDigest|XAmzContentChecksumMismatch/.test(wrongBody),
  `status ${wrong.status} ${wrongBody.slice(0, 120)}`);

const put = await fetch(url, { method: 'PUT', body: photo,
  headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': b64 } });
check('presigned PUT with the matching SHA-256', put.status === 200, `status ${put.status}`);

let master = false;
for (let i = 0; i < 30 && !master; i++) {
  try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `media/${hex}.jpg` })); master = true; }
  catch { await new Promise((r) => setTimeout(r, 2000)); }
}
check('ingest Lambda wrote the master', master, `media/${hex}.jpg`);

const card = await fetch(`${imageUrl}/img/${hex}/card`, { headers: { accept: 'image/webp,*/*' } });
const cardBytes = Buffer.from(await card.arrayBuffer());
const meta = card.ok ? await sharp(cardBytes).metadata() : {};
check('card variant through CloudFront is WebP ≤ 800 px', card.status === 200 && meta.format === 'webp' && meta.width <= 800,
  `status ${card.status}, ${meta.format} ${meta.width}x${meta.height}`);
check('variant has no EXIF', meta.exif === undefined);
check('variant is cacheable as immutable', /immutable/.test(card.headers.get('cache-control') ?? ''));

const avif = await fetch(`${imageUrl}/img/${hex}/thumb`, { headers: { accept: 'image/avif,*/*' } });
check('thumb negotiates AVIF', avif.headers.get('content-type') === 'image/avif', avif.headers.get('content-type'));

const missing = await fetch(`${imageUrl}/img/${'0'.repeat(64)}/card`);
check('unknown photo answers 404', missing.status === 404, `status ${missing.status}`);
```

- [ ] **Step 5: `infra/scripts/sandbox-smoke.sh`**

```bash
#!/usr/bin/env bash
# End-to-end checks against the applied sandbox. Prints PASS/FAIL per check; exit 1 if any fails.
set -uo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
out() { $TF output -raw "$1"; }
failed=0
check() { if [ "$2" -eq 0 ]; then echo "PASS $1"; else echo "FAIL $1"; failed=1; fi; }

API=$(out api_url); ORIGIN=$(out origin_public_dns); QUEUE=$(out queue_url)
BUCKET=$(out media_bucket); IMAGES=$(out image_url)

body=$(curl -s --max-time 20 "$API/actuator/health"); echo "$body" | grep -q '"status":"UP"'
check "API health through CloudFront ($API)" $?

curl -s --max-time 8 "http://$ORIGIN:8080/actuator/health" >/dev/null
[ $? -ne 0 ]; check "the EC2 refuses direct requests" $?

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API/no/such/route")
[ "$code" = "404" ]; check "unknown route answers 404 through CloudFront (got $code)" $?

token="smoke-$(date +%s)"
aws sqs send-message --queue-url "$QUEUE" --message-body "$token" >/dev/null
msg=$(aws sqs receive-message --queue-url "$QUEUE" --wait-time-seconds 10 --query 'Messages[0].[Body,ReceiptHandle]' --output text)
[ "$(echo "$msg" | cut -f1)" = "$token" ]; check "SQS round trip" $?
[ -n "$(echo "$msg" | cut -f2)" ] && aws sqs delete-message --queue-url "$QUEUE" --receipt-handle "$(echo "$msg" | cut -f2)"

(cd "$REPO/infra/lambda/media" && node smoke/upload-smoke.mjs "$BUCKET" "$IMAGES")
check "media pipeline (see lines above)" $?

# The instance role, not the laptop's admin credentials: SQS and an upload into incoming/.
INSTANCE=$(out instance_id)
REMOTE="set -e
aws sqs send-message --region us-east-1 --queue-url $QUEUE --message-body from-instance >/dev/null
aws sqs receive-message --region us-east-1 --queue-url $QUEUE --wait-time-seconds 10 --query 'Messages[0].Body' --output text
head -c 1024 /dev/urandom > /tmp/probe.bin
aws s3api put-object --region us-east-1 --bucket $BUCKET --key incoming/probe-not-a-hash --body /tmp/probe.bin --checksum-algorithm SHA256 >/dev/null
echo instance-ok"
B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" --query Command.CommandId --output text)
st=Pending
for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 4
done
outp=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardOutputContent --output text)
[ "$st" = "Success" ] && echo "$outp" | grep -q instance-ok
check "instance role: SQS send/receive and PUT into incoming/ (status $st)" $?

[ "$failed" -eq 0 ] && echo "smoke: all passed"
exit "$failed"
```

- [ ] **Step 6: `infra/scripts/sandbox-destroy.sh` and `infra/scripts/sandbox-watchdog.sh`**

```bash
#!/usr/bin/env bash
# Destroys the sandbox and proves nothing is left. Safe to re-run (e.g. after logging in again).
set -uo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
[ -f "$REPO/infra/lambda/media/dist/media-lambdas.zip" ] || "$REPO/infra/lambda/media/build.sh"
$TF destroy -auto-approve -input=false || $TF destroy -auto-approve -input=false
bash "$REPO/infra/scripts/sweep.sh"
```

`sandbox-watchdog.sh` — started detached in Task 6 before apply; destroys at the deadline even if the controller has stopped:

```bash
#!/usr/bin/env bash
# Usage: sandbox-watchdog.sh <deadline-epoch-seconds>
# Sleeps until the deadline, then destroys the sandbox unless the Terraform state is already empty.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
deadline=$1
now=$(date -u +%s)
[ "$deadline" -gt "$now" ] && sleep $(( deadline - now ))
if [ -n "$(terraform -chdir="$REPO/infra/terraform/envs/sandbox" state list 2>/dev/null)" ]; then
  echo "watchdog: deadline reached with resources alive — destroying"
  bash "$REPO/infra/scripts/sandbox-destroy.sh"
else
  echo "watchdog: state already empty — nothing to do"
fi
```

Terraform's state lock makes a destroy started by the watchdog while Task 8's destroy runs safe (one waits or fails on the lock; re-run afterwards).

- [ ] **Step 7: Static checks (no AWS calls)**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
chmod +x infra/scripts/*.sh
for f in infra/scripts/*.sh infra/terraform/modules/compute/user_data.sh; do bash -n "$f" && echo "ok $f"; done
node --check infra/lambda/media/smoke/upload-smoke.mjs && echo "ok upload-smoke.mjs"
command -v shellcheck >/dev/null && shellcheck -S warning infra/scripts/*.sh || echo "shellcheck not installed — skipped"
POSTGRES_IMAGE=x BACKEND_IMAGE=y DB_PASSWORD=z docker compose -f infra/compose/sandbox/compose.yaml config -q && echo "compose parsed"
```

Expected: every file `ok`; `compose parsed`. Also run the remote-script rendering check from Step 3.

- [ ] **Step 8: Commit**

```bash
git add infra/compose infra/scripts infra/lambda/media/smoke
git commit -m "feat: sandbox scripts — deploy the backend through SSM, end-to-end smoke, destroy and sweep"
```

---

### Task 6: Build, apply and deploy (gate G1)

**Files:** none changed (operations). Record every command's outcome and timestamps in the run report. Every long command below runs **in the background** as Global Constraints describe, writing `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/<name>.log` and `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/<name>.exit`; wait for the `.exit` file with Monitor.

- [ ] **Step 1: Build the images before anything exists in AWS**

`nohup bash infra/scripts/sandbox-build.sh > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/build.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/build.exit` (background). Expected exit 0 and both images `arm64`. If the build fails, fix small repo-side issues; if it still fails, record it and stop (no apply without images).

- [ ] **Step 2: Gate G1** — `bash infra/scripts/sso-remaining.sh` must print **≥ 150**. If not: record "G1 not met: N minutes left", skip Tasks 6–8, go to Task 9.

- [ ] **Step 3: Keep the Mac awake and start the watchdog — BEFORE apply**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
left=$(bash infra/scripts/sso-remaining.sh)
deadline=$(( $(date -u +%s) + (left - 45) * 60 ))     # 45 min before the session ends
nohup caffeinate -dims -w $$ >/dev/null 2>&1 &         # awake while this shell lives
nohup caffeinate -dims bash infra/scripts/sandbox-watchdog.sh "$deadline" > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/watchdog.log 2>&1 &
echo "watchdog pid $! deadline $(date -u -r "$deadline" +%FT%TZ)" | tee -a /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/infra-sandbox-report.md
```

**From the next step on, Task 8 must run whatever happens.**

- [ ] **Step 4: Apply (background)**

`cd infra/terraform/envs/sandbox && nohup terraform apply -auto-approve -input=false > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/apply.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/apply.exit` (background, with `AWS_PROFILE`/`AWS_REGION` exported). Record start/end times. Expected exit 0, `Apply complete!`, then `terraform output` lists `api_url`, `image_url`, … CloudFront takes ~5–15 minutes. If apply fails: check the retry invariant; fix only if the cause is clearly in this repo's Terraform and small (one retry); otherwise record the error and **go to Task 8**.

- [ ] **Step 5: Deploy (background)**

`nohup bash infra/scripts/sandbox-deploy.sh > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/deploy.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/deploy.exit`. Expected exit 0 and the health JSON with `"status":"UP"` at the end of the log. On failure: check the retry invariant; inspect with an SSM command `docker compose -f /opt/scuby/compose.yaml logs --tail 200`; fix only small repo-side mistakes, one retry; record and continue to Task 7's gate.

- [ ] **Step 6: If a script was fixed, commit the fix** (`fix: …`).

---

### Task 7: Smoke tests (gate G2)

- [ ] **Step 1: Gate G2** — `bash infra/scripts/sso-remaining.sh` must print **≥ 90**. If not: record it and go to Task 8 now.

- [ ] **Step 2: Run (background)** — `nohup bash infra/scripts/sandbox-smoke.sh > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/smoke.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/smoke.exit`.

Expected: every line `PASS` and `smoke: all passed`. A `FAIL`: check the retry invariant first; diagnose (CloudWatch logs of the Lambdas: `aws logs tail /aws/lambda/scuby-sandbox-transform --since 30m`; the instance through SSM), fix small repo-side mistakes with one `terraform apply` or re-deploy, re-run once, then record the final state either way.

- [ ] **Step 3: If anything was fixed, commit it** (`fix: …`).

---

### Task 8: Destroy and sweep (mandatory once Task 6 Step 2 started)

- [ ] **Step 1: Destroy (background)** — record the start time, then `nohup bash infra/scripts/sandbox-destroy.sh > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/destroy.log 2>&1; echo $? > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/destroy.exit`. Expected: `Destroy complete!` then `sweep: clean`, exit 0. If the watchdog already ran the destroy (see `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/watchdog.log`), run `sandbox-destroy.sh` once more anyway — it is idempotent.

- [ ] **Step 2: If the sweep reports leftovers** — wait 5 minutes and re-run `bash infra/scripts/sweep.sh` (tagging-API lag), then re-run `sandbox-destroy.sh` once. If anything is still reported: **do not delete it by hand.** Write into the run report, for the human, each leftover with the exact command that would remove it, plus `aws sso login --profile itslauyalejo-sso && bash infra/scripts/sandbox-destroy.sh`. A `SWEEP ERROR` (e.g. expired credentials) is reported the same way.

- [ ] **Step 2b: Stop the watchdog** if it has not fired: `pkill -f sandbox-watchdog.sh` (only after the state is empty).

- [ ] **Step 3: Confirm the state file is empty** — `terraform -chdir=infra/terraform/envs/sandbox state list | wc -l` → `0`.

---

### Task 9: Docs and the run report

**Files:**
- Create: `infra/README.md`
- Modify: `docs/eng/infra.md` (Environments; Compute; Media), `docs/eng/media-pipeline.md` (§1 HEIC row), `README.md` (root: the `infra/` row)

- [ ] **Step 1: `infra/README.md`** — Spanish, concise, like `backend/README.md`: what each folder is (`docker/postgres`, `terraform/` with `modules/`, `envs/sandbox`, `bootstrap/`; `lambda/media`; `compose/sandbox`; `scripts/`); requirements (Terraform ≥ 1.15, AWS CLI v2 with SSO, Node ≥ 22, Docker, the backend's Java setup); how to run the sandbox end to end (`aws sso login --profile itslauyalejo-sso` → `infra/lambda/media/build.sh` → `terraform -chdir=infra/terraform/envs/sandbox apply` → `infra/scripts/sandbox-deploy.sh` → `infra/scripts/sandbox-smoke.sh` → **always** `infra/scripts/sandbox-destroy.sh`); the two guard scripts; the warning that the sandbox account holds a pre-existing default VPC and the `wc2026-tfstate-itslauyalejo` bucket that must never be touched; links to `docs/eng/infra.md` and `docs/eng/media-pipeline.md`.

- [ ] **Step 2: `docs/eng/infra.md`**
  - Under **Environments**, after the table, add:

```markdown
**Sandbox.** A throwaway environment in a separate test AWS account
(`infra/terraform/envs/sandbox`, local state): applied, smoke-tested end to end and destroyed in the
same run, to prove the Terraform before staging exists. It uses the CloudFront default domains, so
it needs no domain. How to run it: `infra/README.md`.
```

  - Under **Compute**, add a bullet:

```markdown
- **Memory budget on the 2 GB instance:** the backend container is capped at 1 GB (`mem_limit`, so
  the JVM's `MaxRAMPercentage=60` sizes the heap from that) and Postgres at 512 MB; the rest is the
  OS and Docker.
```

  - Under **Media (closes O10)**, after the table, add:

```markdown
Not built yet: restricted images (claim proofs, orphan sightings) still need a visibility in the
upload key and CloudFront signed URLs; until then every master is reachable through `/img/…`. It
arrives with the backend's upload slots, which know each photo's purpose.
```

- [ ] **Step 2b: `docs/eng/media-pipeline.md` §1** — in the *On the device* table, the HEIC row says "If the browser can't, the server converts". Replace that sentence with: "The server cannot convert HEIC (the image library's prebuilt binaries decode AVIF, not HEVC-based HEIC), so a photo the browser cannot decode is refused on the device with an explanation." (The client already does this.)

- [ ] **Step 3: Root `README.md`** — change the `infra/` row's description to: `Infraestructura: la imagen de Postgres, Terraform (módulos y el sandbox), las Lambdas de fotos`.

- [ ] **Step 4: Link check and commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
python3 -I - <<'EOF'
import re,os
bad=[]
for root,_,fs in os.walk('.'):
  if any(x in root for x in ('/node_modules','/.git','/target','/.superpowers','/docs/superpowers','/.terraform')): continue
  for f in fs:
    if not f.endswith('.md'): continue
    p=os.path.join(root,f); s=open(p).read()
    for m in re.finditer(r'\]\(([^)#\s]+)(#[^)]*)?\)',s):
      t=m.group(1)
      if t.startswith('http'): continue
      if not os.path.exists(os.path.normpath(os.path.join(root,t))): bad.append((p,t))
print(bad or 'all links ok')
EOF
git add infra/README.md docs/eng/infra.md docs/eng/media-pipeline.md README.md
git commit -m "doc: how to run the infra sandbox; the instance's memory budget"
```

- [ ] **Step 5: Run report** (Spanish) at the report path in Global Constraints: per task done/partial/skipped with commits; gate readings (G1, G2) with times; apply start, destroy start and end times; the smoke output (every PASS/FAIL); the final sweep output; any leftover and how it was removed (or the exact command still needed); deviations and follow-ups (e.g. Accept normalization in a CloudFront Function, the backend's `X-Origin-Secret` check, CORS restricted to the app origin in staging).

---

## Not in this plan (and why)

- **Staging environment and remote state:** needs the real account and the domain (`backend-plan.md` Phase I). The bootstrap and DNS code is validated here so staging is a new `envs/staging` composing the same modules.
- **The backend's `X-Origin-Secret` check, presigning in the backend, real secrets:** backend work in the thin slice; the sandbox proves the infrastructure path with the CLI and a script.
- **CI deploy workflow using the OIDC role:** the role is created and destroyed here; wiring `deploy.yml` waits for staging.
- **Sandbox-only shortcuts, not to copy into staging:** S3 CORS allows any origin (staging: the app's origin only — `media-pipeline.md` §4); the image distribution's CORS is `Managed-SimpleCORS` (`*`); the database password reaches the container through a `.env` on the instance (staging: the backend reads secrets from SSM at start-up — `backend.md` · Configuration); `Accept` is in the image cache key un-normalized.
- **Size bound on presigned uploads:** the backend's slot must sign `Content-Length` (the presign here signs only host and checksum); the ingest Lambda already refuses objects over 10 MB without downloading them.
