# Observability (Track C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend emits telemetry as decision #38 says — traces, metrics and INFO logs to New Relic over OTLP; WARN and up as JSON on stdout — verified with real data in the New Relic account, and the New Relic dashboard and alerts exist as Terraform code, applied.

**Architecture:** Spring Boot 4.1's built-in OpenTelemetry support (`spring-boot-starter-opentelemetry`) exports traces and logs; Micrometer's OTLP registry exports metrics. Export is off by default and switched on by a `newrelic` profile, grouped into `staging` and `prod` and usable locally as `local,newrelic`. The console appender is Spring Boot's structured (JSON) one with a WARN threshold in those environments. Dashboards and alerts are a separate Terraform root, `infra/terraform/observability/`, with the `newrelic` provider and local state.

**Tech Stack:** Java 25, Spring Boot 4.1.2 (Jackson 3), Micrometer OTLP registry, OpenTelemetry Logback appender 2.33.1-alpha, Terraform ≥ 1.15, `newrelic/newrelic` provider ~> 3.101, New Relic NerdGraph (curl) for verification.

## Global Constraints

- Read first: `docs/eng/backend.md` · Observability (the table is the spec), `docs/eng/infra.md` · Logs and · Observability as code, `docs/product/00-product-map.md` row #38.
- **Work only in the worktree** `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability`, branch `be/observability`. Never touch the main checkout `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo` (another session runs a plan there) or the other worktree. Write files with absolute paths under the worktree.
- **New Relic:** account **8675334**, region **US**. OTLP base `https://otlp.nr-data.net:4318` (paths `/v1/traces`, `/v1/metrics`, `/v1/logs`), license key in header `api-key`. NerdGraph `https://api.newrelic.com/graphql`, User API key in header `API-Key`.
- **Keys come from the macOS Keychain, only into the environment of the one command that needs them; never print, echo, log, commit or write them to a file:**
  - license: `NEW_RELIC_LICENSE_KEY="$(security find-generic-password -s scuby-newrelic-license-key -w)"`
  - user API key: `NEW_RELIC_API_KEY="$(security find-generic-password -s scuby-newrelic-user-api-key -w)"`
  If `security` prompts or fails, stop with BLOCKED — do not ask for the key in any other way.
- Java: `export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH`; Maven from `<worktree>/backend` via `./mvnw`. Every build needs Docker + local image `scuby/postgres:17` (jOOQ codegen).
- `local` and `test` export nothing. `service.name` is `scuby-backend`; `deployment.environment` is the active environment (`local`, `staging`, `prod`).
- Names: dashboard `Scuby — Backend`; alert policy `scuby-backend`; email destination `scubydev@gmail.com`.
- Terraform state for `infra/terraform/observability/` is **local and git-ignored** (moves to the S3 backend when staging's state bucket exists). Commit `.terraform.lock.hcl`.
- The tool shell is zsh: run scripts with `bash <script>`. Commit prefixes `feat:` `test:` `doc:` `fix:`. **Never push.**
- Stuck rule: 3 honest failures on a step → stop the task, record it in the report, continue with the next task whose inputs exist.

## File map

```
backend/
  pom.xml                                         + spring-boot-starter-opentelemetry, opentelemetry-logback-appender-1.0
  src/main/resources/application.yml              exports off by default; resource attributes; sampling; histograms; profile groups
  src/main/resources/application-newrelic.yml     exports on: endpoints, api-key header, delta temporality
  src/main/resources/logback-spring.xml           Boot's console appender (structured when configured) + OTel appender
  src/main/java/co/scuby/platform/telemetry/OpenTelemetryLogbackInstaller.java   installs the OTel appender
  src/test/java/co/scuby/platform/telemetry/TelemetryDefaultsTest.java
  src/test/java/co/scuby/platform/telemetry/ConsoleLoggingTest.java
  README.md                                       + "Telemetría" section (Spanish)
infra/terraform/observability/
  versions.tf  variables.tf  dashboard.tf  alerts.tf  outputs.tf  README.md (Spanish)
infra/scripts/nr-query.sh                         NRQL through NerdGraph (key from Keychain)
.gitignore                                        + observability state
```

---

### Task 0: Worktree baseline

- [ ] **Step 1:** `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability && git status -sb` → `## be/observability`, clean.
- [ ] **Step 2:** `cd backend && <java export> && ./mvnw -q -B verify` → exit 0. Record the test count from `target/surefire-reports` (expected 27, 0 failures). If red, stop: BLOCKED.

---

### Task 1: The backend emits telemetry the way decision #38 says

**Files:** Modify `backend/pom.xml`, `backend/src/main/resources/application.yml`. Create `application-newrelic.yml`, `logback-spring.xml`, `platform/telemetry/OpenTelemetryLogbackInstaller.java`, the two tests.

**Interfaces:**
- Produces: profile `newrelic` (enables all three OTLP exports; reads env `NEW_RELIC_LICENSE_KEY`); profile groups `staging → newrelic`, `prod → newrelic`; property `scuby.telemetry.trace-sampling` (default `1.0`) mapped to `management.tracing.sampling.probability`.

- [ ] **Step 1: Dependencies** (`pom.xml`; Boot manages the OpenTelemetry/Micrometer versions — do not declare them):

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-opentelemetry</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-logback-appender-1.0</artifactId>
    <version>2.33.1-alpha</version>
</dependency>
```

- [ ] **Step 2: Failing tests**

`backend/src/test/java/co/scuby/platform/telemetry/TelemetryDefaultsTest.java`:

```java
package co.scuby.platform.telemetry;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;

import static org.assertj.core.api.Assertions.assertThat;

/** Without the newrelic profile nothing is exported (docs/eng/backend.md · Observability). */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class TelemetryDefaultsTest {

    @Autowired Environment env;

    @Test
    void exportsAreOffByDefault() {
        assertThat(env.getProperty("management.tracing.export.otlp.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.otlp.metrics.export.enabled", Boolean.class)).isFalse();
        assertThat(env.getProperty("management.logging.export.otlp.enabled", Boolean.class)).isFalse();
    }

    @Test
    void identifiesTheServiceAndSamplesEverythingByDefault() {
        assertThat(env.getProperty("management.opentelemetry.resource-attributes.service.name")).isEqualTo("scuby-backend");
        assertThat(env.getProperty("management.tracing.sampling.probability", Double.class)).isEqualTo(1.0);
    }

    @Test
    void stagingAndProdSwitchNewRelicOn() {
        assertThat(env.getProperty("spring.profiles.group.staging")).contains("newrelic");
        assertThat(env.getProperty("spring.profiles.group.prod")).contains("newrelic");
    }
}
```

`backend/src/test/java/co/scuby/platform/telemetry/ConsoleLoggingTest.java` — the console in staging/prod: WARN and up only, as JSON:

```java
package co.scuby.platform.telemetry;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "logging.structured.format.console=ecs",
        "logging.threshold.console=WARN"
})
@Import(TestcontainersConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class ConsoleLoggingTest {

    private static final Logger log = LoggerFactory.getLogger(ConsoleLoggingTest.class);

    @Test
    void consoleCarriesOnlyWarnAndUpAsJson(CapturedOutput output) {
        log.info("telemetry-probe-info");
        log.warn("telemetry-probe-warn");

        assertThat(output.getOut()).doesNotContain("telemetry-probe-info");
        String line = Arrays.stream(output.getOut().split("\n"))
                .filter(l -> l.contains("telemetry-probe-warn"))
                .findFirst().orElseThrow();
        JsonNode json = JsonMapper.builder().build().readTree(line);
        assertThat(json.path("log.level").asText()).isEqualTo("WARN");
        assertThat(json.path("message").asText()).isEqualTo("telemetry-probe-warn");
    }
}
```

Run `./mvnw -q test -Dtest='TelemetryDefaultsTest,ConsoleLoggingTest'` → RED (properties absent; console not filtered).

- [ ] **Step 3: Configuration**

Append to `application.yml` (merge under the existing top-level keys — `spring:` and `management:` already exist; do not duplicate keys):

```yaml
spring:
  profiles:
    group:
      staging: newrelic
      prod: newrelic

management:
  opentelemetry:
    resource-attributes:
      service.name: scuby-backend
      deployment.environment: ${SCUBY_ENV:local}
  tracing:
    sampling:
      probability: ${scuby.telemetry.trace-sampling:1.0}
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

`application-newrelic.yml`:

```yaml
# Telemetry to New Relic (US) — decision #38. On in staging and prod (profile groups), locally with
# SPRING_PROFILES_ACTIVE=local,newrelic. NEW_RELIC_LICENSE_KEY comes from SSM (servers) or the
# Keychain (laptop); it is never written to a file.
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
            api-key: ${NEW_RELIC_LICENSE_KEY}
    logging:
      export:
        otlp:
          endpoint: https://otlp.nr-data.net:4318/v1/logs
          headers:
            api-key: ${NEW_RELIC_LICENSE_KEY}
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
          api-key: ${NEW_RELIC_LICENSE_KEY}
        aggregation-temporality: delta
        histogram-flavor: base2_exponential_bucket_histogram
        step: 60s

# Servers: stdout is the crash record — WARN and up, as JSON (docs/eng/infra.md · Logs).
logging:
  structured:
    format:
      console: ecs
  threshold:
    console: WARN
```

`logback-spring.xml` — keep Spring Boot's console appender (it honours `logging.structured.format.console` and `logging.threshold.console`) and add the OpenTelemetry appender:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <include resource="org/springframework/boot/logging/logback/defaults.xml"/>
    <include resource="org/springframework/boot/logging/logback/console-appender.xml"/>

    <!-- Log records to OpenTelemetry (exported only when the newrelic profile enables it). -->
    <appender name="OTEL" class="io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender">
        <captureExperimentalAttributes>false</captureExperimentalAttributes>
        <captureCodeAttributes>true</captureCodeAttributes>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="OTEL"/>
    </root>
</configuration>
```

Before relying on it, open the Boot 4.1.2 jar (`~/.m2/repository/org/springframework/boot/spring-boot/4.1.2/spring-boot-4.1.2.jar`) and confirm `org/springframework/boot/logging/logback/console-appender.xml` exists and its CONSOLE appender applies the structured format and the threshold. If Boot moved them, use whatever include Boot provides for the console appender — the test is the judge.

`OpenTelemetryLogbackInstaller.java`:

```java
package co.scuby.platform.telemetry;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/** Connects the Logback OTEL appender (logback-spring.xml) to Spring Boot's OpenTelemetry SDK. */
@Component
class OpenTelemetryLogbackInstaller implements InitializingBean {

    private final OpenTelemetry openTelemetry;

    OpenTelemetryLogbackInstaller(OpenTelemetry openTelemetry) {
        this.openTelemetry = openTelemetry;
    }

    @Override
    public void afterPropertiesSet() {
        OpenTelemetryAppender.install(openTelemetry);
    }
}
```

If the property names in this step do not bind in Boot 4.1.2, check `META-INF/spring-configuration-metadata.json` in `spring-boot-opentelemetry-4.1.2.jar`, `spring-boot-micrometer-metrics-4.1.2.jar` and `spring-boot-micrometer-tracing-opentelemetry-4.1.2.jar` (they list `management.opentelemetry.tracing.export.otlp.*`, `management.opentelemetry.logging.export.otlp.*`, `management.otlp.metrics.export.*`, `management.tracing.export.otlp.enabled`, `management.logging.export.otlp.enabled`) and use the names found there. Record any change.

- [ ] **Step 4: GREEN** — the two tests pass; then the full suite `./mvnw -q -B verify` stays green with pristine output (no OTLP connection errors in `test`: exports are off).

- [ ] **Step 5: Commit** — `test: telemetry is off by default and the server console is WARN-and-up JSON` (tests), then `feat: OpenTelemetry to New Relic behind the newrelic profile; JSON console at WARN on servers` (the rest).

---

### Task 2: Real data in New Relic, and the metric names the dashboard will use

**Files:** Create `infra/scripts/nr-query.sh`. No backend changes.

- [ ] **Step 1: `infra/scripts/nr-query.sh`**

```bash
#!/usr/bin/env bash
# Runs one NRQL query against Scuby's New Relic account through NerdGraph and prints the results JSON.
# Usage: nr-query.sh "SELECT count(*) FROM Span WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
set -euo pipefail
ACCOUNT_ID=8675334
NRQL=$1
KEY="$(security find-generic-password -s scuby-newrelic-user-api-key -w)"
BODY=$(python3 -I -c 'import json,sys; print(json.dumps({"query": "{ actor { account(id: %s) { nrql(query: %s) { results } } } }" % (sys.argv[1], json.dumps(sys.argv[2]))}))' "$ACCOUNT_ID" "$NRQL")
curl -sS https://api.newrelic.com/graphql -H 'Content-Type: application/json' -H "API-Key: $KEY" -d "$BODY" \
  | python3 -I -c 'import json,sys; d=json.load(sys.stdin); e=d.get("errors"); print(json.dumps(e if e else d["data"]["actor"]["account"]["nrql"]["results"], indent=1))'
```

- [ ] **Step 2: Run the backend locally with export on** (background; it keeps running for a few minutes):

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability/backend
docker compose up -d --wait
<java export>
NEW_RELIC_LICENSE_KEY="$(security find-generic-password -s scuby-newrelic-license-key -w)" \
SCUBY_ENV=local SPRING_PROFILES_ACTIVE=local,newrelic \
nohup ./mvnw -q spring-boot:run > /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/obs-run.log 2>&1 &
```

Wait until `curl -sf localhost:8080/actuator/health` answers, then generate traffic for ~3 minutes: 200 × `/actuator/health`, 100 × `/no/such/route` (404s through the error envelope). Note: the console now shows only WARN+ JSON (that is correct with `newrelic` on).

- [ ] **Step 3: Verify with NRQL** (data arrives within ~1–2 minutes; retry for up to 5):

```bash
bash infra/scripts/nr-query.sh "SELECT count(*) FROM Span WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT count(*) FROM Log WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT uniques(metricName) FROM Metric WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
bash infra/scripts/nr-query.sh "SELECT keyset() FROM Metric WHERE metricName = 'http.server.requests' SINCE 30 minutes ago"
```

Expected: Span count > 0, Log count > 0 (startup INFO lines), a metric-name list including the HTTP, JVM and HikariCP meters. **Save the metric-name list and the `http.server.requests` attribute keys to the report** — Task 3 writes NRQL against exactly these names (e.g. the status attribute may be `status` or `http.response.status_code`; the unit may be seconds or milliseconds — check with `SELECT average(http.server.requests) ...`). If any of the three signals is missing, diagnose (startup log in `obs-run.log`, the exporter's warnings) and fix Task 1's config (`fix:` commit).

- [ ] **Step 4: Stop** the backend (`pkill -f 'spring-boot:run'` scoped to this worktree's process; check with `pgrep -fl spring-boot`) and `docker compose down`.

- [ ] **Step 5: Commit** — `feat: query New Relic from the command line (NRQL through NerdGraph)`.

---

### Task 3: Dashboard and alerts as Terraform, applied

**Files:** Create `infra/terraform/observability/{versions.tf,variables.tf,dashboard.tf,alerts.tf,outputs.tf}`; modify root `.gitignore`.

**Interfaces:** Consumes the metric names and attribute keys recorded in Task 2. The NRQL below assumes Micrometer's names (`http.server.requests` with `status`/`uri`/`method`, `jvm.memory.used` with `area`, `jvm.gc.pause`, `jvm.threads.live`, `hikaricp.connections.active`/`.pending`) and seconds — **replace names, attributes and the latency unit with what Task 2 found.**

- [ ] **Step 1: `.gitignore`** — append:

```gitignore
infra/terraform/observability/.terraform/
infra/terraform/observability/*.tfstate
infra/terraform/observability/*.tfstate.*
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

# Credentials from the environment: NEW_RELIC_API_KEY (User key, from the Keychain),
# NEW_RELIC_ACCOUNT_ID, NEW_RELIC_REGION — see README.md.
provider "newrelic" {}
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

- [ ] **Step 4: `dashboard.tf`**

```hcl
locals {
  svc = "service.name = '${var.service_name}'"
}

resource "newrelic_one_dashboard" "backend" {
  name        = "Scuby — Backend"
  permissions = "private"

  page {
    name = "HTTP"
    widget_line {
      title  = "Requests per minute"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT rate(count(http.server.requests), 1 minute) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
    widget_line {
      title  = "Latency p50 / p95 (s)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT percentile(http.server.requests, 50, 95) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
    widget_line {
      title  = "Error rate (5xx %)"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT filter(count(http.server.requests), WHERE status LIKE '5%') * 100 / count(http.server.requests) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
    widget_table {
      title  = "By route and status"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT count(http.server.requests), percentile(http.server.requests, 95) FROM Metric WHERE ${local.svc} FACET uri, status LIMIT 50" }
    }
  }

  page {
    name = "JVM and database"
    widget_line {
      title  = "Heap used (MB)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT sum(jvm.memory.used) / 1e6 FROM Metric WHERE ${local.svc} AND area = 'heap' TIMESERIES" }
    }
    widget_line {
      title  = "GC pause (s, max)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT max(jvm.gc.pause) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
    widget_line {
      title  = "Live threads"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT latest(jvm.threads.live) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
    widget_line {
      title  = "DB connections (active / pending)"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(hikaricp.connections.active), latest(hikaricp.connections.pending) FROM Metric WHERE ${local.svc} TIMESERIES" }
    }
  }

  page {
    name = "Logs and usage"
    widget_bar {
      title  = "WARN and ERROR by logger (24 h)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT count(*) FROM Log WHERE ${local.svc} AND level IN ('WARN', 'ERROR') FACET logger.name SINCE 1 day ago LIMIT 20" }
    }
    widget_billboard {
      title  = "Data ingested this month (GB of 100 free)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(GigabytesIngested) FROM NrMTDConsumption SINCE 1 day ago" }
    }
  }
}
```

(The log attribute names `level` and `logger.name` are what the OpenTelemetry Logback appender usually produces in New Relic — confirm with `SELECT keyset() FROM Log WHERE service.name = 'scuby-backend' SINCE 1 hour ago` and adjust.)

- [ ] **Step 5: `alerts.tf`**

```hcl
resource "newrelic_alert_policy" "backend" {
  name                = "scuby-backend"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_nrql_alert_condition" "error_rate" {
  policy_id          = newrelic_alert_policy.backend.id
  name               = "Error rate above 5%"
  type               = "static"
  aggregation_window = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT filter(count(http.server.requests), WHERE status LIKE '5%') * 100 / count(http.server.requests) FROM Metric WHERE service.name = '${var.service_name}'"
  }
  critical {
    operator              = "above"
    threshold             = 5
    threshold_duration    = 300
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "latency_p95" {
  policy_id          = newrelic_alert_policy.backend.id
  name               = "p95 latency above 1 s"
  type               = "static"
  aggregation_window = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT percentile(http.server.requests, 95) FROM Metric WHERE service.name = '${var.service_name}'"
  }
  critical {
    operator              = "above"
    threshold             = 1
    threshold_duration    = 600
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "no_data" {
  policy_id          = newrelic_alert_policy.backend.id
  name               = "Backend sends no data"
  enabled            = var.no_data_alert_enabled
  type               = "static"
  aggregation_window = 300
  violation_time_limit_seconds = 86400
  expiration_duration            = 900
  open_violation_on_expiration   = true
  close_violations_on_expiration = false
  nrql {
    query = "SELECT count(*) FROM Metric WHERE service.name = '${var.service_name}'"
  }
  critical {
    operator              = "below"
    threshold             = 1
    threshold_duration    = 900
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "monthly_ingest" {
  policy_id          = newrelic_alert_policy.backend.id
  name               = "New Relic ingest this month above 50 / 80 GB"
  type               = "static"
  aggregation_window = 3600
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT latest(GigabytesIngested) FROM NrMTDConsumption"
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

If the provider or NerdGraph rejects an argument (e.g. aggregation window limits for the hourly `NrMTDConsumption` event, or `threshold_occurrences` values), fix it to what the error says and record it.

- [ ] **Step 6: `outputs.tf`**

```hcl
output "dashboard_url" { value = newrelic_one_dashboard.backend.permalink }
output "policy_id" { value = newrelic_alert_policy.backend.id }
```

- [ ] **Step 7: Validate, plan, apply**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability/infra/terraform/observability
export NEW_RELIC_ACCOUNT_ID=8675334 NEW_RELIC_REGION=US
export NEW_RELIC_API_KEY="$(security find-generic-password -s scuby-newrelic-user-api-key -w)"
terraform fmt && terraform init -input=false >/dev/null && terraform validate
terraform plan -input=false -out=obs.tfplan | tail -3
terraform apply -input=false obs.tfplan | tail -5
terraform output
rm -f obs.tfplan
unset NEW_RELIC_API_KEY
```

Expected: validate `Success!`; `Apply complete! Resources: 9 added`; `dashboard_url` printed. (`obs.tfplan` must not be committed — it is deleted right after; add `*.tfplan` to the `.gitignore` lines above if `git status` shows it.)

- [ ] **Step 8: Verify** — re-run Task 2 Step 2 for ~5 minutes (backend with `local,newrelic`), then run each dashboard widget's NRQL through `nr-query.sh` with `SINCE 30 minutes ago` and confirm non-empty results for the HTTP, JVM, database and log widgets. Record which widgets return data. Stop the backend and the database afterwards.

- [ ] **Step 9: Commit** — `feat: New Relic dashboard and alerts as Terraform — HTTP, JVM, database, logs, ingest budget` (include `.terraform.lock.hcl`, never state or plans).

---

### Task 4: Docs

- [ ] **Step 1: `backend/README.md`** — add a section `## Telemetría` (Spanish, short): exports are off in `local`/`test`; how to send real data from the laptop (the Task 2 Step 2 command with the Keychain lookup); where to look (dashboard name; `infra/scripts/nr-query.sh`); that staging/prod turn it on through the `newrelic` profile group and read `NEW_RELIC_LICENSE_KEY` from SSM `/scuby/<env>/newrelic/license-key`.
- [ ] **Step 2: `infra/terraform/observability/README.md`** (Spanish): what it manages (dashboard, policy, four conditions, email destination/channel/workflow), how to apply (Task 3 Step 7, with the Keychain), that state is local until the S3 backend exists and what to do if it is lost (`terraform import` of the dashboard by GUID, or delete the duplicates in the UI), and that the no-data alert is off until staging runs continuously (`-var no_data_alert_enabled=true`).
- [ ] **Step 3: `docs/eng/infra.md` · Observability as code** — append one sentence: "Applied to account 8675334: dashboard «Scuby — Backend», policy `scuby-backend` emailing scubydev@gmail.com (no-data condition off until staging runs continuously)."
- [ ] **Step 4:** link check (exclude `docs/superpowers` and `.superpowers`), then commit `doc: how to send and read telemetry; observability as code applied`.
- [ ] **Step 5: Report** — `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/observability-report.md` (Spanish): per task outcome and commits, the metric names and attribute keys found, NRQL results per widget, the dashboard URL, deviations, follow-ups (CloudWatch `IncomingBytes` alarm belongs to staging infra; Sentry wiring is separate; New Relic Browser is the frontend's call).

## Not in this plan (and why)

- **CloudWatch side of #38** (`awslogs` driver, log group, `IncomingBytes` alarm): infrastructure — the sandbox run may include the first two; staging gets all three.
- **Sentry in the backend:** separate small task.
- **Copying the license key to SSM:** when staging exists (`aws ssm put-parameter` from the Keychain value, by the human).
