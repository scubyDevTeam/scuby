# Observability (Track C) Implementation Plan

> **As built.** The implementation deviates from the plan text below in these ways:
> - Two critical ingest conditions (50 GB and 80 GB) replace one condition with a warning block: a warning threshold opens no incident, so it would never send an email.
> - The p95 latency condition and its dashboard widget exclude `/actuator` requests (health checks).
> - The HTTP and no-data conditions `FACET` by `deployment.environment`, so each environment is evaluated separately.
> - Log attributes in New Relic are `severity.text` and `otel.library.name`, not `level` and `logger.name`.
> - `ServerTelemetryTest` also clears Boot's console logging system properties afterwards, so the JSON console does not leak into later test classes.
> - Startup fails when the `newrelic` profile is active and no license key is set (`NewRelicLicenseKeyCheck`), instead of exporting with an unresolved header.
> - Telemetry and the server console are configured by variables in `application.yml` (`SCUBY_TELEMETRY_EXPORT`, `SCUBY_ENVIRONMENT`, `LOGGING_STRUCTURED_FORMAT_CONSOLE`, `LOGGING_THRESHOLD_CONSOLE`) instead of the `newrelic` / `server` profiles described below; the startup check applies when `SCUBY_TELEMETRY_EXPORT=true`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend emits telemetry as decision #38 says — traces, metrics and INFO logs to New Relic over OTLP; on servers, WARN and up as JSON on stdout — verified with real data in the New Relic account, and the New Relic dashboard and alerts exist as Terraform code, applied.

**Architecture:** Spring Boot 4.1's built-in OpenTelemetry support (`spring-boot-starter-opentelemetry`, which also brings Micrometer's OTLP registry) exports traces, metrics and logs. Two profiles carry the server behaviour, both pulled in by the `staging` and `prod` profile groups:
- `newrelic` — the three OTLP exports, nothing else. Usable on a laptop as `local,newrelic`.
- `server` — the console rule of the servers: Spring Boot's structured (ECS JSON) console at WARN and up.

There is **no `logback-spring.xml`**: Boot's programmatic default console is the only one that honours `logging.structured.format.console` (its `console-appender.xml` include always writes plain text). The OpenTelemetry Logback appender is attached to the root logger in code once the `OpenTelemetry` bean exists; lines written before that (a failed migration, a bad config) reach only stdout, which is exactly what #38 keeps stdout for. Dashboards and alerts are a separate Terraform root, `infra/terraform/observability/`, with the `newrelic` provider and local state.

**Tech Stack:** Java 25, Spring Boot 4.1.2 (Jackson 3; manages OpenTelemetry API 1.62 and Micrometer 1.17), OpenTelemetry Logback appender **2.28.0-alpha** (the release built against API 1.62), Terraform ≥ 1.15, `newrelic/newrelic` provider ~> 3.101 (3.101.8 verified), New Relic NerdGraph (curl) for verification.

## Global Constraints

- Read first: `docs/eng/backend.md` · Observability (the table is the spec) and · Environments and profiles; `docs/eng/infra.md` · Logs, · Secrets and · Observability as code; `docs/product/00-product-map.md` row #38.
- **Work only in the worktree** `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability`, branch `be/observability`. Never touch the main checkout `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo`, `~/scuby-b1-run`, or `.worktrees/be-thin-slice` — other sessions run there. **Write every file with an absolute path under the worktree.** Scratch files (logs, PIDs, the report) go in the session scratchpad directory the controller names in the dispatch (written `<scratch>` below) — never a scratchpad path copied from elsewhere.
- **Shared machine:** other sessions run Postgres containers, Maven and Java processes. Never `docker compose down`/`up` with the default project, never `pkill`/`killall` by pattern, never use ports 5433 or 8080. Stop only processes and containers this task started, by recorded PID / container name.
- **New Relic:** account **8675334**, region **US**. OTLP base `https://otlp.nr-data.net:4318` (paths `/v1/traces`, `/v1/metrics`, `/v1/logs`), license key in header `api-key`. NerdGraph `https://api.newrelic.com/graphql`, User API key in header `API-Key`.
- **Keys come from the macOS Keychain, only inside the one command or script that needs them; never print, echo, log, commit, write to a file, or put them on a command line (argv is visible to `ps`):**
  - license: `perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-license-key -w`
  - user API key: `perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-user-api-key -w`
  The `alarm` makes a Keychain GUI prompt fail after 20 s instead of hanging. If the lookup fails or times out, stop with BLOCKED — do not ask for the key in any other way.
- Java: `export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH`; Maven from `<worktree>/backend` via `./mvnw`. Every build needs Docker + local image `scuby/postgres:17` (jOOQ codegen, Testcontainers).
- Each Bash tool call is a fresh shell: exports and `cd` do not carry over. Put multi-step sequences that share state (keys, PIDs) in one call or one script. The tool shell is zsh: run scripts with `bash <script>`; never pipe a command whose exit status matters into `tail`/`head`.
- `local` and `test` export nothing and log everything at INFO on a plain-text console. `service.name` is `scuby-backend`; `deployment.environment` is `local` by default, `staging` / `prod` from those profiles' files.
- Latency is in **milliseconds** (Micrometer OTLP registry default `base-time-unit: milliseconds`; leave it).
- Names: dashboard `Scuby — Backend` (visible to all account users); alert policy `scuby-backend`; email destination `scubydev@gmail.com`. Alerts watch only `deployment.environment` in `staging`, `prod` — laptop runs never page.
- Terraform state for `infra/terraform/observability/` is **local and git-ignored** (moves to the S3 backend when staging's state bucket exists). Commit `.terraform.lock.hcl`. The state holds resource IDs, the email and the queries — no credentials (the provider reads its key from the environment).
- Commit prefixes `feat:` `test:` `doc:` `fix:`; tests ship in the same `feat:` commit as the behaviour they cover (repo history). **Never push.**
- Stuck rule: 3 honest failures on a step → stop the task, record it in the report, continue with the next task whose inputs exist.

## File map

```
backend/
  pom.xml                                         + spring-boot-starter-opentelemetry, opentelemetry-logback-appender-1.0 2.28.0-alpha
  src/main/resources/application.yml              exports off; resource attributes; sampling 1.0; histograms; profile groups
  src/main/resources/application-newrelic.yml     (new) exports on: endpoints, api-key header, delta temporality
  src/main/resources/application-server.yml       (new) console: ECS JSON, WARN and up
  src/main/resources/application-staging.yml      deployment.environment: staging
  src/main/resources/application-prod.yml         deployment.environment: prod
  src/main/java/co/scuby/platform/telemetry/OpenTelemetryLogbackInstaller.java   attaches the OTel appender to the root logger
  src/test/java/co/scuby/platform/telemetry/TelemetryDefaultsTest.java
  src/test/java/co/scuby/platform/telemetry/ServerTelemetryTest.java
  README.md                                       + "Telemetría" section (Spanish)
infra/terraform/observability/
  versions.tf  variables.tf  dashboard.tf  alerts.tf  outputs.tf  apply.sh  README.md (Spanish)
infra/scripts/nr-query.sh                         NRQL through NerdGraph (key from Keychain, never in argv)
.gitignore                                        (new — the repo has no root .gitignore) observability state, plans
docs/eng/backend.md · Environments and profiles   + newrelic and server profiles
docs/eng/infra.md · Secrets, · Observability as code   + license-key parameter; applied state
docs/eng/costs.md                                 + New Relic and CloudWatch Logs rows; 50/80 GB trigger
```

---

### Task 0: Worktree baseline

- [ ] **Step 1:** `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability && git status -sb` → `## be/observability`, clean (git-ignored `.superpowers/` is fine).
- [ ] **Step 2:** `cd backend && <java export> && ./mvnw -q -B verify` → exit 0. Count tests from `target/surefire-reports/*.xml` (`tests=` attributes; expected **27**, 0 failures/errors). If red, stop: BLOCKED.

---

### Task 1: The backend emits telemetry the way decision #38 says

**Files:** Modify `backend/pom.xml`, `application.yml`, `application-staging.yml`, `application-prod.yml`. Create `application-newrelic.yml`, `application-server.yml`, `platform/telemetry/OpenTelemetryLogbackInstaller.java`, the two tests.

**Interfaces:**
- Produces: profile `newrelic` (enables the three OTLP exports; key from property `newrelic.license-key`, falling back to env `NEW_RELIC_LICENSE_KEY`); profile `server` (ECS JSON console at WARN); groups `staging → newrelic, server` and `prod → newrelic, server`. Sampling is `management.tracing.sampling.probability` (env `MANAGEMENT_TRACING_SAMPLING_PROBABILITY`), set to `1.0` because Boot's default is `0.1`.

- [ ] **Step 1: Dependencies** (`pom.xml`; Boot manages the OpenTelemetry/Micrometer versions — do not declare them):

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-opentelemetry</artifactId>
</dependency>
<!-- 2.28.0-alpha is built against OpenTelemetry API 1.62, the version Boot 4.1.2 manages; bump together with Boot. -->
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-logback-appender-1.0</artifactId>
    <version>2.28.0-alpha</version>
</dependency>
```

Check: `./mvnw -q -B dependency:tree -Dincludes=io.opentelemetry > <scratch>/otel-tree.txt; echo $?` → exit 0 and the file shows exactly one `opentelemetry-api` version (1.62.x) and an `opentelemetry-api-incubator` `1.62.x-alpha`. If 2.28.0-alpha does not resolve or pulls a different API, pick the `2.28.x-alpha` whose pom declares `opentelemetry-api` 1.62 and record it.

- [ ] **Step 2: Failing tests**

`backend/src/test/java/co/scuby/platform/telemetry/TelemetryDefaultsTest.java` — the default (`test`) context:

```java
package co.scuby.platform.telemetry;

import ch.qos.logback.classic.LoggerContext;
import co.scuby.TestcontainersConfiguration;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.resources.Resource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;

import static org.assertj.core.api.Assertions.assertThat;

/** Without the newrelic profile nothing is exported, and logs still reach OpenTelemetry (docs/eng/backend.md · Observability). */
@SpringBootTest(properties = "scuby.test.context=telemetry-defaults") // own cache key: never reuses a context whose logging another class reset
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(TestcontainersConfiguration.class)
class TelemetryDefaultsTest {

    @Autowired Environment env;
    @Autowired Resource resource;

    /** Logging is initialised once per JVM, and a re-initialisation resets the root logger for every cached context. */
    @BeforeAll
    static void reinitialiseLogging() {
        LoggingSystem.get(TelemetryDefaultsTest.class.getClassLoader()).cleanUp();
    }

    @Test
    void exportsAreOffByDefault() {
        assertThat(env.getProperty("management.tracing.export.otlp.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.otlp.metrics.export.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.logging.export.otlp.enabled", Boolean.class)).isFalse();
    }

    @Test
    void identifiesTheServiceAndSamplesEverything() {
        assertThat(resource.getAttribute(AttributeKey.stringKey("service.name"))).isEqualTo("scuby-backend");
        assertThat(resource.getAttribute(AttributeKey.stringKey("deployment.environment"))).isEqualTo("local");
        assertThat(env.getProperty("management.tracing.sampling.probability", Double.class)).isEqualTo(1.0);
    }

    @Test
    void rootLoggerFeedsOpenTelemetry() {
        var root = ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        assertThat(root.getAppender("OTEL")).isNotNull();
        assertThat(root.getAppender("OTEL").isStarted()).isTrue();
    }
}
```

If Boot 4.1.2 exposes no `Resource` bean, look in `spring-boot-opentelemetry-4.1.2.jar` for the auto-configuration that builds the resource and assert through what it exposes; record the change. Do not fall back to reading the yaml strings back — the point is that the attributes bind.

`backend/src/test/java/co/scuby/platform/telemetry/ServerTelemetryTest.java` — a real `staging` context (exports forced off so nothing leaves the machine):

```java
package co.scuby.platform.telemetry;

import co.scuby.TestcontainersConfiguration;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.resources.Resource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.logging.LoggingInitializationContext;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

/** What the staging/prod groups switch on: New Relic export settings and the WARN-and-up JSON console (decision #38). */
@SpringBootTest(properties = {
        "NEW_RELIC_LICENSE_KEY=test-not-a-key",
        "management.tracing.export.otlp.enabled=false",
        "management.otlp.metrics.export.enabled=false",
        "management.logging.export.otlp.enabled=false"
})
@ActiveProfiles("staging")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@Import(TestcontainersConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class ServerTelemetryTest {

    private static final Logger log = LoggerFactory.getLogger(ServerTelemetryTest.class);

    @Autowired Environment env;
    @Autowired Resource resource;

    /** Logging is initialised once per JVM, and a re-initialisation resets the root logger for every cached context. */
    @BeforeAll
    static void reinitialiseLogging() {
        LoggingSystem.get(ServerTelemetryTest.class.getClassLoader()).cleanUp();
    }

    /** Gives later classes that reuse cached contexts the plain INFO console back (their OTEL appender stays detached; only TelemetryDefaultsTest asserts it, in its own context). */
    @AfterAll
    static void restoreDefaultLogging() {
        LoggingSystem logging = LoggingSystem.get(ServerTelemetryTest.class.getClassLoader());
        logging.cleanUp();
        logging.beforeInitialize();
        logging.initialize(new LoggingInitializationContext(new StandardEnvironment()), null, null);
    }

    @Test
    void stagingSendsToNewRelicAsStaging() {
        assertThat(resource.getAttribute(AttributeKey.stringKey("deployment.environment"))).isEqualTo("staging");
        assertThat(env.getProperty("management.otlp.metrics.export.url")).isEqualTo("https://otlp.nr-data.net:4318/v1/metrics");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.endpoint")).isEqualTo("https://otlp.nr-data.net:4318/v1/traces");
        assertThat(env.getProperty("management.opentelemetry.logging.export.otlp.endpoint")).isEqualTo("https://otlp.nr-data.net:4318/v1/logs");
        assertThat(env.getProperty("management.opentelemetry.tracing.export.otlp.headers.api-key")).isEqualTo("test-not-a-key");
    }

    @Test
    void prodGetsTheSameProfiles() {
        assertThat(env.getProperty("spring.profiles.group.prod")).contains("newrelic").contains("server");
    }

    @Test
    void consoleCarriesOnlyWarnAndUpAsJson(CapturedOutput output) {
        log.info("telemetry-probe-info");
        log.warn("telemetry-probe-warn");

        assertThat(output.getOut()).doesNotContain("telemetry-probe-info");
        String line = Arrays.stream(output.getOut().split("\n"))
                .filter(l -> l.contains("telemetry-probe-warn"))
                .findFirst().orElseThrow();
        JsonNode json = JsonMapper.builder().build().readTree(line);
        assertThat(json.path("log").path("level").asString()).isEqualTo("WARN");
        assertThat(json.path("message").asString()).isEqualTo("telemetry-probe-warn");
    }
}
```

Never print the header values in assertion messages or logs (it is a fake key here, but keep the habit).

Run `./mvnw -q -B test -Dtest='TelemetryDefaultsTest,ServerTelemetryTest'` → RED (missing dependency/properties; console not filtered).

- [ ] **Step 3: Configuration**

Merge into `application.yml` under the existing top-level `spring:` and `management:` keys (do not duplicate keys; keep the existing `management.endpoints` block):

```yaml
spring:
  profiles:
    group:
      staging: newrelic, server
      prod: newrelic, server

management:
  opentelemetry:
    resource-attributes:
      service.name: scuby-backend
      deployment.environment: local
  tracing:
    sampling:
      probability: 1.0   # Boot's default is 0.1; decision #38 starts at 100% (lower via MANAGEMENT_TRACING_SAMPLING_PROBABILITY)
    export:
      otlp:
        enabled: false
  otlp:
    metrics:
      export:
        enabled: false
  logging:
    export:
      otlp:
        enabled: false
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
```

Keep the group values scalar strings (a YAML list makes `spring.profiles.group.prod` unreadable as one property).

`application-newrelic.yml`:

```yaml
# Telemetry to New Relic (US) — decision #38. On in staging and prod (profile groups), on a laptop with
# SPRING_PROFILES_ACTIVE=local,newrelic. The key is newrelic.license-key on servers (Parameter Store,
# docs/eng/infra.md · Secrets) or NEW_RELIC_LICENSE_KEY on a laptop (from the Keychain); never in a file.
management:
  tracing:
    export:
      otlp:
        enabled: true
  opentelemetry:
    tracing:
      export:
        otlp:
          endpoint: https://otlp.nr-data.net:4318/v1/traces
          headers:
            api-key: ${newrelic.license-key:${NEW_RELIC_LICENSE_KEY}}
    logging:
      export:
        otlp:
          endpoint: https://otlp.nr-data.net:4318/v1/logs
          headers:
            api-key: ${newrelic.license-key:${NEW_RELIC_LICENSE_KEY}}
  logging:
    export:
      otlp:
        enabled: true
  otlp:
    metrics:
      export:
        enabled: true
        url: https://otlp.nr-data.net:4318/v1/metrics
        headers:
          api-key: ${newrelic.license-key:${NEW_RELIC_LICENSE_KEY}}
        aggregation-temporality: delta
        histogram-flavor: base2_exponential_bucket_histogram
        step: 60s
```

`application-server.yml`:

```yaml
# Every server (staging, prod): stdout is the crash record — WARN and up, as JSON (docs/eng/infra.md · Logs).
# INFO goes to New Relic through the newrelic profile.
logging:
  structured:
    format:
      console: ecs
  threshold:
    console: WARN
```

`application-staging.yml` / `application-prod.yml` (keep the existing comment line):

```yaml
management:
  opentelemetry:
    resource-attributes:
      deployment.environment: staging   # prod in application-prod.yml
```

**Do not create `logback-spring.xml`.** `OpenTelemetryLogbackInstaller.java`:

```java
package co.scuby.platform.telemetry;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/**
 * Sends every log record to Spring Boot's OpenTelemetry SDK (exported only with the newrelic profile).
 * Attached in code, not in logback-spring.xml, so Boot keeps its default console — the only one that
 * honours logging.structured.format.console. Lines logged before this bean exists reach stdout only.
 */
@Component
class OpenTelemetryLogbackInstaller implements InitializingBean, DisposableBean {

    private static final String APPENDER_NAME = "OTEL";

    private final OpenTelemetry openTelemetry;

    OpenTelemetryLogbackInstaller(OpenTelemetry openTelemetry) {
        this.openTelemetry = openTelemetry;
    }

    @Override
    public void afterPropertiesSet() {
        Logger root = rootLogger();
        detach(root);
        OpenTelemetryAppender appender = new OpenTelemetryAppender();
        appender.setName(APPENDER_NAME);
        appender.setContext(root.getLoggerContext());
        appender.setCaptureCodeAttributes(false);
        appender.setOpenTelemetry(openTelemetry);
        appender.start();
        root.addAppender(appender);
    }

    @Override
    public void destroy() {
        detach(rootLogger());
    }

    private static Logger rootLogger() {
        return ((LoggerContext) LoggerFactory.getILoggerFactory()).getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
    }

    private static void detach(Logger root) {
        var existing = root.getAppender(APPENDER_NAME);
        if (existing != null) {
            root.detachAppender(existing);
            existing.stop();
        }
    }
}
```

If a property name in this step does not bind in Boot 4.1.2, check `META-INF/spring-configuration-metadata.json` in `spring-boot-opentelemetry-4.1.2.jar`, `spring-boot-micrometer-metrics-4.1.2.jar` and `spring-boot-micrometer-tracing-opentelemetry-4.1.2.jar` and use the names found there. Record any change.

- [ ] **Step 4: GREEN** — the two tests pass. Then the full suite `./mvnw -q -B verify` is green with **33** tests (27 + 3 + 3; record what surefire reports), and **again** with `-Dsurefire.runOrder=alphabetical` and with `-Dsurefire.runOrder=reversealphabetical` (the default filesystem order is neither guaranteed; the logging re-initialisation must not depend on class order or leak the JSON console into later classes). Output pristine: no OTLP connection errors (exports are off in `test`), and no JSON console lines from classes that run after `ServerTelemetryTest`.

- [ ] **Step 5: Commit** — one commit, tests included: `feat: OpenTelemetry to New Relic behind the newrelic profile; servers log WARN-and-up JSON to stdout`.

---

### Task 2: Real data in New Relic, and the names the dashboard will use

**Files:** Create `infra/scripts/nr-query.sh`. No backend changes (except `fix:` commits if a signal is missing).

- [ ] **Step 1: `infra/scripts/nr-query.sh`**

```bash
#!/usr/bin/env bash
# Runs one NRQL query against Scuby's New Relic account through NerdGraph and prints the results JSON.
# Usage: bash infra/scripts/nr-query.sh "SELECT count(*) FROM Span WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
# The User API key comes from the macOS Keychain and reaches curl through stdin, never through argv.
set -euo pipefail
ACCOUNT_ID=8675334
NRQL=${1:?usage: nr-query.sh "<NRQL>"}

KEY="$(perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-user-api-key -w)"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
chmod 600 "$BODY"
python3 -I -c '
import json, sys
query = "query($account: Int!, $nrql: Nrql!) { actor { account(id: $account) { nrql(query: $nrql) { results } } } }"
json.dump({"query": query, "variables": {"account": int(sys.argv[1]), "nrql": sys.argv[2]}}, open(sys.argv[3], "w"))
' "$ACCOUNT_ID" "$NRQL" "$BODY"

printf 'header = "API-Key: %s"\n' "$KEY" \
  | curl -sS --fail-with-body -K - https://api.newrelic.com/graphql \
      -H 'Content-Type: application/json' --data-binary @"$BODY" \
  | python3 -I -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except ValueError:
    sys.stderr.write(raw[:2000] + "\n")
    sys.exit(2)
e = d.get("errors")
print(json.dumps(e if e else d["data"]["actor"]["account"]["nrql"]["results"], indent=1))
sys.exit(1 if e else 0)'
```

Smoke-check: `bash infra/scripts/nr-query.sh "SELECT count(*) FROM NrMTDConsumption SINCE 1 day ago"` returns a JSON list (any count), exit 0.

- [ ] **Step 2: Run the backend locally with export on** — its own database container and ports; nothing shared with other sessions. One Bash call:

```bash
set -euo pipefail
WT=/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability
SCRATCH=<scratch>
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH
for p in 15433 18080; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
docker run -d --rm --name scuby-obs-pg -p 127.0.0.1:15433:5432 \
  -e POSTGRES_DB=scuby -e POSTGRES_USER=scuby -e POSTGRES_PASSWORD=scuby scuby/postgres:17 >/dev/null
trap 'docker stop scuby-obs-pg >/dev/null 2>&1 || true' ERR
for i in $(seq 1 60); do docker exec scuby-obs-pg pg_isready -h 127.0.0.1 -U scuby -d scuby >/dev/null 2>&1 && break; sleep 1; done
docker exec scuby-obs-pg pg_isready -h 127.0.0.1 -U scuby -d scuby
cd "$WT/backend" && ./mvnw -q -B -DskipTests package
JAR=$(ls target/scuby-backend-*.jar | grep -v plain | head -1)
NEW_RELIC_LICENSE_KEY="$(perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-license-key -w)" \
SPRING_PROFILES_ACTIVE=local,newrelic SERVER_PORT=18080 \
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:15433/scuby \
  nohup java -jar "$JAR" > "$SCRATCH/obs-run.log" 2>&1 &
echo $! > "$SCRATCH/obs.pid"
for i in $(seq 1 90); do curl -sf localhost:18080/actuator/health >/dev/null && break; sleep 2; done
curl -sf localhost:18080/actuator/health
```

(The key lives in the Java process's environment — readable only by this user's processes; acceptable on the laptop. `obs-run.log` never contains it: the exporters do not log headers at INFO.) With `local,newrelic` the console stays plain text at INFO — the `server` profile is not active locally. If the backend has stopped by the next call (`kill -0 "$(cat <scratch>/obs.pid)"` fails) without an error in `obs-run.log`, start the `java -jar` line with the Bash tool's `run_in_background` instead of `nohup … &`.

Generate traffic for ~3 minutes (one call): 200 × `curl -s localhost:18080/actuator/health`, 100 × `curl -s localhost:18080/no/such/route` (404s through the error envelope), spread with short sleeps.

- [ ] **Step 3: Verify with NRQL** (data arrives within ~1–2 minutes; retry for up to 5):

```bash
bash infra/scripts/nr-query.sh "SELECT count(*) FROM Span WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT count(*) FROM Log WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT keyset() FROM Log WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT uniques(metricName) FROM Metric WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT keyset() FROM Metric WHERE metricName = 'http.server.requests' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT average(http.server.requests), percentile(http.server.requests, 95) FROM Metric WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT uniques(deployment.environment) FROM Metric WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT keyset() FROM NrMTDConsumption SINCE 1 day ago"
bash infra/scripts/nr-query.sh "SELECT uniques(productLine) FROM NrMTDConsumption SINCE 1 day ago"
```

Expected: Span count > 0, Log count > 0 (startup INFO lines after the installer, request-time lines), the metric list includes HTTP, JVM and HikariCP meters, `deployment.environment` is `local`, the latency values are milliseconds-sized (a health check is a few ms, not 0.00x). Logs written during a request carry the trace (backend.md · Observability: "with `trace_id`/`span_id`"): `SELECT count(*) FROM Log WHERE service.name = 'scuby-backend' AND trace.id IS NOT NULL SINCE 30 minutes ago` → > 0. Startup lines legitimately have none; if the traffic wrote no log line inside a request at all (`SELECT count(*) FROM Log ... SINCE 30 minutes ago FACET logger.name` shows only startup loggers), record "trace correlation not verifiable with this traffic" instead of a failure — a 0 when request-time lines exist is a `fix:` item (the appender reads `Context.current()`). **Save to the report:** the metric-name list, the `http.server.requests` attribute keys (status may be `status` or `http.response.status_code`, route `uri` or `http.route`), the Log attribute keys (level and logger name), and the `NrMTDConsumption` attributes and `productLine` values (a new account may have no rows yet — record that, it is not a failure). Task 3 writes NRQL against exactly these names. If a signal is missing, diagnose from `obs-run.log` and fix Task 1's config in a `fix:` commit.

- [ ] **Step 4: Stop** only what Step 2 started: `kill "$(cat <scratch>/obs.pid)"`, wait up to 30 s until `lsof -nP -iTCP:18080 -sTCP:LISTEN` is empty (then `kill -9` that same PID only), then `docker stop scuby-obs-pg` (started with `--rm`, so its anonymous volume goes too).

- [ ] **Step 5: Commit** — `feat: query New Relic from the command line (NRQL through NerdGraph)`.

---

### Task 3: Dashboard and alerts as Terraform, applied

**Files:** Create `infra/terraform/observability/{versions.tf,variables.tf,dashboard.tf,alerts.tf,outputs.tf,apply.sh}` and the root `.gitignore`.

**Interfaces:** Consumes the names recorded in Task 2. The NRQL below assumes Micrometer's names (`http.server.requests` with `status`/`uri`, `jvm.memory.used` with `area`/`id`, `jvm.gc.pause`, `jvm.threads.live`, `hikaricp.connections.active`/`.pending`), log attributes `level`/`logger.name`, milliseconds, and `NrMTDConsumption.productLine = 'DataPlatform'` — **replace names and attributes with what Task 2 found; keep the units and thresholds in milliseconds.**

- [ ] **Step 1: root `.gitignore`** — the repo has none; create it:

```gitignore
# Observability Terraform: local state until staging's S3 backend exists (infra/terraform/observability/README.md)
infra/terraform/observability/.terraform/
infra/terraform/observability/*.tfstate
infra/terraform/observability/*.tfstate.*
infra/terraform/observability/.terraform.tfstate.lock.info
infra/terraform/observability/*.tfplan
infra/terraform/observability/crash.log
```

- [ ] **Step 2: `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.15.0"
  required_providers {
    newrelic = { source = "newrelic/newrelic", version = "~> 3.101" }
  }
  # Local state (git-ignored) until staging's S3 state bucket exists.
}

# Only the User API key comes from the environment (NEW_RELIC_API_KEY, from the Keychain — apply.sh).
provider "newrelic" {
  account_id = var.account_id
  region     = "US"
}
```

- [ ] **Step 3: `variables.tf`**

```hcl
variable "account_id" {
  type    = number
  default = 8675334
}

variable "service_name" {
  type    = string
  default = "scuby-backend"
}

variable "alert_environments" {
  description = "deployment.environment values the alerts watch. Laptop runs (local) never page."
  type        = list(string)
  default     = ["staging", "prod"]
}

variable "alert_email" {
  type    = string
  default = "scubydev@gmail.com"
}

variable "no_data_alert_enabled" {
  description = "Off until a backend runs continuously (staging); otherwise it fires all day."
  type        = bool
  default     = false
}
```

- [ ] **Step 4: `dashboard.tf`** — every query filters on the dashboard's `env` variable (default staging and prod; pick `local` in the UI to see laptop runs):

```hcl
locals {
  svc       = "service.name = '${var.service_name}'"
  dash_env  = "deployment.environment IN ({{env}})"
  alert_env = "deployment.environment IN (${join(", ", [for e in var.alert_environments : "'${e}'"])})"
}

resource "newrelic_one_dashboard" "backend" {
  name        = "Scuby — Backend"
  permissions = "public_read_write" # every user of the account (both engineers); not public on the internet

  variable {
    name                 = "env"
    title                = "Environment"
    type                 = "enum"
    replacement_strategy = "string"
    is_multi_selection   = true
    default_values       = ["staging", "prod"]
    item {
      title = "staging"
      value = "staging"
    }
    item {
      title = "prod"
      value = "prod"
    }
    item {
      title = "local"
      value = "local"
    }
  }

  page {
    name = "HTTP"
    widget_line {
      title  = "Requests per minute"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT rate(count(http.server.requests), 1 minute) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "Latency p50 / p95 (ms)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT percentile(http.server.requests, 50, 95) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "Server errors (5xx) per minute"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT rate(filter(count(http.server.requests), WHERE status LIKE '5%'), 1 minute) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_table {
      title  = "By route and status"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT count(http.server.requests), percentile(http.server.requests, 95) FROM Metric WHERE ${local.svc} AND ${local.dash_env} FACET uri, status LIMIT 50" }
    }
  }

  page {
    name = "JVM and database"
    widget_line {
      title  = "Heap used by pool (MB)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT average(jvm.memory.used) / 1e6 FROM Metric WHERE ${local.svc} AND ${local.dash_env} AND area = 'heap' FACET id TIMESERIES" }
    }
    widget_line {
      title  = "GC pause (ms, max)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT max(jvm.gc.pause) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "Live threads"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT latest(jvm.threads.live) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "DB connections (active / pending)"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(hikaricp.connections.active), latest(hikaricp.connections.pending) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
  }

  page {
    name = "Logs and usage"
    widget_bar {
      title  = "WARN and ERROR by logger (24 h)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT count(*) FROM Log WHERE ${local.svc} AND ${local.dash_env} AND level IN ('WARN', 'ERROR') FACET logger.name SINCE 1 day ago LIMIT 20" }
    }
    widget_billboard {
      title  = "Data ingested this month (GB of 100 free)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(GigabytesIngested) FROM NrMTDConsumption WHERE productLine = 'DataPlatform' SINCE 1 day ago" }
    }
  }
}
```

- [ ] **Step 5: `alerts.tf`**

```hcl
resource "newrelic_alert_policy" "backend" {
  name                = "scuby-backend"
  incident_preference = "PER_CONDITION"
}

# A count, not a rate: at launch volume one 500 out of two requests would be a 50% "error rate".
resource "newrelic_nrql_alert_condition" "server_errors" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "More than 5 server errors in 5 minutes"
  type                         = "static"
  aggregation_window           = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT filter(count(http.server.requests), WHERE status LIKE '5%') FROM Metric WHERE ${local.svc} AND ${local.alert_env}"
  }
  critical {
    operator              = "above"
    threshold             = 5
    threshold_duration    = 300
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "latency_p95" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "p95 latency above 1 s"
  type                         = "static"
  aggregation_window           = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT percentile(http.server.requests, 95) FROM Metric WHERE ${local.svc} AND ${local.alert_env}"
  }
  critical {
    operator              = "above"
    threshold             = 1000 # milliseconds
    threshold_duration    = 600
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "no_data" {
  policy_id                      = newrelic_alert_policy.backend.id
  name                           = "Backend sends no data"
  enabled                        = var.no_data_alert_enabled
  type                           = "static"
  aggregation_window             = 300
  violation_time_limit_seconds   = 86400
  expiration_duration            = 900
  open_violation_on_expiration   = true
  close_violations_on_expiration = false
  nrql {
    query = "SELECT count(*) FROM Metric WHERE ${local.svc} AND ${local.alert_env}"
  }
  critical {
    operator              = "below"
    threshold             = 1
    threshold_duration    = 900
    threshold_occurrences = "all"
  }
}

# NrMTDConsumption arrives about hourly, so windows close on a timer (20 min after the hourly point),
# not on the next event. max() equals latest() here: the month-to-date value only grows within a month.
resource "newrelic_nrql_alert_condition" "monthly_ingest" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "New Relic ingest this month above 50 / 80 GB"
  type                         = "static"
  aggregation_method           = "event_timer"
  aggregation_timer            = 1200
  aggregation_window           = 3600
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT max(GigabytesIngested) FROM NrMTDConsumption WHERE productLine = 'DataPlatform'"
  }
  warning {
    operator              = "above"
    threshold             = 50
    threshold_duration    = 3600
    threshold_occurrences = "at_least_once"
  }
  critical {
    operator              = "above"
    threshold             = 80
    threshold_duration    = 3600
    threshold_occurrences = "at_least_once"
  }
}

resource "newrelic_notification_destination" "email" {
  name = "scuby email"
  type = "EMAIL"
  property {
    key   = "email"
    value = var.alert_email
  }
}

resource "newrelic_notification_channel" "email" {
  name           = "scuby email"
  type           = "EMAIL"
  destination_id = newrelic_notification_destination.email.id
  product        = "IINT"
  property {
    key   = "subject"
    value = "Scuby: {{issueTitle}}"
  }
}

resource "newrelic_workflow" "backend" {
  name                  = "scuby-backend to email"
  muting_rules_handling = "NOTIFY_ALL_ISSUES"
  issues_filter {
    name = "scuby-backend policy"
    type = "FILTER"
    predicate {
      attribute = "labels.policyIds"
      operator  = "EXACTLY_MATCHES"
      values    = [newrelic_alert_policy.backend.id]
    }
  }
  destination {
    channel_id = newrelic_notification_channel.email.id
  }
}
```

If the provider or NerdGraph rejects an argument (aggregation limits, `threshold_occurrences` values, the dashboard variable), fix it to what the error says and record it.

- [ ] **Step 6: `outputs.tf`**

```hcl
output "dashboard_url" { value = newrelic_one_dashboard.backend.permalink }
output "policy_id" { value = newrelic_alert_policy.backend.id }
```

- [ ] **Step 7: `apply.sh`** — the one way to apply (any `-var` arguments are passed through to `plan`):

```bash
#!/usr/bin/env bash
# Applies Scuby's New Relic dashboard and alerts (README.md). The User API key goes from the Keychain
# into this process's environment only; the plan file is deleted on exit.
set -euo pipefail
cd "$(dirname "$0")"
NEW_RELIC_API_KEY="$(perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-user-api-key -w)"
export NEW_RELIC_API_KEY
trap 'rm -f obs.tfplan' EXIT
terraform fmt -check -diff
terraform init -input=false
terraform validate
terraform plan -input=false -out=obs.tfplan "$@"
terraform apply -input=false obs.tfplan
terraform output
```

Run `terraform fmt` once on the directory before the first apply (so `fmt -check` passes), then `bash infra/terraform/observability/apply.sh`. Read the full output. Expected: validate `Success!`; `Apply complete! Resources: 9 added`; `dashboard_url` printed. `git status` shows no state or plan files. If apply fails partway, the created resources are already in local state: fix the rejected argument and re-run `apply.sh` (it plans only the remainder). Offline check without the key: `NEW_RELIC_API_KEY=dummy terraform validate` (validation makes no API call).

- [ ] **Step 8: Verify** — re-run Task 2 Step 2 (own container, ports 15433/18080) for ~5 minutes of traffic, then run each dashboard widget's NRQL through `nr-query.sh` with `{{env}}` replaced by `'local'` and `SINCE 30 minutes ago`. Expect data for requests, latency, route table, heap, GC, threads and DB connections. **Expected empty:** the 5xx widget and the WARN/ERROR widget (the traffic makes no 5xx and no WARN), and possibly the ingest billboard on a new account — record them as expected-empty, not failures. Run each alert condition's NRQL with `'local'` in place of the environment list and record the value it would see. Stop the backend and the container as in Task 2 Step 4.

- [ ] **Step 9: Commit** — `feat: New Relic dashboard and alerts as Terraform — HTTP, JVM, database, logs, ingest budget` (include `.terraform.lock.hcl`, `apply.sh` and `.gitignore`; never state or plans).

---

### Task 4: Docs

Each fact goes in its owning doc; the READMEs link to them rather than restate.

- [ ] **Step 1: `docs/eng/backend.md` · Environments and profiles** — after the table, add: the `newrelic` profile (the three OTLP exports to New Relic; usable as `local,newrelic`) and the `server` profile (ECS JSON console at WARN), both pulled in by the `staging` and `prod` groups; sampling is `management.tracing.sampling.probability` (1.0 to start). Link to · Observability for the why.
- [ ] **Step 2: `docs/eng/infra.md` · Secrets** — add the parameter `/scuby/<env>/newrelic/license-key` (imported as property `newrelic.license-key`; on a laptop the env var `NEW_RELIC_LICENSE_KEY` from the Keychain). **· Observability as code** — append: "Applied to account 8675334: dashboard «Scuby — Backend», policy `scuby-backend` emailing scubydev@gmail.com; conditions watch `deployment.environment` staging and prod only; the no-data condition is off until staging runs continuously. Apply with `infra/terraform/observability/apply.sh`. State is local to the operator's machine and git-ignored until staging's S3 state bucket exists; then it moves to that backend."
- [ ] **Step 3: `docs/eng/costs.md`** — Fixed monthly: a New Relic row ($0 inside 100 GB/month free; beyond that per-GB pricing — mark it approximate and to be re-verified, with today's date) and a CloudWatch Logs row ($0 inside 5 GB/month; WARN-and-up only). Spend triggers: "New Relic ingest at 50 / 80 GB in a month → the usage alert emails (infra/terraform/observability); lower trace sampling first."
- [ ] **Step 4: `backend/README.md`** — section `## Telemetría` (Spanish, short): exports off in `local`/`test`; how to send real data from the laptop (Task 2 Step 2's sequence, with the Keychain lookup and its own container and ports); where to look (dashboard name, `infra/scripts/nr-query.sh`); servers turn it on through the `staging`/`prod` groups — link to backend.md · Environments and profiles and infra.md · Secrets instead of restating.
- [ ] **Step 5: `infra/terraform/observability/README.md`** (Spanish): what it manages (dashboard, policy, four conditions, email destination/channel/workflow); how to apply (`bash apply.sh`, `-var no_data_alert_enabled=true` once staging runs continuously; offline check `NEW_RELIC_API_KEY=dummy terraform validate`); what to do if the local state is lost (`terraform import` of each resource by ID/GUID, or delete the duplicates in the UI). For where state lives and which environments alert, link to infra.md · Observability as code instead of restating.
- [ ] **Step 6:** link check over changed docs (exclude `docs/superpowers` and `.superpowers`), then commit `doc: how to send and read telemetry; observability as code applied`.
- [ ] **Step 7: Report** — `<scratch>/observability-report.md` (Spanish): per task outcome and commits, the metric names and attribute keys found, NRQL results per widget and condition, the dashboard URL, deviations, follow-ups (below).

## Not in this plan (and why)

- **CloudWatch side of #38** (`awslogs` driver, log group, `IncomingBytes` alarm): infrastructure — the sandbox plan ships the first two; staging gets all three.
- **Sentry in the backend:** separate small task.
- **Copying the license key to SSM and importing the prefix at start-up:** when staging exists (`aws ssm put-parameter` from the Keychain value, by the human; the loader is backend work).
- **Sandbox compose after merge:** the sandbox backend container needs `SCUBY_ENVIRONMENT`, `SCUBY_TELEMETRY_EXPORT=true`, `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`, `LOGGING_THRESHOLD_CONSOLE=WARN` plus the license key. Without `SCUBY_TELEMETRY_EXPORT=true` it simply exports nothing (it no longer fails at boot). The key reaches the container the way the database password does, never printed: a SecureString parameter `/scuby/<env>/newrelic/license-key`, read **on the instance** by `infra/scripts/sandbox-deploy.sh` into the `umask 077` `.env` (the SSM command carries only the parameter name), and `NEW_RELIC_LICENSE_KEY: ${NEW_RELIC_LICENSE_KEY}` in the backend's `environment` in `infra/compose/sandbox/compose.yaml`. Those files belong to the sandbox branch; the change lands there or at merge. Flag it in the report.
- **Health-check probes as spans:** every `/actuator/health` probe becomes a trace at 100% sampling. Tiny at one probe per 30 s; an observation predicate that skips `/actuator/**` is a follow-up if it shows up in the ingest.
