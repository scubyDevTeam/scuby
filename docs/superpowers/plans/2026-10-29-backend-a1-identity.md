# Backend A1 — Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the backend everything the thin slice's lost-case endpoints will stand on — the slice's dependencies, build-failing guardrails, a test harness that checks the contract and statement counts on every call, feature flags, `supported_countries` + `GET /config`, the device cookie, sessions behind Spring Security 7, email-code and Google sign-in, the SMS phone step — a one-command local run in Docker, plus `backend/CLAUDE.md` and the owning-doc updates.

**Architecture:** Package by feature, flat, package-private by default (`co.scuby.platform`, `co.scuby.identity`; `uploads`, `pets`, `cases` arrive in plan A2). Cross-feature classes carry `@ModuleApi`; ArchUnit enforces the dependency DAG, derivation purity and roles by annotation; PIT mutation-tests every `*Derivation`. Spring Security 7 wiring lives in `platform.security` (domain-free); `identity` plugs in through interfaces (`RequestAuthenticator`, `SecurityRules`) and owns sessions, the device cookie, sign-in and the phone step. Sessions are opaque 256-bit tokens stored as SHA-256 with a 12-month absolute expiry; a session read never writes.

**Tech Stack:** Java 25, Spring Boot 4.1.2 (Spring Framework 7.0.10, Spring Security 7.1.2, Jackson 3.1.7 — `tools.jackson.*`, annotations stay `com.fasterxml.jackson.annotation`), jOOQ 3.21.9 OSS, Flyway 12.4.0, PostgreSQL 17 + PostGIS, Testcontainers 2.0.5, Caffeine 3.2.4 (Boot-managed), libphonenumber 9.0.42, nimbus via `spring-security-oauth2-jose` (Boot-managed), AWS SDK v2 BOM 2.57.6 (S3, used in A2), ArchUnit 1.5.1, PIT 1.30.1 + pitest-junit5-plugin 1.2.3, JUnit Jupiter 6.0.3 (Boot-managed).

**Design (binding):** `docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md`. Where this plan and the design disagree, the design wins: stop that task and record it in the report.

## Global Constraints

- **Where:** work and write ONLY in the worktree `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice` (branch `be/thin-slice`). **Never touch** `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo` (the main checkout), `~/scuby-b1-run`, or `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability` — other sessions own them. Never edit `web/` or `docs/eng/openapi.json`. Do not edit `docs/eng/infra.md` (another branch edits it).
- **Absolute paths for every write.** `W` below abbreviates `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice`; when you write a file or run a command, expand it to the full absolute path. `B` = `W/backend`.
- **Shell:** the tool shell is zsh; run every script with `bash script.sh`, never `./script.sh` or `source`. Every Maven command starts with the Java export and runs from `B`:
  `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend && export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH && ./mvnw ...`
  Below this prefix is written `[mvn]`, e.g. `[mvn] -q test -Dtest=ConfigEndpointTest`.
- **Docker is required for every Maven build** (jOOQ codegen runs Flyway against a container) and the local image `scuby/postgres:17` must exist (`docker image inspect scuby/postgres:17` succeeds; if not: `docker build -t scuby/postgres:17 /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/infra/docker/postgres`). Tests must run with `backend/` as working directory (the prefix does this).
- **Versions:** Boot-managed versions are never re-declared. Pinned here (Maven Central, checked 2026-10-29): libphonenumber `9.0.42`, AWS SDK BOM `2.57.6`, pitest-maven `1.30.1`, pitest-junit5-plugin `1.2.3`, ArchUnit `1.5.1` (already in the pom).
- **pom.xml and application.yml are shared with branch `be/observability`** (it adds OpenTelemetry; a merge comes later). Keep this plan's additions **grouped in one block per file**, each block opened by the comment `thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md)`. No telemetry, no OpenTelemetry, no Micrometer changes in this plan.
- **Packages:** `co.scuby.platform.*` (domain-free), `co.scuby.identity` (flat — no subpackages). Classes are package-private unless another feature uses them; then they are `public` **and** annotated `@ModuleApi`. Platform classes are `public` without `@ModuleApi`.
- **Flyway versions are timestamps** from now on: `V20261029_HHMM__what.sql` (the existing `V1`, `V2` stay). Each migration starts with a comment saying what it is for and which doc owns it. Qualify table names with `scuby.` inside PL/pgSQL bodies (the app's search path does not include `scuby`).
- **Time:** the app reads time only from the `Clock` bean (`platform.time.TimeConfiguration`). SQL never uses `now()` in application queries — pass `clock.instant()` as a parameter (column defaults for operator-inserted rows are the only exception). Tests control time through `MutableClock`.
- **JSON:** snake_case on the wire (global Jackson setting). Responses are complete: every field present, `null` not absent (Jackson's default inclusion — never add `NON_NULL` to a response record).
- **Every integration test** is annotated `@IntegrationTest` (Task 2), calls `testDb.reset()` in `@BeforeEach`, and talks to endpoints through `ApiClient`, which validates every contract endpoint's response against `docs/eng/openapi.json` and fails when a request executes more SQL statements than its ceiling in `StatementCeilings`. Non-contract routes (test probes, dev-only routes) use `ApiClient.raw(...)`.
- **Indexes are earned:** no index is added without a failing plan-check test first; the migration comment and the report carry the query, the plan before and after, the write cost and overlaps; every new index is listed in the report under "Indexes for human approval".
- **Commits:** prefixes `feat:` (behaviour), `test:` (tests only), `doc:` (docs), `fix:` (a fix to earlier work) — one kind per commit where it can be split. **Never push.** Never open PRs. Never amend or rebase existing commits.
- **Stuck rule:** if a step fails 3 times after honest fixes, stop that task, write what happened (command, output, what you tried) in the report, and continue with the next task whose *Consumes* are satisfied.
- **Report:** `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a1-report.md` — append one section per task (what was done, deviations, measured statement counts, plans before/after for indexes, anything for human review). It is outside the repo; never commit it.
- **Spanish strings are UI copy; identifiers are English snake_case** (repo rule). Country-scoped values come from `supported_countries`, never code.
- Docs rule: **one home per fact** — link, never restate. Decisions land in the decision log `docs/product/00-product-map.md` (next free number: **#40**). Open items referenced by this plan: **O23** (email/SMS providers on AWS), **O24** (flag outcomes the contract cannot express).

---

## File map

```
backend/
  pom.xml                                              + thin-slice dependency block, PIT plugin
  CLAUDE.md                                            NEW agent instructions (Task 13)
  README.md                                            structure + how to run (Tasks 3, 12, 13)
  compose.yaml                                         + `backend` service under profile `app` (Task 12)
  run-local.sh                                         NEW: Jib image + compose up + health (Task 12)
  src/main/java/co/scuby/
    ScubyApplication.java                              + @ConfigurationPropertiesScan
    platform/
      modules/ModuleApi.java                           marker for the cross-feature surface (Task 3)
      time/TimeConfiguration.java                      Clock bean (Task 1)
      config/Prod.java                                 refuse-at-start-up helper (Task 1)
      cache/ClearableCache.java                        in-process caches tests can clear (Task 2)
      crypto/Hashing.java                              sha256Hex, hmacSha256Hex, randomToken, randomDigits (Task 6)
      web/ErrorEnvelopeWriter.java                     writes the contract envelope from filters (Task 1)
      web/ClientAddress.java                           client IP (CloudFront header only with the origin secret) + IP hash (Task 6)
      security/WebProperties.java                      scuby.web.* (Task 1)
      security/SecurityConfiguration.java              the one SecurityFilterChain, CORS (Task 1)
      security/SecurityRules.java                      per-feature route rules (Task 1)
      security/RequestAuthenticator.java               who is signed in, supplied by identity (Task 1)
      security/RequestAuthenticationFilter.java        runs the authenticators (Task 1)
      security/SignedInAuthentication.java             the Authentication for a signed-in person (Task 1)
      security/OriginCheckFilter.java                  CSRF defence: Origin / Sec-Fetch-Site on unsafe methods (Task 1)
      security/Caller.java, Account.java               who is asking, as controller parameters (Task 6)
      security/CallerArgumentResolver.java, CallerWebConfiguration.java (Task 6)
      flags/Flag.java, FeatureFlags.java, FlagProperties.java   (Task 4)
    identity/
      SupportedCountries.java, ConfigController.java, ConfigView.java                     (Task 5)
      DeviceCookieFilter.java, DeviceCookieConfiguration.java, CookieProperties.java       (Task 6)
      Person.java, People.java, UserView.java                                             (Task 7)
      SessionLookup.java, ActiveSession.java, DbSessionLookup.java, CachingSessionLookup.java,
      SessionProperties.java, SessionConfiguration.java, SessionStore.java, SessionCookies.java,
      SessionAuthenticator.java, SignInSessions.java, SessionController.java,
      IdentitySecurityRules.java, IdentityPurge.java                                      (Task 7)
      EmailSender.java, LogEmailSender.java, TestBypass.java, TestBypassGuard.java,
      DisplayNames.java, EmailCodes.java, EmailSignIn.java, EmailSignInController.java, EmailRequests.java (Task 8)
      GoogleProperties.java, GoogleIdTokenConfiguration.java, GoogleIdTokens.java,
      GoogleIdentity.java, GoogleSignInController.java                                    (Task 9)
      SmsSender.java, LogSmsSender.java, PhoneNumbers.java, PhoneOtp.java, SmsProperties.java,
      ProfileView.java, PhoneRequests.java, PhoneController.java                          (Task 10)
      PhoneStepDerivation.java, PublisherPhone.java                                       (Task 11)
  src/main/resources/
    application.yml (+ -local, -test, -prod)           + scuby.* block
    db/migration/V20261029_1000__feature_flags.sql
    db/migration/V20261029_1010__supported_countries.sql
    db/migration/V20261029_1020__accounts_and_sessions.sql
    db/migration/V20261029_1030__email_codes.sql
    db/migration/V20261029_1040__phone_otp.sql
    db/migration/V20261029_1050__sms_send_sent_at_index.sql   (only after its plan check fails — Task 10)
  src/test/java/
    co/scuby/support/  IntegrationTest, TestSupportConfiguration, MutableClock, StatementRecorder,
                       StatementCeilings, ApiClients, ApiClient, ApiResponse, TestDb, PlanAssert,
                       Accounts, RecordingEmailSender, RecordingSmsSender, GoogleTestKeys
    co/scuby/contract/ContractValidator.java           + errorsForNoContent (Task 2)
    co/scuby/architecture/ArchitectureRules.java, ArchitectureTest.java, ArchitectureRulesSelfTest.java (Task 3)
    archfixtures/...                                    fixtures that break each rule (outside co.scuby: never component-scanned)
    co/scuby/platform/... and co/scuby/identity/...    tests named per task
  (deleted) src/test/java/co/scuby/platform/roles/RoleBoundariesTest.java   (Task 3)
docs/eng/backend.md, docs/eng/auth.md, docs/eng/feature-flags.md, docs/product/00-product-map.md (Task 12)
```

**Task order and dependencies:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Tasks 8, 9 and 10 each depend only on 7; if one is stuck, the others can proceed. Task 11 depends on 10. Task 12 (local Docker run) needs every earlier task merged into the image; Task 13 is last.

---
### Task 1: Slice dependencies and the Spring Security baseline

Adding Spring Security locks every route by default, so the dependencies and the platform's filter chain land together: after this task every existing test still passes, routes are public unless a feature's `SecurityRules` says otherwise, `401`/`403` come in the contract's envelope, unsafe requests from a foreign `Origin` are refused, and CORS lets the client's origin call with credentials.

**CSRF decision (record it in the report; Task 13 writes it into `docs/eng/backend.md`):** the client sends no CSRF token (`web/src/api-client/http.ts` sends `Accept`, `Accept-Language`, `Content-Type` and credentials). Spring's token CSRF would need a contract change (a token endpoint and header). Instead, `OriginCheckFilter` refuses any unsafe request (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header is present and not in `scuby.web.allowed-origins`, or that has no `Origin` but `Sec-Fetch-Site: cross-site`. Browsers send `Origin` on every cross-origin `fetch` and on form posts, so a forged request from another site is refused; non-browser clients cannot ride the victim's cookies anyway. `SameSite=Lax` on the cookies (decision #37) is the second layer. Rejected: Spring's synchronizer/double-submit token (contract change for no extra protection here); `SameSite=Lax` alone (a sibling subdomain is same-site, so it does not stop a request from one).

**Files:**
- Modify: `B/pom.xml` (dependency block, Java-version enforcement, Jib base image pinned)
- Check: `B/.java-version` (must stay `25`)
- Modify: `B/src/main/java/co/scuby/ScubyApplication.java`
- Modify: `B/src/main/resources/application.yml`, `B/src/main/resources/application-local.yml`, `B/src/main/resources/application-test.yml`
- Create: `B/src/main/java/co/scuby/platform/time/TimeConfiguration.java`
- Create: `B/src/main/java/co/scuby/platform/config/Prod.java`
- Create: `B/src/main/java/co/scuby/platform/web/ErrorEnvelopeWriter.java`
- Create: `B/src/main/java/co/scuby/platform/security/WebProperties.java`
- Create: `B/src/main/java/co/scuby/platform/security/SecurityRules.java`
- Create: `B/src/main/java/co/scuby/platform/security/RequestAuthenticator.java`
- Create: `B/src/main/java/co/scuby/platform/security/SignedInAuthentication.java`
- Create: `B/src/main/java/co/scuby/platform/security/RequestAuthenticationFilter.java`
- Create: `B/src/main/java/co/scuby/platform/security/OriginCheckFilter.java`
- Create: `B/src/main/java/co/scuby/platform/security/SecurityConfiguration.java`
- Test: `B/src/test/java/co/scuby/platform/security/SecurityBaselineTest.java`
- Test: `B/src/test/java/co/scuby/platform/config/ProdTest.java`

**Interfaces:**
- Consumes: `co.scuby.platform.web.ErrorCode`, `ApiErrorBody` (existing).
- Produces:
  - `@Bean Clock clock()` — `Clock.tick(Clock.systemUTC(), Duration.ofNanos(1_000))` (microseconds, Postgres precision).
  - `Prod.refuse(Environment env, boolean unsafe, String what)` — throws `IllegalStateException("Refusing to start under the prod profile: " + what)` when `unsafe` and the `prod` profile is active.
  - `ErrorEnvelopeWriter.write(HttpServletResponse response, ErrorCode code)` — writes status + `{"error":{"code","message"}}`.
  - `record WebProperties(List<String> allowedOrigins, String originSecretHeader, String originSecret, String ipHashKey)` bound to `scuby.web`.
  - `@FunctionalInterface interface SecurityRules { void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules); }` — every feature contributes a bean; anything not matched is `permitAll()`.
  - `@FunctionalInterface interface RequestAuthenticator { Optional<UUID> authenticate(HttpServletRequest request); }` — returns the signed-in person's id.
  - `final class SignedInAuthentication extends AbstractAuthenticationToken` with `UUID personId()`.

- [ ] **Step 1: Baseline is green before any change**

Run: `docker image inspect scuby/postgres:17 >/dev/null && echo image-ok` then `[mvn] -q verify`
Expected: `image-ok`, then `BUILD SUCCESS` with 0 failures (the foundation's tests). If the build fails before you changed anything, stop and report (stuck rule does not apply — this is a precondition).

- [ ] **Step 2: Add the dependency block to `B/pom.xml`**

In `<properties>`, after `<argLine></argLine>`, add:

```xml
    <!-- thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md): versions Boot does not manage -->
    <libphonenumber.version>9.0.42</libphonenumber.version>
    <aws-sdk.version>2.57.6</aws-sdk.version>
    <pitest.version>1.30.1</pitest.version>
    <pitest-junit5.version>1.2.3</pitest-junit5.version>
```

After `</properties>` add:

```xml
  <!-- thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md): the AWS SDK's own BOM -->
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>bom</artifactId>
        <version>${aws-sdk.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
```

At the end of `<dependencies>` (after `testcontainers-postgresql`) add:

```xml
    <!-- thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md) -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
      <!-- NimbusJwtDecoder for Google ID tokens; no resource-server auto-configuration on purpose -->
      <groupId>org.springframework.security</groupId>
      <artifactId>spring-security-oauth2-jose</artifactId>
    </dependency>
    <dependency>
      <groupId>com.github.ben-manes.caffeine</groupId>
      <artifactId>caffeine</artifactId>
    </dependency>
    <dependency>
      <groupId>com.googlecode.libphonenumber</groupId>
      <artifactId>libphonenumber</artifactId>
      <version>${libphonenumber.version}</version>
    </dependency>
    <dependency>
      <!-- presigned uploads in staging (plan A2); only the JDK URL client, no Netty or Apache -->
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>s3</artifactId>
      <exclusions>
        <exclusion><groupId>software.amazon.awssdk</groupId><artifactId>netty-nio-client</artifactId></exclusion>
        <exclusion><groupId>software.amazon.awssdk</groupId><artifactId>apache-client</artifactId></exclusion>
        <exclusion><groupId>software.amazon.awssdk</groupId><artifactId>apache5-client</artifactId></exclusion>
      </exclusions>
    </dependency>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>url-connection-client</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security-test</artifactId>
      <scope>test</scope>
    </dependency>
```

- [ ] **Step 3: Add `@ConfigurationPropertiesScan`**

`B/src/main/java/co/scuby/ScubyApplication.java`:

```java
package co.scuby;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class ScubyApplication {
    public static void main(String[] args) {
        SpringApplication.run(ScubyApplication.class, args);
    }
}
```

- [ ] **Step 4: Write the failing security test**

`B/src/test/java/co/scuby/platform/security/SecurityBaselineTest.java`:

```java
package co.scuby.platform.security;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, SecurityBaselineTest.Probe.class})
class SecurityBaselineTest {

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/open") String open() { return "open"; }
        @PostMapping("/probe/open") String openPost() { return "posted"; }
        @GetMapping("/probe/secured") String secured() { return "secret"; }

        @Bean
        SecurityRules probeRules() {
            return rules -> rules.requestMatchers("/probe/secured").authenticated();
        }
    }

    @Autowired MockMvc mvc;

    @Test
    void routesArePublicUnlessAFeatureSaysOtherwise() throws Exception {
        mvc.perform(get("/probe/open")).andExpect(status().isOk());
    }

    @Test
    void anAuthenticatedRouteWithoutASessionIsUnauthorizedInTheEnvelope() throws Exception {
        mvc.perform(get("/probe/secured"))
           .andExpect(status().isUnauthorized())
           .andExpect(jsonPath("$.error.code").value("unauthorized"))
           .andExpect(jsonPath("$.error.message").value("unauthorized"));
    }

    @Test
    void anUnsafeRequestFromAForeignOriginIsForbidden() throws Exception {
        mvc.perform(post("/probe/open").header("Origin", "https://evil.example"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.error.code").value("forbidden"));
    }

    @Test
    void anUnsafeCrossSiteRequestWithoutOriginIsForbidden() throws Exception {
        mvc.perform(post("/probe/open").header("Sec-Fetch-Site", "cross-site"))
           .andExpect(status().isForbidden());
    }

    @Test
    void anUnsafeRequestFromTheClientsOriginPasses() throws Exception {
        mvc.perform(post("/probe/open").header("Origin", "http://localhost:4173"))
           .andExpect(status().isOk());
    }

    @Test
    void anUnsafeRequestWithoutBrowserHeadersPasses() throws Exception {
        // curl, server-to-server, MockMvc: cannot carry a victim's cookies, so not a CSRF vector.
        mvc.perform(post("/probe/open")).andExpect(status().isOk());
    }

    @Test
    void corsPreflightFromTheClientAllowsCredentials() throws Exception {
        mvc.perform(options("/probe/open")
                   .header("Origin", "http://localhost:4173")
                   .header("Access-Control-Request-Method", "POST")
                   .header("Access-Control-Request-Headers", "content-type,accept-language"))
           .andExpect(status().isOk())
           .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:4173"))
           .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
    }

    @Test
    void securityHeadersAreSet() throws Exception {
        mvc.perform(get("/probe/open"))
           .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }
}
```

`B/src/test/java/co/scuby/platform/config/ProdTest.java`:

```java
package co.scuby.platform.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProdTest {

    @Test
    void refusesAnUnsafeSettingUnderProd() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        assertThatThrownBy(() -> Prod.refuse(env, true, "a test bypass"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("a test bypass");
    }

    @Test
    void allowsItElsewhereOrWhenSafe() {
        MockEnvironment staging = new MockEnvironment();
        staging.setActiveProfiles("staging");
        assertThatCode(() -> Prod.refuse(staging, true, "x")).doesNotThrowAnyException();
        MockEnvironment prod = new MockEnvironment();
        prod.setActiveProfiles("prod");
        assertThatCode(() -> Prod.refuse(prod, false, "x")).doesNotThrowAnyException();
    }
}
```

- [ ] **Step 5: Run to see them fail**

Run: `[mvn] -q test -Dtest='SecurityBaselineTest,ProdTest' -Dsurefire.failIfNoSpecifiedTests=false`
Expected: compilation FAILURE — `cannot find symbol: class SecurityRules` / `class Prod`.

- [ ] **Step 6: Platform classes**

`B/src/main/java/co/scuby/platform/time/TimeConfiguration.java`:

```java
package co.scuby.platform.time;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

/** The only source of "now" (docs/eng/backend.md · Code structure): tests replace it with a MutableClock. */
@Configuration(proxyBeanMethods = false)
public class TimeConfiguration {

    /** Ticks in microseconds, the precision Postgres stores, so a written instant reads back equal. */
    @Bean
    Clock clock() {
        return Clock.tick(Clock.systemUTC(), Duration.ofNanos(1_000));
    }
}
```

`B/src/main/java/co/scuby/platform/config/Prod.java`:

```java
package co.scuby.platform.config;

import org.springframework.core.env.Environment;

/** Settings that are fine anywhere but production fail start-up under the `prod` profile. */
public final class Prod {

    private Prod() {}

    public static void refuse(Environment env, boolean unsafe, String what) {
        if (unsafe && env.matchesProfiles("prod")) {
            throw new IllegalStateException("Refusing to start under the prod profile: " + what);
        }
    }
}
```

`B/src/main/java/co/scuby/platform/web/ErrorEnvelopeWriter.java`:

```java
package co.scuby.platform.web;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Map;

/** The contract's envelope for answers written outside MVC (security entry points, filters). */
@Component
public class ErrorEnvelopeWriter {

    private final JsonMapper json;

    public ErrorEnvelopeWriter(JsonMapper json) {
        this.json = json;
    }

    public void write(HttpServletResponse response, ErrorCode code) throws IOException {
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), ApiErrorBody.of(code, code.wire(), Map.of(), Map.of()));
    }
}
```

`B/src/main/java/co/scuby/platform/security/WebProperties.java`:

```java
package co.scuby.platform.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * scuby.web.*: who may call the API from a browser, and how the client's IP is trusted.
 *
 * @param allowedOrigins     origins allowed by CORS and by the Origin check (the web client's origins)
 * @param originSecretHeader the header CloudFront adds with the origin secret
 * @param originSecret       its value; blank = never trust CloudFront-Viewer-Address (local)
 * @param ipHashKey          HMAC key for stored IP hashes; the default is refused under prod
 */
@ConfigurationProperties("scuby.web")
public record WebProperties(List<String> allowedOrigins, String originSecretHeader, String originSecret, String ipHashKey) {
    public WebProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
        originSecret = originSecret == null ? "" : originSecret;
    }
}
```

`B/src/main/java/co/scuby/platform/security/SecurityRules.java`:

```java
package co.scuby.platform.security;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * Each feature declares its own route rules as a bean (no central file every feature edits).
 * A route no rule matches is public; endpoints marked `session` in the contract must be declared here.
 */
@FunctionalInterface
public interface SecurityRules {
    void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules);
}
```

`B/src/main/java/co/scuby/platform/security/RequestAuthenticator.java`:

```java
package co.scuby.platform.security;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Optional;
import java.util.UUID;

/** Answers who is signed in on this request (identity supplies it: the session cookie). Must not write. */
@FunctionalInterface
public interface RequestAuthenticator {
    Optional<UUID> authenticate(HttpServletRequest request);
}
```

`B/src/main/java/co/scuby/platform/security/SignedInAuthentication.java`:

```java
package co.scuby.platform.security;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;

import java.util.UUID;

/** A signed-in person. No roles yet: who may act on what is each endpoint's own check. */
public final class SignedInAuthentication extends AbstractAuthenticationToken {

    private final UUID personId;

    public SignedInAuthentication(UUID personId) {
        super(AuthorityUtils.NO_AUTHORITIES);
        this.personId = personId;
        setAuthenticated(true);
    }

    public UUID personId() {
        return personId;
    }

    @Override public Object getCredentials() { return ""; }

    @Override public Object getPrincipal() { return personId; }
}
```

`B/src/main/java/co/scuby/platform/security/RequestAuthenticationFilter.java`:

```java
package co.scuby.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Puts the signed-in person (if any) in the security context. The first authenticator that answers wins. */
final class RequestAuthenticationFilter extends OncePerRequestFilter {

    private final List<RequestAuthenticator> authenticators;

    RequestAuthenticationFilter(List<RequestAuthenticator> authenticators) {
        this.authenticators = List.copyOf(authenticators);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        for (RequestAuthenticator authenticator : authenticators) {
            Optional<UUID> person = authenticator.authenticate(request);
            if (person.isPresent()) {
                var context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(new SignedInAuthentication(person.get()));
                SecurityContextHolder.setContext(context);
                break;
            }
        }
        chain.doFilter(request, response);
    }
}
```

`B/src/main/java/co/scuby/platform/security/OriginCheckFilter.java`:

```java
package co.scuby.platform.security;

import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.ErrorEnvelopeWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Set;

/**
 * CSRF defence without a token (the client sends none): an unsafe request must come from an allowed
 * Origin, or carry no browser evidence of being cross-site (docs/eng/backend.md · Security).
 */
final class OriginCheckFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final Set<String> allowed;
    private final ErrorEnvelopeWriter errors;

    OriginCheckFilter(List<String> allowedOrigins, ErrorEnvelopeWriter errors) {
        this.allowed = Set.copyOf(allowedOrigins);
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!SAFE.contains(request.getMethod()) && !trusted(request)) {
            errors.write(response, ErrorCode.FORBIDDEN);
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean trusted(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null) return allowed.contains(origin);
        return !"cross-site".equals(request.getHeader("Sec-Fetch-Site"));
    }
}
```

`B/src/main/java/co/scuby/platform/security/SecurityConfiguration.java`:

```java
package co.scuby.platform.security;

import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.ErrorEnvelopeWriter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.time.Duration;
import java.util.List;

/**
 * The one filter chain (docs/eng/backend.md · Security). Stateless: the session is our own cookie,
 * resolved by a RequestAuthenticator; Spring's HTTP session, form login, basic auth and logout are off.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

    @Bean
    SecurityFilterChain apiFilterChain(HttpSecurity http,
                                       ObjectProvider<SecurityRules> rules,
                                       ObjectProvider<RequestAuthenticator> authenticators,
                                       CorsConfigurationSource cors,
                                       ErrorEnvelopeWriter errors,
                                       WebProperties web) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
            .cors(c -> c.configurationSource(cors))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .httpBasic(AbstractHttpConfigurer::disable)
            .formLogin(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable)
            .requestCache(AbstractHttpConfigurer::disable)
            .exceptionHandling(e -> e
                    .authenticationEntryPoint((req, res, ex) -> errors.write(res, ErrorCode.UNAUTHORIZED))
                    .accessDeniedHandler((req, res, ex) -> errors.write(res, ErrorCode.FORBIDDEN)))
            .addFilterAfter(new OriginCheckFilter(web.allowedOrigins(), errors), CorsFilter.class)
            .addFilterBefore(new RequestAuthenticationFilter(authenticators.orderedStream().toList()),
                    AnonymousAuthenticationFilter.class)
            .authorizeHttpRequests(a -> {
                rules.orderedStream().forEach(r -> r.authorize(a));
                a.anyRequest().permitAll();
            });
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(WebProperties web) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(web.allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(Duration.ofHours(1));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
```

- [ ] **Step 7: Configuration**

Append to `B/src/main/resources/application.yml` (one block, at the end):

```yaml
# thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md)
scuby:
  web:
    allowed-origins: []
    origin-secret-header: X-Origin-Secret
    origin-secret: ""
    ip-hash-key: local-only-ip-hash-key
```

Append to `B/src/main/resources/application-local.yml`:

```yaml
# thin slice: the web client's dev server and its e2e preview build
scuby:
  web:
    allowed-origins: [ "http://localhost:5173", "http://localhost:4173" ]
```

Replace the content of `B/src/main/resources/application-test.yml` with:

```yaml
# Test profile
# thin slice: integration tests behave like the client's e2e origin
scuby:
  web:
    allowed-origins: [ "http://localhost:4173" ]
```

- [ ] **Step 8: Run the new tests and the whole suite**

Run: `[mvn] -q test -Dtest='SecurityBaselineTest,ProdTest' -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS (10 tests).

Run: `[mvn] -q verify`
Expected: `BUILD SUCCESS`. Every foundation test still passes (`ApiErrorHandlerTest`'s probes are public; its POSTs carry no `Origin`). A start-up log line `Using generated security password` is harmless until Task 9 adds a `JwtDecoder` bean (Boot's in-memory user then backs off); it is never used because form/basic login are off. If after Task 9 it still appears, add to `ScubyApplication` the exclusion of Boot's `UserDetailsServiceAutoConfiguration` (find its exact class name with `unzip -l ~/.m2/repository/org/springframework/boot/spring-boot-security/4.1.2/spring-boot-security-4.1.2.jar | grep UserDetailsServiceAutoConfiguration`).

- [ ] **Step 9: One source of truth for the Java version**

The Java version lives in three places that must agree: `<java.version>25</java.version>` in `B/pom.xml` (compilation, and now Jib's base image), `B/.java-version` (jenv locally; `.github/workflows/backend.yml` reads it with `java-version-file`), and the pinned digest of the Jib base image. Task 13 documents them under one heading in `backend/CLAUDE.md`.

(a) In `B/pom.xml`, in the `jib-maven-plugin` `<configuration><from>`, replace `<image>eclipse-temurin:25-jre</image>` with:

```xml
            <!--
              Base image derives from ${java.version}; pinned to the multi-arch index digest of
              eclipse-temurin:25-jre (linux/amd64 + linux/arm64), looked up 2026-10-29 (25.0.4.1_1-jre).
              To bump: docker buildx imagetools inspect eclipse-temurin:${java.version}-jre  → copy the top "Digest:".
              Changing java.version means changing .java-version and this digest in the same commit.
            -->
            <image>eclipse-temurin:${java.version}-jre@sha256:78f1f183913482ef390c2722f46c3f0ce76ada341d69590e7c482ec943ee72d5</image>
```

(b) In `<build><plugins>`, before `testcontainers-jooq-codegen-maven-plugin`, add:

```xml
      <!-- thin slice: building with another JDK or an old Maven fails at validate with a clear message -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-enforcer-plugin</artifactId>
        <version>3.6.3</version>
        <executions>
          <execution>
            <id>enforce-java-and-maven</id>
            <phase>validate</phase>
            <goals><goal>enforce</goal></goals>
            <configuration>
              <rules>
                <requireJavaVersion>
                  <version>[25,26)</version>
                  <message>Scuby's backend builds with Java 25 (backend/.java-version). Export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home or run `jenv local 25`.</message>
                </requireJavaVersion>
                <requireMavenVersion>
                  <version>[3.9,)</version>
                  <message>Use the wrapper: ./mvnw</message>
                </requireMavenVersion>
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
```

(c) Check `B/.java-version` contains exactly `25`: `cat /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend/.java-version` → `25`.

(d) Verify:

Run: `[mvn] -q validate` → exits 0, no output.

Run (deliberately the wrong JDK, Homebrew's default openjdk 26):
`cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend && JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ./mvnw -q validate; echo "exit=$?"`
Expected: `Rule 0: org.apache.maven.enforcer.rules.version.RequireJavaVersion failed with message:` followed by `Scuby's backend builds with Java 25 …`, and `exit=1`.

Run: `[mvn] -q -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64 && docker run --rm --entrypoint java scuby-backend -version 2>&1 | head -1`
Expected: a line starting `openjdk version "25.` (Jib pulled the pinned digest; `docker image inspect scuby-backend --format '{{.Architecture}}'` prints `arm64`).

- [ ] **Step 10: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/pom.xml backend/src/main/java/co/scuby/ScubyApplication.java backend/src/main/java/co/scuby/platform backend/src/main/resources/application*.yml backend/src/test/java/co/scuby/platform/security backend/src/test/java/co/scuby/platform/config
git commit -m "feat: slice dependencies, Java 25 enforced and the Jib base image pinned, security baseline — stateless chain, envelope 401/403, Origin check, CORS"
```

---

### Task 2: Test harness — contract on every call, statement ceilings, time, reset, plan checks

Every later endpoint test goes through this harness, so the design's "contract conformance on every endpoint response" and "N+1 guard on every endpoint test" hold by construction.

**Files:**
- Create: `B/src/main/java/co/scuby/platform/cache/ClearableCache.java`
- Modify: `B/src/test/java/co/scuby/contract/ContractValidator.java` (add `errorsForNoContent`)
- Create: `B/src/test/java/co/scuby/support/IntegrationTest.java`
- Create: `B/src/test/java/co/scuby/support/TestSupportConfiguration.java`
- Create: `B/src/test/java/co/scuby/support/MutableClock.java`
- Create: `B/src/test/java/co/scuby/support/StatementRecorder.java`
- Create: `B/src/test/java/co/scuby/support/StatementCeilings.java`
- Create: `B/src/test/java/co/scuby/support/ApiClients.java`
- Create: `B/src/test/java/co/scuby/support/ApiClient.java`
- Create: `B/src/test/java/co/scuby/support/ApiResponse.java`
- Create: `B/src/test/java/co/scuby/support/TestDb.java`
- Create: `B/src/test/java/co/scuby/support/PlanAssert.java`
- Test: `B/src/test/java/co/scuby/support/HarnessSelfTest.java`
- Test: `B/src/test/java/co/scuby/contract/ContractValidatorTest.java` (add one test)

**Interfaces:**
- Consumes: `ContractValidator.load()`, `.errors(method, pathTemplate, status, json)`; the `Clock` bean (Task 1).
- Produces (all in `co.scuby.support`, test scope, `public`):
  - `@IntegrationTest` — `@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import({TestcontainersConfiguration.class, TestSupportConfiguration.class})`.
  - `MutableClock extends Clock`: `static final Instant START = Instant.parse("2026-10-14T17:00:00Z")`; `Instant instant()`, `void set(Instant)`, `void advance(Duration)`, `void reset()`.
  - `StatementRecorder`: `void reset()`, `List<String> statements()`.
  - `StatementCeilings.of(String method, String pathTemplate) → int` — fails the test when an endpoint has no ceiling.
  - `ApiClients.newBrowser() → ApiClient`.
  - `ApiClient`: `get(String template, Object... vars)`, `post(String template, String json, Object... vars)`, `put(...)`, `call(HttpMethod, String template, String json, Object... vars)`, `raw(HttpMethod, String template, String json, Object... vars)` (no contract/ceiling checks), `header(String, String) → ApiClient`, `from(String ip) → ApiClient`, `setCookie(String name, String value)`, `cookie(String name) → Optional<String>`, `newBrowser() → ApiClient`. Templates may carry a query (`"/feed?lat={lat}&lng={lng}"`); the contract path is the part before `?`.
  - `ApiResponse(int status, String body, MockHttpServletResponse raw, List<String> statements)`: `json()`, `str(String pointer)`, `isNull(String pointer)`, `errorCode()`, `setCookies()`.
  - `TestDb.reset()` — truncates `TestDb.MUTABLE_TABLES`, restores every `Flag` to its default (from Task 4 on), clears every `ClearableCache`, resets the clock and recorders. `TestDb.MUTABLE_TABLES` is a `List<String>` later tasks extend.
  - `PlanAssert.plan(DSLContext, Query) → String`; `PlanAssert.assertNoSeqScanOn(DSLContext, Query, String table)`.
  - `co.scuby.platform.cache.ClearableCache { void clear(); }` (main scope).
  - `ContractValidator.errorsForNoContent(String method, String pathTemplate, int status) → List<String>`.

- [ ] **Step 1: Write the failing self-test**

`B/src/test/java/co/scuby/support/HarnessSelfTest.java`:

```java
package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.time.Clock;
import java.time.Duration;

import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class HarnessSelfTest {

    @Autowired TestDb testDb;
    @Autowired ApiClients clients;
    @Autowired StatementRecorder recorder;
    @Autowired MutableClock mutableClock;
    @Autowired Clock clock;
    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    @Test
    void theAppClockIsTheMutableOne() {
        assertThat(clock.instant()).isEqualTo(MutableClock.START);
        mutableClock.advance(Duration.ofHours(1));
        assertThat(clock.instant()).isEqualTo(MutableClock.START.plus(Duration.ofHours(1)));
        testDb.reset();
        assertThat(clock.instant()).isEqualTo(MutableClock.START);
    }

    @Test
    void everyJooqStatementIsRecorded() {
        recorder.reset();
        db.selectOne().fetch();
        db.selectOne().fetch();
        assertThat(recorder.statements()).hasSize(2);
    }

    @Test
    void anEndpointWithoutACeilingFailsTheTest() {
        ApiClient api = clients.newBrowser();
        assertThatThrownBy(() -> api.call(HttpMethod.GET, "/no-such-contract-path", null))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("no statement ceiling");
    }

    @Test
    void rawCallsSkipTheChecks() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/actuator/health", null);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/status")).isEqualTo("UP");
    }

    @Test
    void resetEmptiesTheMutableTables() {
        db.execute("INSERT INTO scuby.outbox_events (id, payload_json) VALUES (gen_random_uuid(), '{}')");
        testDb.reset();
        assertThat(db.fetchCount(OUTBOX_EVENTS)).isZero();
    }

    @Test
    void planAssertSeesAnIndexScanAndCatchesASeqScan() {
        db.execute("""
                INSERT INTO scuby.outbox_events (id, created_at, payload_json)
                SELECT gen_random_uuid(), timestamptz '2026-01-01' + g * interval '1 minute', '{}'
                FROM generate_series(1, 20000) g""");
        db.execute("ANALYZE scuby.outbox_events");
        var indexed = db.selectFrom(OUTBOX_EVENTS)
                        .where(OUTBOX_EVENTS.CREATED_AT.gt(DSL.currentOffsetDateTime()));
        PlanAssert.assertNoSeqScanOn(db, indexed, "outbox_events");
        var unindexed = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ATTEMPTS.eq(3));
        assertThatThrownBy(() -> PlanAssert.assertNoSeqScanOn(db, unindexed, "outbox_events"))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("Seq Scan on outbox_events");
    }
}
```

Add to `B/src/test/java/co/scuby/contract/ContractValidatorTest.java`:

```java
    @Test
    void aDocumentedNoContentStatusHasNoErrors() {
        assertThat(contract.errorsForNoContent("POST", "/auth/sign-out", 204)).isEmpty();
        assertThat(contract.errorsForNoContent("POST", "/auth/sign-out", 201)).isNotEmpty();
    }
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest='HarnessSelfTest,ContractValidatorTest' -Dsurefire.failIfNoSpecifiedTests=false`
Expected: compilation FAILURE (`IntegrationTest`, `errorsForNoContent` not found).

- [ ] **Step 3: Implement**

`B/src/main/java/co/scuby/platform/cache/ClearableCache.java`:

```java
package co.scuby.platform.cache;

/** An in-process cache. Tests clear every one between cases; nothing in production calls clear(). */
public interface ClearableCache {
    void clear();
}
```

In `B/src/test/java/co/scuby/contract/ContractValidator.java` add this method after `errors(...)`:

```java
    /** For answers without a body (204): the status must be documented and have no content. */
    public List<String> errorsForNoContent(String method, String pathTemplate, int status) {
        String pointer = "/paths/" + escape(pathTemplate) + "/" + method.toLowerCase(Locale.ROOT) + "/responses/" + status;
        JsonNode response = document.at(pointer);
        if (response.isMissingNode()) return List.of("contract has no " + method + " " + pathTemplate + " → " + status);
        if (response.has("content")) return List.of("contract expects a body for " + method + " " + pathTemplate + " → " + status);
        return List.of();
    }
```

`B/src/test/java/co/scuby/support/IntegrationTest.java`:

```java
package co.scuby.support;

import co.scuby.TestcontainersConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** One shared context for every endpoint test: the database container, MockMvc, the test clock and recorders. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestSupportConfiguration.class})
public @interface IntegrationTest {}
```

`B/src/test/java/co/scuby/support/MutableClock.java`:

```java
package co.scuby.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** The app's clock in tests. Starts at the client mock's frozen instant (2026-10-14 12:00 -05:00). */
public final class MutableClock extends Clock {

    public static final Instant START = Instant.parse("2026-10-14T17:00:00Z");

    private volatile Instant now = START;

    @Override public ZoneId getZone() { return ZoneOffset.UTC; }

    @Override public Clock withZone(ZoneId zone) { return this; }

    @Override public Instant instant() { return now; }

    public void set(Instant instant) { now = instant; }

    public void advance(Duration duration) { now = now.plus(duration); }

    public void reset() { now = START; }
}
```

`B/src/test/java/co/scuby/support/StatementRecorder.java`:

```java
package co.scuby.support;

import org.jooq.ExecuteContext;
import org.jooq.ExecuteListener;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Records every SQL statement jOOQ executes; ApiClient checks the count against StatementCeilings. */
public final class StatementRecorder implements ExecuteListener {

    private final List<String> sql = new CopyOnWriteArrayList<>();

    @Override
    public void executeStart(ExecuteContext ctx) {
        String[] batch = ctx.batchSQL();
        if (batch != null && batch.length > 1) sql.addAll(List.of(batch));
        else sql.add(String.valueOf(ctx.sql()));
    }

    public void reset() { sql.clear(); }

    public List<String> statements() { return List.copyOf(sql); }
}
```

If `implements ExecuteListener` does not compile because the interface has abstract methods in jOOQ 3.21.9, use `extends org.jooq.impl.DefaultExecuteListener` instead and keep the same override.

`B/src/test/java/co/scuby/support/StatementCeilings.java`:

```java
package co.scuby.support;

import java.util.Map;

/**
 * The most SQL statements one request may execute (design · Queries and indexes: N+1 guard).
 * A ceiling never depends on how many rows exist: endpoint tests seed several rows to prove it.
 * Measured on the uncached path (the session lookup counts). Lower a ceiling when the measured
 * count is lower; raising one needs a reason in the task report.
 */
final class StatementCeilings {

    private static final Map<String, Integer> CEILINGS = Map.ofEntries(
            Map.entry("GET /actuator/health", 0)
            // Each endpoint task adds its line here: Map.entry("GET /config", 1), ...
    );

    private StatementCeilings() {}

    static int of(String method, String pathTemplate) {
        Integer ceiling = CEILINGS.get(method + " " + pathTemplate);
        if (ceiling == null) {
            throw new AssertionError("no statement ceiling for " + method + " " + pathTemplate
                    + " — add it to co.scuby.support.StatementCeilings");
        }
        return ceiling;
    }
}
```

`B/src/test/java/co/scuby/support/ApiResponse.java`:

```java
package co.scuby.support;

import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

public record ApiResponse(int status, String body, MockHttpServletResponse raw, List<String> statements) {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    public JsonNode json() {
        return JSON.readTree(body);
    }

    /** The string at a JSON pointer (e.g. "/error/code"), or null when absent or null. */
    public String str(String pointer) {
        JsonNode n = json().at(pointer);
        return n.isMissingNode() || n.isNull() ? null : n.asString();
    }

    /** True only when the field is present and JSON null (the contract wants null, not absent). */
    public boolean isNull(String pointer) {
        return json().at(pointer).isNull();
    }

    public String errorCode() {
        return str("/error/code");
    }

    public List<String> setCookies() {
        return raw.getHeaders(HttpHeaders.SET_COOKIE);
    }
}
```

`B/src/test/java/co/scuby/support/ApiClient.java`:

```java
package co.scuby.support;

import co.scuby.contract.ContractValidator;
import jakarta.servlet.http.Cookie;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * One browser: keeps its cookies (session, device) across calls like the client does. Every call to a
 * contract endpoint is validated against docs/eng/openapi.json and against its statement ceiling.
 */
public final class ApiClient {

    private final MockMvc mvc;
    private final ContractValidator contract;
    private final StatementRecorder recorder;
    private final Map<String, Cookie> jar = new LinkedHashMap<>();
    private final Map<String, String> headers = new LinkedHashMap<>();
    private String remoteAddr = "203.0.113.10";

    ApiClient(MockMvc mvc, ContractValidator contract, StatementRecorder recorder) {
        this.mvc = mvc;
        this.contract = contract;
        this.recorder = recorder;
    }

    public ApiClient newBrowser() { return new ApiClient(mvc, contract, recorder); }

    public ApiClient header(String name, String value) { headers.put(name, value); return this; }

    public ApiClient from(String ip) { this.remoteAddr = ip; return this; }

    public void setCookie(String name, String value) { jar.put(name, new Cookie(name, value)); }

    public Optional<String> cookie(String name) { return Optional.ofNullable(jar.get(name)).map(Cookie::getValue); }

    public ApiResponse get(String template, Object... vars) { return call(HttpMethod.GET, template, null, vars); }

    public ApiResponse post(String template, String json, Object... vars) { return call(HttpMethod.POST, template, json, vars); }

    public ApiResponse put(String template, String json, Object... vars) { return call(HttpMethod.PUT, template, json, vars); }

    /** A contract endpoint: checked against the contract and its statement ceiling. */
    public ApiResponse call(HttpMethod method, String template, String json, Object... vars) {
        String path = template.contains("?") ? template.substring(0, template.indexOf('?')) : template;
        int ceiling = StatementCeilings.of(method.name(), path);
        ApiResponse r = perform(method, template, json, vars);
        List<String> problems = r.status() == 204
                ? contract.errorsForNoContent(method.name(), path, r.status())
                : contract.errors(method.name(), path, r.status(), r.body());
        assertThat(problems).as("%s %s → %d breaks the contract: %s", method, path, r.status(), r.body()).isEmpty();
        assertThat(r.statements().size())
                .as("%s %s executed %d statements (ceiling %d): %s", method, path, r.statements().size(), ceiling, r.statements())
                .isLessThanOrEqualTo(ceiling);
        return r;
    }

    /** Not a contract endpoint (test probes, dev-only routes): no contract or ceiling checks. */
    public ApiResponse raw(HttpMethod method, String template, String json, Object... vars) {
        return perform(method, template, json, vars);
    }

    /** Raw bytes (the dev-only media PUT of plan A2). */
    public ApiResponse rawBytes(HttpMethod method, String template, byte[] bytes, String contentType, Object... vars) {
        MockHttpServletRequestBuilder req = request(method, template, vars).content(bytes).contentType(contentType);
        return execute(req);
    }

    private ApiResponse perform(HttpMethod method, String template, String json, Object... vars) {
        MockHttpServletRequestBuilder req = request(method, template, vars);
        if (json != null) req.contentType(MediaType.APPLICATION_JSON).content(json);
        return execute(req);
    }

    private ApiResponse execute(MockHttpServletRequestBuilder req) {
        req.accept(MediaType.APPLICATION_JSON);
        headers.forEach(req::header);
        if (!jar.isEmpty()) req.cookie(jar.values().toArray(Cookie[]::new));
        String addr = remoteAddr;
        req.with(r -> { r.setRemoteAddr(addr); return r; });
        recorder.reset();
        try {
            MockHttpServletResponse res = mvc.perform(req).andReturn().getResponse();
            List<String> sql = recorder.statements();
            for (Cookie c : res.getCookies()) {
                if (c.getMaxAge() == 0) jar.remove(c.getName());
                else jar.put(c.getName(), new Cookie(c.getName(), c.getValue()));
            }
            return new ApiResponse(res.getStatus(), res.getContentAsString(StandardCharsets.UTF_8), res, sql);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

`B/src/test/java/co/scuby/support/ApiClients.java`:

```java
package co.scuby.support;

import co.scuby.contract.ContractValidator;
import org.springframework.test.web.servlet.MockMvc;

public final class ApiClients {

    private static final ContractValidator CONTRACT = ContractValidator.load();

    private final MockMvc mvc;
    private final StatementRecorder recorder;

    ApiClients(MockMvc mvc, StatementRecorder recorder) {
        this.mvc = mvc;
        this.recorder = recorder;
    }

    /** A fresh browser: no cookies. */
    public ApiClient newBrowser() {
        return new ApiClient(mvc, CONTRACT, recorder);
    }
}
```

`B/src/test/java/co/scuby/support/PlanAssert.java`:

```java
package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.Query;
import org.jooq.conf.ParamType;

import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plan checks for growth-sensitive queries only (design · Queries and indexes). Seed thousands of
 * rows and ANALYZE before asserting; paste the printed plan (before and after an index) into the report.
 */
public final class PlanAssert {

    private PlanAssert() {}

    public static String plan(DSLContext db, Query query) {
        return db.fetch("EXPLAIN " + query.getSQL(ParamType.INLINED)).stream()
                 .map(r -> r.get(0, String.class))
                 .collect(Collectors.joining("\n"));
    }

    public static void assertNoSeqScanOn(DSLContext db, Query query, String table) {
        String plan = plan(db, query);
        System.out.println("PLAN for " + table + ":\n" + plan);
        assertThat(plan).as("plan:\n%s", plan).doesNotContain("Seq Scan on " + table + " ");
    }
}
```

Note the trailing space in `"Seq Scan on " + table + " "`: Postgres prints `Seq Scan on outbox_events  (cost=…` or `Seq Scan on sighting s  (cost=…`; the space keeps `sighting` from matching `sighting_x`. The self-test expects the message to contain `Seq Scan on outbox_events` — AssertJ's message includes the plan, so it does.

`B/src/test/java/co/scuby/support/TestDb.java`:

```java
package co.scuby.support;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

/** Puts the shared database and in-process state back to a known start before each test. */
public final class TestDb {

    /** Every table a test may write. Each task that adds a writable table adds it here. */
    static final List<String> MUTABLE_TABLES = List.of(
            "outbox_events"
    );

    private final DSLContext db;
    private final ObjectProvider<ClearableCache> caches;
    private final MutableClock clock;
    private final StatementRecorder recorder;

    TestDb(DSLContext db, ObjectProvider<ClearableCache> caches, MutableClock clock, StatementRecorder recorder) {
        this.db = db;
        this.caches = caches;
        this.clock = clock;
        this.recorder = recorder;
    }

    public void reset() {
        db.execute("TRUNCATE " + String.join(", ", MUTABLE_TABLES.stream().map(t -> "scuby." + t).toList())
                + " RESTART IDENTITY CASCADE");
        caches.orderedStream().forEach(ClearableCache::clear);
        clock.reset();
        recorder.reset();
    }
}
```

`B/src/test/java/co/scuby/support/TestSupportConfiguration.java`:

```java
package co.scuby.support;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import org.jooq.ExecuteListenerProvider;
import org.jooq.impl.DefaultExecuteListenerProvider;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;

/** Beans every @IntegrationTest gets. Later tasks add recording senders and test keys here. */
@TestConfiguration(proxyBeanMethods = false)
public class TestSupportConfiguration {

    @Bean
    @Primary
    MutableClock mutableClock() {
        return new MutableClock();
    }

    @Bean
    StatementRecorder statementRecorder() {
        return new StatementRecorder();
    }

    /** Boot's jOOQ auto-configuration adds every ExecuteListenerProvider bean to the DSLContext. */
    @Bean
    ExecuteListenerProvider statementRecorderProvider(StatementRecorder recorder) {
        return new DefaultExecuteListenerProvider(recorder);
    }

    @Bean
    ApiClients apiClients(MockMvc mvc, StatementRecorder recorder) {
        return new ApiClients(mvc, recorder);
    }

    @Bean
    TestDb testDb(DSLContext db, ObjectProvider<ClearableCache> caches, MutableClock clock, StatementRecorder recorder) {
        return new TestDb(db, caches, clock, recorder);
    }
}
```

If `everyJooqStatementIsRecorded` records 0 statements (Boot 4.1.2 no longer collects `ExecuteListenerProvider` beans), replace the `statementRecorderProvider` bean with a `DefaultConfigurationCustomizer` that appends: `c -> c.set(appendTo(c.executeListenerProviders(), new DefaultExecuteListenerProvider(recorder)))`, where `appendTo` copies the array plus one element — keep Boot's own providers (exception translation).

Add `Map.entry("GET /actuator/health", 0)` is already in `StatementCeilings` (it is not a contract path, but the entry documents the format; `raw()` is what calls it).

- [ ] **Step 4: Run**

Run: `[mvn] -q test -Dtest='HarnessSelfTest,ContractValidatorTest' -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS (6 + 6 tests). The plan test prints two plans; the first shows `Index Scan` or `Bitmap Index Scan` on `outbox_events_created_at_idx`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/java/co/scuby/platform/cache backend/src/test/java/co/scuby/support backend/src/test/java/co/scuby/contract
git commit -m "test: integration harness — contract check and statement ceiling on every call, test clock, reset, plan checks"
```

---
### Task 3: Guardrails that fail the build — ArchUnit rules and PIT

**Files:**
- Create: `B/src/main/java/co/scuby/platform/modules/ModuleApi.java`
- Create: `B/src/test/java/co/scuby/architecture/ArchitectureRules.java`
- Create: `B/src/test/java/co/scuby/architecture/ArchitectureTest.java`
- Create: `B/src/test/java/co/scuby/architecture/ArchitectureRulesSelfTest.java`
- Create fixtures (outside `co.scuby`, so component scanning never sees them):
  `B/src/test/java/archfixtures/identity/Internal.java`, `B/src/test/java/archfixtures/identity/Exposed.java`,
  `B/src/test/java/archfixtures/identity/ReachesIntoCases.java`, `B/src/test/java/archfixtures/cases/UsesInternal.java`,
  `B/src/test/java/archfixtures/cases/UsesExposed.java`, `B/src/test/java/archfixtures/cases/ClockReadingDerivation.java`,
  `B/src/test/java/archfixtures/cases/SpringUsingDerivation.java`, `B/src/test/java/archfixtures/cases/PureDerivation.java`,
  `B/src/test/java/archfixtures/roles/FixtureApi.java`, `B/src/test/java/archfixtures/roles/FixtureWorker.java`
- Delete: `B/src/test/java/co/scuby/platform/roles/RoleBoundariesTest.java`
- Modify: `B/pom.xml` (PIT plugin), `B/README.md` (one paragraph)

**Interfaces:**
- Consumes: `@ApiComponent`, `@WorkerComponent` (existing).
- Produces:
  - `@co.scuby.platform.modules.ModuleApi` — `@Target(TYPE) @Retention(RUNTIME) @Documented`. A class in a feature used from another feature must carry it; classes nested in a `@ModuleApi` class count as annotated.
  - `ArchitectureRules(String root)` with the constants `FOUNDATIONS = List.of("identity", "uploads", "pets")`, `VERTICALS = List.of("cases")`; methods `derivationsDependOnNothingImpure()`, `derivationsReadNoClockOrRandomness()`, `workersDoNotUseApi()`, `apiDoesNotUseWorkers()`, `platformDependsOnNoFeature()`, `foundationIsolated(String)`, `verticalIsolated(String)`, `onlyKnownTopLevelPackages()`, `moduleApi(String feature)`. **A new feature is added to `FOUNDATIONS` or `VERTICALS` in the same commit that creates its package** (otherwise `onlyKnownTopLevelPackages` fails).
  - PIT runs at `verify` on `co.scuby.*Derivation*` with tests `co.scuby.*DerivationTest`, threshold 80 %.

- [ ] **Step 1: Write the rules and the self-test that proves each rule bites**

`B/src/main/java/co/scuby/platform/modules/ModuleApi.java`:

```java
package co.scuby.platform.modules;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The declared public surface of a feature: a class used from another feature carries this
 * annotation (classes nested in it count). Everything else stays package-private. Enforced by
 * ArchitectureTest (docs/eng/backend.md · Code structure).
 */
@Documented
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ModuleApi {}
```

`B/src/test/java/co/scuby/architecture/ArchitectureRules.java`:

```java
package co.scuby.architecture;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.roles.WorkerComponent;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ArchRule;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.UUID;

import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.core.domain.properties.CanBeAnnotated.Predicates.metaAnnotatedWith;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/** The design's guardrails 1–4 (docs/eng/backend.md · Code structure), parameterised by root package so a self-test can aim them at fixtures. */
final class ArchitectureRules {

    static final List<String> FOUNDATIONS = List.of("identity", "uploads", "pets");
    static final List<String> VERTICALS = List.of("cases");

    private final String root;

    ArchitectureRules(String root) {
        this.root = root;
    }

    static final DescribedPredicate<JavaClass> DERIVATION = new DescribedPredicate<>("a *Derivation class or one nested in it") {
        @Override public boolean test(JavaClass c) { return c.getName().matches(".*Derivation(\\$.*)?"); }
    };

    static final DescribedPredicate<JavaClass> MODULE_API = new DescribedPredicate<>("@ModuleApi or nested in a @ModuleApi class") {
        @Override public boolean test(JavaClass c) {
            for (Optional<JavaClass> k = Optional.of(c); k.isPresent(); k = k.get().getEnclosingClass()) {
                if (k.get().isAnnotatedWith(ModuleApi.class)) return true;
            }
            return false;
        }
    };

    /** 1a. Derivations are pure: no Spring, jOOQ, generated tables, I/O, network, NIO or JDBC; no Spring beans. */
    ArchRule derivationsDependOnNothingImpure() {
        return noClasses().that(DERIVATION).should().dependOnClassesThat(
                        resideInAnyPackage("org.springframework..", "org.jooq..", "co.scuby.db.generated..",
                                "java.io..", "java.net..", "java.nio..", "java.sql..")
                                .or(metaAnnotatedWith(Component.class)))
                .allowEmptyShould(true)
                .because("a derivation takes facts, the viewer and the time as parameters and returns a view");
    }

    /** 1b. Derivations never read the clock or randomness themselves. */
    ArchRule derivationsReadNoClockOrRandomness() {
        return noClasses().that(DERIVATION)
                .should().callMethod(Instant.class, "now")
                .orShould().callMethod(Clock.class, "systemUTC")
                .orShould().callMethod(Clock.class, "systemDefaultZone")
                .orShould().callMethod(LocalDate.class, "now")
                .orShould().callMethod(LocalDateTime.class, "now")
                .orShould().callMethod(OffsetDateTime.class, "now")
                .orShould().callMethod(ZonedDateTime.class, "now")
                .orShould().callMethod(UUID.class, "randomUUID")
                .orShould().callMethod(Math.class, "random")
                .orShould().callConstructor(SecureRandom.class)
                .orShould().callConstructor(Random.class)
                .allowEmptyShould(true)
                .because("time and randomness are parameters, so derivations are table-testable");
    }

    /** 2. Roles by annotation (replaces the package-based rule). */
    ArchRule workersDoNotUseApi() {
        return noClasses().that().areAnnotatedWith(WorkerComponent.class)
                .should().dependOnClassesThat().areAnnotatedWith(ApiComponent.class).allowEmptyShould(true);
    }

    ArchRule apiDoesNotUseWorkers() {
        return noClasses().that().areAnnotatedWith(ApiComponent.class)
                .should().dependOnClassesThat().areAnnotatedWith(WorkerComponent.class).allowEmptyShould(true);
    }

    /** 3. The DAG: platform → nothing of ours; foundations → platform only; verticals → foundations + platform, never each other. */
    ArchRule platformDependsOnNoFeature() {
        return noClasses().that().resideInAPackage(root + ".platform..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(all()))
                .allowEmptyShould(true);
    }

    ArchRule foundationIsolated(String foundation) {
        List<String> others = new ArrayList<>(all());
        others.remove(foundation);
        return noClasses().that().resideInAPackage(root + "." + foundation + "..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(others))
                .allowEmptyShould(true)
                .because("foundations depend only on platform (and the generated tables)");
    }

    ArchRule verticalIsolated(String vertical) {
        List<String> others = new ArrayList<>(VERTICALS);
        others.remove(vertical);
        return noClasses().that().resideInAPackage(root + "." + vertical + "..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(others))
                .allowEmptyShould(true)
                .because("verticals never depend on each other");
    }

    /** Every class lives in platform, the generated tables, a listed feature, or is the application class. */
    ArchRule onlyKnownTopLevelPackages() {
        List<String> known = new ArrayList<>(List.of("platform", "db.generated"));
        known.addAll(all());
        return classes().that().resideInAPackage(root + "..").and().doNotHaveFullyQualifiedName(root + ".ScubyApplication")
                .should().resideInAnyPackage(packages(known))
                .because("a new feature package is added to ArchitectureRules.FOUNDATIONS or VERTICALS");
    }

    /** 4. Declared surface: a feature's class used from outside the feature carries @ModuleApi. */
    ArchRule moduleApi(String feature) {
        return classes().that().resideInAPackage(root + "." + feature + "..").and(DescribedPredicate.not(MODULE_API))
                .should().onlyHaveDependentClassesThat().resideInAPackage(root + "." + feature + "..")
                .allowEmptyShould(true)
                .because("cross-feature use is declared with @ModuleApi");
    }

    static List<String> all() {
        List<String> all = new ArrayList<>(FOUNDATIONS);
        all.addAll(VERTICALS);
        return all;
    }

    private String[] packages(List<String> features) {
        return features.stream().map(f -> root + "." + f + "..").toArray(String[]::new);
    }
}
```

`B/src/test/java/co/scuby/architecture/ArchitectureTest.java`:

```java
package co.scuby.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;

/** Guardrails 1–4 on the production code (test classes excluded). */
@AnalyzeClasses(packages = "co.scuby", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    private static final ArchitectureRules RULES = new ArchitectureRules("co.scuby");

    @ArchTest
    void derivationsArePure(JavaClasses classes) {
        RULES.derivationsDependOnNothingImpure().check(classes);
        RULES.derivationsReadNoClockOrRandomness().check(classes);
    }

    @ArchTest
    void rolesStayApart(JavaClasses classes) {
        RULES.workersDoNotUseApi().check(classes);
        RULES.apiDoesNotUseWorkers().check(classes);
    }

    @ArchTest
    void dependenciesFormTheDag(JavaClasses classes) {
        RULES.platformDependsOnNoFeature().check(classes);
        ArchitectureRules.FOUNDATIONS.forEach(f -> RULES.foundationIsolated(f).check(classes));
        ArchitectureRules.VERTICALS.forEach(v -> RULES.verticalIsolated(v).check(classes));
        RULES.onlyKnownTopLevelPackages().check(classes);
    }

    @ArchTest
    void crossFeatureUseIsDeclared(JavaClasses classes) {
        ArchitectureRules.all().forEach(f -> RULES.moduleApi(f).check(classes));
    }
}
```

`B/src/test/java/co/scuby/architecture/ArchitectureRulesSelfTest.java`:

```java
package co.scuby.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Each rule must fail on a fixture that breaks it — a rule that never fails guards nothing. */
class ArchitectureRulesSelfTest {

    private static final JavaClasses FIXTURES = new ClassFileImporter().importPackages("archfixtures");
    private static final ArchitectureRules RULES = new ArchitectureRules("archfixtures");

    @Test
    void aDerivationReadingTheClockFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("ClockReadingDerivation");
    }

    @Test
    void aDerivationUsingSpringFails() {
        assertThatThrownBy(() -> RULES.derivationsDependOnNothingImpure().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("SpringUsingDerivation")
                .message().doesNotContain("PureDerivation");
    }

    @Test
    void aWorkerUsingAnApiComponentFails() {
        assertThatThrownBy(() -> RULES.workersDoNotUseApi().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureWorker");
    }

    @Test
    void aFoundationReachingIntoAVerticalFails() {
        assertThatThrownBy(() -> RULES.foundationIsolated("identity").check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("ReachesIntoCases");
    }

    @Test
    void anUndeclaredCrossFeatureUseFailsAndADeclaredOnePasses() {
        assertThatThrownBy(() -> RULES.moduleApi("identity").check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("Internal")
                .message().doesNotContain("Exposed");
    }

    @Test
    void theProductionRulesHoldOnAnEmptyRoleSet() {
        assertThatCode(() -> RULES.apiDoesNotUseWorkers().check(new ClassFileImporter().importClasses(String.class)))
                .doesNotThrowAnyException();
    }
}
```

Fixtures (each file is tiny; package declarations must match the path):

`B/src/test/java/archfixtures/identity/Internal.java`:
```java
package archfixtures.identity;

public class Internal {
    public static String value() { return "internal"; }
}
```

`B/src/test/java/archfixtures/identity/Exposed.java`:
```java
package archfixtures.identity;

import co.scuby.platform.modules.ModuleApi;

@ModuleApi
public class Exposed {
    public static String value() { return "exposed"; }
    public record Nested(String v) {}
}
```

`B/src/test/java/archfixtures/identity/ReachesIntoCases.java`:
```java
package archfixtures.identity;

import archfixtures.cases.UsesExposed;

public class ReachesIntoCases {
    public static String call() { return UsesExposed.call(); }
}
```

`B/src/test/java/archfixtures/cases/UsesInternal.java`:
```java
package archfixtures.cases;

import archfixtures.identity.Internal;

public class UsesInternal {
    public static String call() { return Internal.value(); }
}
```

`B/src/test/java/archfixtures/cases/UsesExposed.java`:
```java
package archfixtures.cases;

import archfixtures.identity.Exposed;

public class UsesExposed {
    public static String call() { return Exposed.value() + new Exposed.Nested("x").v(); }
}
```

`B/src/test/java/archfixtures/cases/ClockReadingDerivation.java`:
```java
package archfixtures.cases;

import java.time.Instant;

public class ClockReadingDerivation {
    public static Instant derive() { return Instant.now(); }
}
```

`B/src/test/java/archfixtures/cases/SpringUsingDerivation.java`:
```java
package archfixtures.cases;

import org.springframework.util.StringUtils;

public class SpringUsingDerivation {
    public static boolean derive(String s) { return StringUtils.hasText(s); }
}
```

`B/src/test/java/archfixtures/cases/PureDerivation.java`:
```java
package archfixtures.cases;

import java.time.Instant;

public class PureDerivation {
    public static boolean derive(Instant seenAt, Instant now) { return seenAt.isAfter(now); }
}
```

`B/src/test/java/archfixtures/roles/FixtureApi.java`:
```java
package archfixtures.roles;

import co.scuby.platform.roles.ApiComponent;

@ApiComponent
public class FixtureApi {
    public String hello() { return "api"; }
}
```

`B/src/test/java/archfixtures/roles/FixtureWorker.java`:
```java
package archfixtures.roles;

import co.scuby.platform.roles.WorkerComponent;

@WorkerComponent
public class FixtureWorker {
    public String run(FixtureApi api) { return api.hello(); }
}
```

- [ ] **Step 2: Run them**

Run: `[mvn] -q test -Dtest='ArchitectureTest,ArchitectureRulesSelfTest' -Dsurefire.failIfNoSpecifiedTests=false`
Expected: PASS (4 + 6). `ArchitectureTest` passes because nothing violates yet (`identity` and the others do not exist; `allowEmptyShould(true)`). If a self-test fails because the rule did not fire, the rule is wrong — fix the rule, never the self-test.

- [ ] **Step 3: Delete the package-based role rule**

Run: `git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice rm backend/src/test/java/co/scuby/platform/roles/RoleBoundariesTest.java`

In `B/README.md`, replace the paragraph that starts `Convención de paquetes: el código del API va en` with:

```markdown
Convención de paquetes: por funcionalidad y plano (`platform`, `identity`, `uploads`, `pets`, `cases`);
las reglas de dependencia, roles y pureza las comprueba `ArchitectureTest` (ArchUnit) y fallan el
build. Instrucciones para agentes: [`CLAUDE.md`](CLAUDE.md).
```

- [ ] **Step 4: Add PIT to `B/pom.xml`**

In `<build><plugins>`, after the `maven-surefire-plugin` plugin, add:

```xml
      <!-- thin slice (docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md): mutation testing on derivations -->
      <plugin>
        <groupId>org.pitest</groupId>
        <artifactId>pitest-maven</artifactId>
        <version>${pitest.version}</version>
        <dependencies>
          <dependency>
            <groupId>org.pitest</groupId>
            <artifactId>pitest-junit5-plugin</artifactId>
            <version>${pitest-junit5.version}</version>
          </dependency>
        </dependencies>
        <configuration>
          <targetClasses><param>co.scuby.*Derivation*</param></targetClasses>
          <targetTests><param>co.scuby.*DerivationTest</param></targetTests>
          <mutationThreshold>80</mutationThreshold>
          <failWhenNoMutations>false</failWhenNoMutations>
          <timestampedReports>false</timestampedReports>
          <outputFormats><param>HTML</param><param>XML</param></outputFormats>
        </configuration>
        <executions>
          <execution>
            <id>mutation-test-derivations</id>
            <phase>verify</phase>
            <goals><goal>mutationCoverage</goal></goals>
          </execution>
        </executions>
      </plugin>
```

- [ ] **Step 5: Full build**

Run: `[mvn] -q verify`
Expected: `BUILD SUCCESS`. PIT runs and finds no mutations yet (no `*Derivation` until Task 11) — its log says it found nothing to mutate; `failWhenNoMutations=false` keeps the build green. If PIT fails to start with a JUnit Platform error (`NoSuchMethodError`/`ClassNotFoundException` under `org.junit.platform`), add to the PIT plugin's `<dependencies>` `org.junit.platform:junit-platform-launcher` with `<version>${junit-jupiter.version}</version>` (JUnit 6 versions the platform with Jupiter) and retry; if that fails, apply the stuck rule and record it — Task 11 depends on PIT.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/pom.xml backend/README.md backend/src/main/java/co/scuby/platform/modules backend/src/test/java/co/scuby/architecture backend/src/test/java/archfixtures
git commit -m "test: guardrails that fail the build — derivation purity, roles by annotation, the DAG, @ModuleApi, PIT on derivations"
```

---

### Task 4: Feature flags (decision #18)

**Files:**
- Create: `B/src/main/resources/db/migration/V20261029_1000__feature_flags.sql`
- Create: `B/src/main/java/co/scuby/platform/flags/Flag.java`
- Create: `B/src/main/java/co/scuby/platform/flags/FlagProperties.java`
- Create: `B/src/main/java/co/scuby/platform/flags/FeatureFlags.java`
- Modify: `B/src/main/resources/application.yml` (inside the thin-slice block)
- Modify: `B/src/test/java/co/scuby/support/TestDb.java`
- Test: `B/src/test/java/co/scuby/platform/flags/FeatureFlagsTest.java`

**Interfaces:**
- Produces:
  - `enum Flag { PUBLISHER_PHONE_OTP("publisher_phone_otp", true), REVERSE_GEOCODING("reverse_geocoding", false); String key(); boolean defaultEnabled(); }` — the code side of the registry in `docs/eng/feature-flags.md`.
  - `FeatureFlags.isEnabled(Flag flag, @Nullable UUID personId) → boolean` — override for `(flag, person)` if any, else the global value; a flag missing from the table is off and logs a warning; cached in-process (`scuby.flags.cache-ttl`, default 30 s). Implements `ClearableCache`.
  - Tables `feature_flags`, `feature_flag_overrides`, `feature_flag_changes`; history written by triggers (an operator's plain `UPDATE` is recorded; `changed_by` = `SET scuby.changed_by = 'name'` if set, else the database user).

- [ ] **Step 1: Write the failing test**

`B/src/test/java/co/scuby/platform/flags/FeatureFlagsTest.java`:

```java
package co.scuby.platform.flags;

import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Arrays;
import java.util.UUID;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;
import static co.scuby.db.generated.Tables.FEATURE_FLAG_CHANGES;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class FeatureFlagsTest {

    @Autowired FeatureFlags flags;
    @Autowired DSLContext db;
    @Autowired TestDb testDb;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theRegistryAndTheTableAgree() {
        var keys = db.select(FEATURE_FLAGS.KEY).from(FEATURE_FLAGS).fetchSet(FEATURE_FLAGS.KEY);
        assertThat(keys).containsExactlyInAnyOrderElementsOf(Arrays.stream(Flag.values()).map(Flag::key).toList());
        for (Flag f : Flag.values()) {
            assertThat(flags.isEnabled(f, null)).as(f.key()).isEqualTo(f.defaultEnabled());
        }
    }

    @Test
    void anonymousActorsGetTheGlobalValue() {
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, null)).isTrue();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
    }

    @Test
    void anOverrideWinsInEitherDirection() {
        UUID ana = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        insertPerson(ana);
        insertPerson(other);
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test account')", ana);
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('reverse_geocoding', ?, true, 'beta')", ana);
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, ana)).isFalse();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, ana)).isTrue();
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, other)).isTrue();
    }

    @Test
    void aFlagMissingFromTheTableIsOff() {
        db.execute("DELETE FROM scuby.feature_flags WHERE key = 'publisher_phone_otp'");
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, null)).isFalse();
    }

    @Test
    void valuesAreCachedUntilCleared() {
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
        db.execute("UPDATE scuby.feature_flags SET enabled = true WHERE key = 'reverse_geocoding'");
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
        flags.clear();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isTrue();
    }

    @Test
    void everyFlipIsRecordedWithWhoDidIt() {
        db.transaction(c -> {
            c.dsl().execute("SET LOCAL scuby.changed_by = 'alejo'");
            c.dsl().execute("UPDATE scuby.feature_flags SET enabled = false WHERE key = 'publisher_phone_otp'");
        });
        var change = db.selectFrom(FEATURE_FLAG_CHANGES).orderBy(FEATURE_FLAG_CHANGES.ID.desc()).limit(1).fetchOne();
        assertThat(change.getFlagKey()).isEqualTo("publisher_phone_otp");
        assertThat(change.getOld()).isTrue();
        assertThat(change.getNew()).isFalse();
        assertThat(change.getChangedBy()).isEqualTo("alejo");
    }

    private void insertPerson(UUID id) {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES (?, 'Test', ?, now())",
                id, id + "@flags.test");
    }
}
```

`anOverrideWinsInEitherDirection` needs the `person` table (Task 7). Until then, mark only that test with `@org.junit.jupiter.api.Disabled("needs the person table — enabled in Task 7")`; Task 7 removes the annotation.

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=FeatureFlagsTest`
Expected: compilation FAILURE (`FEATURE_FLAGS` / `FeatureFlags` not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261029_1000__feature_flags.sql`:

```sql
-- Feature flags: global value, per-account overrides, append-only history (docs/eng/feature-flags.md · Model).
-- Operators flip flags with plain UPDATEs; triggers record every change so none is lost from the history.
CREATE TABLE feature_flags (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  enabled      boolean NOT NULL,
  description  text NOT NULL,
  owner        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- person_id gets its foreign key with the person table (V20261029_1020).
CREATE TABLE feature_flag_overrides (
  flag_key    text NOT NULL REFERENCES feature_flags (key) ON DELETE CASCADE,
  person_id   uuid NOT NULL,
  enabled     boolean NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, person_id)
);

CREATE TABLE feature_flag_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flag_key    text NOT NULL,
  person_id   uuid NULL,
  old         boolean NULL,
  new         boolean NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION scuby.record_feature_flag_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN
    RETURN NEW;
  END IF;
  INSERT INTO scuby.feature_flag_changes (flag_key, person_id, old, new, changed_by)
  VALUES (NEW.key, NULL, CASE WHEN TG_OP = 'UPDATE' THEN OLD.enabled END, NEW.enabled,
          coalesce(nullif(current_setting('scuby.changed_by', true), ''), current_user));
  RETURN NEW;
END $$;

CREATE TRIGGER feature_flags_history AFTER INSERT OR UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION scuby.record_feature_flag_change();

CREATE FUNCTION scuby.record_feature_flag_override_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.enabled IS NOT DISTINCT FROM NEW.enabled THEN
    RETURN NEW;
  END IF;
  INSERT INTO scuby.feature_flag_changes (flag_key, person_id, old, new, changed_by)
  VALUES (CASE WHEN TG_OP = 'DELETE' THEN OLD.flag_key ELSE NEW.flag_key END,
          CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.enabled END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.enabled END,
          coalesce(nullif(current_setting('scuby.changed_by', true), ''), current_user));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER feature_flag_overrides_history AFTER INSERT OR UPDATE OR DELETE ON feature_flag_overrides
  FOR EACH ROW EXECUTE FUNCTION scuby.record_feature_flag_override_change();

-- The registry (docs/eng/feature-flags.md · Registry). Code side: co.scuby.platform.flags.Flag.
INSERT INTO feature_flags (key, enabled, description, owner) VALUES
  ('publisher_phone_otp', true,
   'SMS OTP verification of the publisher''s phone at publish. Permanent kill switch (also the lever if the SMS spend alarm fires).',
   'founders'),
  ('reverse_geocoding', false,
   'Place names from a reverse-geocoding provider instead of the generic label. Deleted once a provider is chosen and stable.',
   'founders');
```

- [ ] **Step 4: Code**

`B/src/main/java/co/scuby/platform/flags/Flag.java`:

```java
package co.scuby.platform.flags;

/** The code side of the registry in docs/eng/feature-flags.md: a flag in code but not there is a bug. */
public enum Flag {
    PUBLISHER_PHONE_OTP("publisher_phone_otp", true),
    REVERSE_GEOCODING("reverse_geocoding", false);

    private final String key;
    private final boolean defaultEnabled;

    Flag(String key, boolean defaultEnabled) {
        this.key = key;
        this.defaultEnabled = defaultEnabled;
    }

    public String key() { return key; }

    /** The seeded global value (tests restore it between cases). */
    public boolean defaultEnabled() { return defaultEnabled; }
}
```

`B/src/main/java/co/scuby/platform/flags/FlagProperties.java`:

```java
package co.scuby.platform.flags;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** scuby.flags.cache-ttl: how long a flip may take to be seen (docs/eng/feature-flags.md: ~30 s). */
@ConfigurationProperties("scuby.flags")
public record FlagProperties(Duration cacheTtl) {
    public FlagProperties {
        if (cacheTtl == null) cacheTtl = Duration.ofSeconds(30);
    }
}
```

`B/src/main/java/co/scuby/platform/flags/FeatureFlags.java`:

```java
package co.scuby.platform.flags;

import co.scuby.platform.cache.ClearableCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.UUID;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;
import static co.scuby.db.generated.Tables.FEATURE_FLAG_OVERRIDES;

/**
 * The one evaluation function (docs/eng/feature-flags.md · Model): the account's override if one
 * exists, else the global value. Backend only; a flag never reaches the wire.
 */
@Component
public class FeatureFlags implements ClearableCache {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlags.class);

    private record Key(Flag flag, @Nullable UUID personId) {}

    private final DSLContext db;
    private final Cache<Key, Boolean> cache;

    public FeatureFlags(DSLContext db, FlagProperties properties) {
        this.db = db;
        this.cache = Caffeine.newBuilder().maximumSize(10_000).expireAfterWrite(properties.cacheTtl()).build();
    }

    public boolean isEnabled(Flag flag, @Nullable UUID personId) {
        return cache.get(new Key(flag, personId), this::load);
    }

    @Override
    public void clear() {
        cache.invalidateAll();
    }

    private Boolean load(Key key) {
        var override = key.personId() == null
                ? DSL.falseCondition()
                : FEATURE_FLAG_OVERRIDES.PERSON_ID.eq(key.personId());
        var row = db.select(FEATURE_FLAGS.ENABLED, FEATURE_FLAG_OVERRIDES.ENABLED)
                    .from(FEATURE_FLAGS)
                    .leftJoin(FEATURE_FLAG_OVERRIDES)
                    .on(FEATURE_FLAG_OVERRIDES.FLAG_KEY.eq(FEATURE_FLAGS.KEY).and(override))
                    .where(FEATURE_FLAGS.KEY.eq(key.flag().key()))
                    .fetchOne();
        if (row == null) {
            log.warn("feature flag '{}' is not in feature_flags: evaluating as off", key.flag().key());
            return false;
        }
        return row.value2() != null ? row.value2() : row.value1();
    }
}
```

In `B/src/main/resources/application.yml`, inside the `scuby:` block of the thin slice, add:

```yaml
  flags:
    cache-ttl: 30s
```

In `B/src/test/java/co/scuby/support/TestDb.java`, add the overrides and history to `MUTABLE_TABLES`, and restore every flag in `reset()` after the truncate:

```java
    static final List<String> MUTABLE_TABLES = List.of(
            "outbox_events",
            "feature_flag_overrides",
            "feature_flag_changes"
    );
```

```java
        for (co.scuby.platform.flags.Flag f : co.scuby.platform.flags.Flag.values()) {
            db.execute("""
                    INSERT INTO scuby.feature_flags (key, enabled, description, owner) VALUES (?, ?, 'restored by TestDb', 'tests')
                    ON CONFLICT (key) DO UPDATE SET enabled = excluded.enabled""", f.key(), f.defaultEnabled());
        }
        db.execute("TRUNCATE scuby.feature_flag_changes RESTART IDENTITY");
```

(place these lines between the `TRUNCATE` of the mutable tables and `caches...clear()`).

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='FeatureFlagsTest,ArchitectureTest'`
Expected: PASS (5 tests run, 1 skipped — the override test until Task 7).

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261029_1000__feature_flags.sql backend/src/main/java/co/scuby/platform/flags backend/src/main/resources/application.yml backend/src/test/java/co/scuby/support/TestDb.java backend/src/test/java/co/scuby/platform/flags
git commit -m "feat: feature flags — global value, per-account overrides, trigger-written history, one cached evaluation function"
```

---

### Task 5: `supported_countries` and `GET /config`

**Files:**
- Create: `B/src/main/resources/db/migration/V20261029_1010__supported_countries.sql`
- Create: `B/src/main/java/co/scuby/identity/SupportedCountries.java`
- Create: `B/src/main/java/co/scuby/identity/ConfigView.java`
- Create: `B/src/main/java/co/scuby/identity/ConfigController.java`
- Modify: `B/src/test/java/co/scuby/support/StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/identity/ConfigEndpointTest.java`

**Interfaces:**
- Consumes: `GeoPoint` (`co.scuby.platform.db`), `@ApiComponent`, `ApiClient`.
- Produces:
  - `@ModuleApi public class SupportedCountries`: `List<Country> all()`, `Optional<Country> forE164(String e164)` (longest matching prefix); `@ModuleApi`-nested `public record Country(String code, String phonePrefix, String mobilePattern, GeoPoint defaultCenter)`. `mobilePattern` matches the **national significant number** (digits after the prefix), e.g. `^3\d{9}$`.
  - `GET /config` → `ConfigView(List<CountryView> supportedCountries)`.

- [ ] **Step 1: Write the failing test**

`B/src/test/java/co/scuby/identity/ConfigEndpointTest.java`:

```java
package co.scuby.identity;

import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class ConfigEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired SupportedCountries countries;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void colombiaComesFromTheTable() {
        ApiResponse r = clients.newBrowser().get("/config");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/supported_countries/0/code")).isEqualTo("CO");
        assertThat(r.str("/supported_countries/0/phone_prefix")).isEqualTo("+57");
        assertThat(r.str("/supported_countries/0/mobile_pattern")).isEqualTo("^3\\d{9}$");
        assertThat(r.json().at("/supported_countries/0/default_center/lat").asDouble()).isEqualTo(6.2442);
    }

    @Test
    void aCountryIsOneRowAndZeroCode() {
        db.execute("""
                INSERT INTO scuby.supported_countries (code, phone_prefix, mobile_pattern, currency, locale, default_center_lat, default_center_lng, sort_order)
                VALUES ('EC', '+593', '^9\\d{8}$', 'USD', 'es-EC', -0.1807, -78.4678, 1)""");
        try {
            ApiResponse r = clients.newBrowser().get("/config");
            assertThat(r.json().get("supported_countries")).hasSize(2);
            assertThat(r.str("/supported_countries/1/code")).isEqualTo("EC");
            assertThat(countries.forE164("+593991234567")).get().extracting(SupportedCountries.Country::code).isEqualTo("EC");
            assertThat(countries.forE164("+573001234567")).get().extracting(SupportedCountries.Country::code).isEqualTo("CO");
            assertThat(countries.forE164("+12025550123")).isEmpty();
        } finally {
            db.execute("DELETE FROM scuby.supported_countries WHERE code = 'EC'");
        }
    }
}
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=ConfigEndpointTest`
Expected: compilation FAILURE (`SupportedCountries` not found).

- [ ] **Step 3: Implement**

`B/src/main/resources/db/migration/V20261029_1010__supported_countries.sql`:

```sql
-- Country is configuration, never code (docs/eng/auth.md · Country is configuration). One row per
-- country; adding one is a row plus a legal review. mobile_pattern matches the national significant
-- number (the digits after phone_prefix). default_center is where maps open (GET /config).
CREATE TABLE supported_countries (
  code                char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  phone_prefix        text NOT NULL UNIQUE CHECK (phone_prefix ~ '^\+[1-9][0-9]{0,3}$'),
  mobile_pattern      text NOT NULL,
  currency            char(3) NOT NULL,
  locale              text NOT NULL,
  default_center_lat  double precision NOT NULL CHECK (default_center_lat BETWEEN -90 AND 90),
  default_center_lng  double precision NOT NULL CHECK (default_center_lng BETWEEN -180 AND 180),
  sort_order          int NOT NULL DEFAULT 0
);

-- v1: Colombia. Map center = Medellín, as the client's emulated backend (web/src/mocks/api/reads.ts).
INSERT INTO supported_countries (code, phone_prefix, mobile_pattern, currency, locale, default_center_lat, default_center_lng, sort_order)
VALUES ('CO', '+57', '^3\d{9}$', 'COP', 'es-CO', 6.2442, -75.5812, 0);
```

`B/src/main/java/co/scuby/identity/SupportedCountries.java`:

```java
package co.scuby.identity;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.modules.ModuleApi;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import static co.scuby.db.generated.Tables.SUPPORTED_COUNTRIES;

/** The supported_countries table (docs/eng/auth.md · Country is configuration). Small and static: read per call. */
@ModuleApi
@Component
public class SupportedCountries {

    public record Country(String code, String phonePrefix, String mobilePattern, GeoPoint defaultCenter) {}

    private final DSLContext db;

    SupportedCountries(DSLContext db) {
        this.db = db;
    }

    public List<Country> all() {
        return db.selectFrom(SUPPORTED_COUNTRIES)
                 .orderBy(SUPPORTED_COUNTRIES.SORT_ORDER, SUPPORTED_COUNTRIES.CODE)
                 .fetch(r -> new Country(r.getCode(), r.getPhonePrefix(), r.getMobilePattern(),
                         new GeoPoint(r.getDefaultCenterLat(), r.getDefaultCenterLng())));
    }

    /** The country whose prefix starts this E.164 number (the longest prefix wins). */
    public Optional<Country> forE164(String e164) {
        return all().stream()
                    .filter(c -> e164.startsWith(c.phonePrefix()))
                    .max(Comparator.comparingInt(c -> c.phonePrefix().length()));
    }
}
```

`B/src/main/java/co/scuby/identity/ConfigView.java`:

```java
package co.scuby.identity;

import co.scuby.platform.db.GeoPoint;

import java.util.List;

/** GET /config (web/src/contracts/config.ts). */
record ConfigView(List<CountryView> supportedCountries) {

    record CountryView(String code, String phonePrefix, String mobilePattern, GeoPoint defaultCenter) {}

    static ConfigView of(List<SupportedCountries.Country> countries) {
        return new ConfigView(countries.stream()
                .map(c -> new CountryView(c.code(), c.phonePrefix(), c.mobilePattern(), c.defaultCenter()))
                .toList());
    }
}
```

`B/src/main/java/co/scuby/identity/ConfigController.java`:

```java
package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class ConfigController {

    private final SupportedCountries countries;

    ConfigController(SupportedCountries countries) {
        this.countries = countries;
    }

    @GetMapping("/config")
    ConfigView config() {
        return ConfigView.of(countries.all());
    }
}
```

In `StatementCeilings.CEILINGS` add `Map.entry("GET /config", 1)`.

- [ ] **Step 4: Run**

Run: `[mvn] -q test -Dtest='ConfigEndpointTest,ArchitectureTest'`
Expected: PASS (2 + 4).

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261029_1010__supported_countries.sql backend/src/main/java/co/scuby/identity backend/src/test/java/co/scuby/identity backend/src/test/java/co/scuby/support/StatementCeilings.java
git commit -m "feat: GET /config from supported_countries"
```

---
### Task 6: The device cookie and `Caller`

Who is asking, as a controller parameter: the signed-in person (if any), the device (always) and a hash of the client IP. The device cookie follows decision #35 (`docs/eng/api.md` · Device identity): random ≥ 128 bits (we use 256), `HttpOnly; Secure; SameSite=Lax; Path=/`, one year, set on any answer to a request without a valid one and renewed on every unsafe request ("renewed when used"). The server keeps only its SHA-256.

**Decision recorded here (report it; Task 13 writes it to `docs/eng/backend.md`):** there is **no `device` table** in this slice. Nothing reads a device row; the hash is stored on the rows that need it (`upload.owner_key`, `sighting.reporter_device_hash` in plan A2). This keeps every read free of writes — a table "created once" per device would mean an `INSERT` on the first request of every crawler and every new visitor. A table arrives with the first consumer that needs device-level data (push subscriptions, D16 tokens).

The CloudFront viewer address is trusted only when the request carries the origin secret header (`scuby.web.origin-secret-header` = `scuby.web.origin-secret`); otherwise the socket address is the IP. IPs are stored only as an HMAC (`scuby.web.ip-hash-key`) — enough to count, not to read back (Ley 1581 minimisation). The default key is refused under `prod`.

**Files:**
- Create: `B/src/main/java/co/scuby/platform/crypto/Hashing.java`
- Create: `B/src/main/java/co/scuby/platform/web/ClientAddress.java`
- Create: `B/src/main/java/co/scuby/platform/security/Caller.java`
- Create: `B/src/main/java/co/scuby/platform/security/Account.java`
- Create: `B/src/main/java/co/scuby/platform/security/CallerArgumentResolver.java`
- Create: `B/src/main/java/co/scuby/platform/security/CallerWebConfiguration.java`
- Create: `B/src/main/java/co/scuby/identity/CookieProperties.java`
- Create: `B/src/main/java/co/scuby/identity/DeviceCookieFilter.java`
- Create: `B/src/main/java/co/scuby/identity/DeviceCookieConfiguration.java`
- Modify: `B/src/main/resources/application.yml` (thin-slice block)
- Test: `B/src/test/java/co/scuby/platform/crypto/HashingTest.java`
- Test: `B/src/test/java/co/scuby/identity/DeviceCookieTest.java`

**Interfaces:**
- Produces:
  - `Hashing.sha256Hex(String) → String` (64 lowercase hex), `Hashing.hmacSha256Hex(String key, String value) → String`, `Hashing.randomToken(int bytes) → String` (base64url, no padding; 32 bytes → 43 chars), `Hashing.randomDigits(int n) → String` (zero-padded, n ≤ 9).
  - `ClientAddress.ip(HttpServletRequest) → String`, `ClientAddress.ipHash(HttpServletRequest) → String`.
  - `public record Caller(@Nullable UUID personId, String deviceHash, String ipHash)` with `boolean signedIn()`, `String ownerKey()` (`"p:" + personId` when signed in, else `"d:" + deviceHash`), constant `Caller.DEVICE_HASH_ATTRIBUTE = "scuby.deviceHash"`.
  - `public record Account(UUID personId)` — a controller parameter of this type means "sign-in required": resolving it without a session answers `unauthorized`.
  - Controllers declare `Caller caller` and/or `Account account` parameters; `CallerArgumentResolver` fills them.
  - `record CookieProperties(boolean secure)` bound to `scuby.cookies` (identity, package-private).
  - `DeviceCookieFilter.COOKIE = "device"`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/platform/crypto/HashingTest.java`:

```java
package co.scuby.platform.crypto;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class HashingTest {

    @Test
    void sha256IsLowercaseHex() {
        assertThat(Hashing.sha256Hex("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    void hmacDependsOnTheKey() {
        assertThat(Hashing.hmacSha256Hex("k1", "203.0.113.10")).hasSize(64)
                .isNotEqualTo(Hashing.hmacSha256Hex("k2", "203.0.113.10"));
    }

    @Test
    void tokensAreUrlSafeAndUnique() {
        String a = Hashing.randomToken(32);
        assertThat(a).matches("^[A-Za-z0-9_-]{43}$").isNotEqualTo(Hashing.randomToken(32));
    }

    @Test
    void digitsKeepLeadingZeros() {
        for (int i = 0; i < 200; i++) assertThat(Hashing.randomDigits(6)).matches("^\\d{6}$");
    }
}
```

`B/src/test/java/co/scuby/identity/DeviceCookieTest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
@Import(DeviceCookieTest.Probe.class)
class DeviceCookieTest {

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/caller")
        Map<String, Object> caller(Caller caller) {
            return Map.of("device", caller.deviceHash(), "ip", caller.ipHash(), "signed_in", caller.signedIn());
        }

        @PostMapping("/probe/caller")
        Map<String, Object> callerPost(Caller caller) { return caller(caller); }

        @GetMapping("/probe/account")
        String account(Account account) { return account.personId().toString(); }
    }

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aRequestWithoutTheCookieGetsOne() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null);
        String cookie = r.setCookies().stream().filter(c -> c.startsWith("device=")).findFirst().orElseThrow();
        assertThat(cookie).matches("^device=[A-Za-z0-9_-]{43};.*")
                .contains("Path=/").contains("Max-Age=31536000").contains("Secure").contains("HttpOnly").contains("SameSite=Lax");
        assertThat(r.str("/device")).matches("^[0-9a-f]{64}$");
        assertThat(r.json().get("signed_in").asBoolean()).isFalse();
    }

    @Test
    void theSameBrowserIsTheSameDeviceAndAReadDoesNotRenew() {
        ApiClient browser = clients.newBrowser();
        String first = browser.raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        ApiResponse again = browser.raw(HttpMethod.GET, "/probe/caller", null);
        assertThat(again.str("/device")).isEqualTo(first);
        assertThat(again.setCookies()).noneMatch(c -> c.startsWith("device="));
    }

    @Test
    void anUnsafeRequestRenewsTheCookie() {
        ApiClient browser = clients.newBrowser();
        browser.raw(HttpMethod.GET, "/probe/caller", null);
        String value = browser.cookie("device").orElseThrow();
        ApiResponse post = browser.raw(HttpMethod.POST, "/probe/caller", null);
        assertThat(post.setCookies()).anyMatch(c -> c.startsWith("device=" + value + ";"));
    }

    @Test
    void aMalformedCookieIsReplaced() {
        ApiClient browser = clients.newBrowser();
        browser.setCookie("device", "not-a-token");
        ApiResponse r = browser.raw(HttpMethod.GET, "/probe/caller", null);
        assertThat(r.setCookies()).anyMatch(c -> c.startsWith("device=") && !c.startsWith("device=not-a-token"));
    }

    @Test
    void differentBrowsersAreDifferentDevices() {
        String a = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        String b = clients.newBrowser().raw(HttpMethod.GET, "/probe/caller", null).str("/device");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void theIpIsTheSocketUnlessTheOriginSecretVouchesForCloudFront() {
        ApiClient spoofer = clients.newBrowser().from("198.51.100.7").header("CloudFront-Viewer-Address", "192.0.2.1:443");
        ApiClient direct = clients.newBrowser().from("198.51.100.7");
        assertThat(spoofer.raw(HttpMethod.GET, "/probe/caller", null).str("/ip"))
                .isEqualTo(direct.raw(HttpMethod.GET, "/probe/caller", null).str("/ip"));
        ApiClient viaCloudFront = clients.newBrowser().from("10.0.0.5")
                .header("X-Origin-Secret", "test-origin-secret")
                .header("CloudFront-Viewer-Address", "198.51.100.7:51234");
        assertThat(viaCloudFront.raw(HttpMethod.GET, "/probe/caller", null).str("/ip"))
                .isEqualTo(direct.raw(HttpMethod.GET, "/probe/caller", null).str("/ip"));
    }

    @Test
    void anAccountParameterWithoutASessionIsUnauthorized() {
        ApiResponse r = clients.newBrowser().raw(HttpMethod.GET, "/probe/account", null);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }
}
```

Add to `B/src/main/resources/application-test.yml` (inside its `scuby.web` block):

```yaml
    origin-secret: test-origin-secret
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='HashingTest,DeviceCookieTest'`
Expected: compilation FAILURE (`Hashing`, `Caller`, `Account` not found).

- [ ] **Step 3: Implement**

`B/src/main/java/co/scuby/platform/crypto/Hashing.java`:

```java
package co.scuby.platform.crypto;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** Hashes and random values for tokens, codes and stored identifiers. */
public final class Hashing {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Hashing() {}

    public static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hmacSha256Hex(String key, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** {@code bytes} random bytes, base64url without padding (32 bytes → 43 characters). */
    public static String randomToken(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** {@code n} random decimal digits, zero-padded (n ≤ 9). */
    public static String randomDigits(int n) {
        if (n < 1 || n > 9) throw new IllegalArgumentException("1..9 digits");
        int bound = (int) Math.pow(10, n);
        return String.format("%0" + n + "d", RANDOM.nextInt(bound));
    }
}
```

`B/src/main/java/co/scuby/platform/web/ClientAddress.java`:

```java
package co.scuby.platform.web;

import co.scuby.platform.config.Prod;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.WebProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * The client's IP (a rate-limit key, design · Sighting rate limits): CloudFront-Viewer-Address only
 * when the request proves it came through CloudFront (origin secret header), else the socket address.
 */
@Component
public class ClientAddress {

    static final String DEFAULT_KEY = "local-only-ip-hash-key";

    private final WebProperties web;

    public ClientAddress(WebProperties web, Environment env) {
        this.web = web;
        Prod.refuse(env, DEFAULT_KEY.equals(web.ipHashKey()), "scuby.web.ip-hash-key is the local default");
        Prod.refuse(env, web.originSecret().isBlank(), "scuby.web.origin-secret is empty");
    }

    public String ip(HttpServletRequest request) {
        if (!web.originSecret().isBlank()) {
            String presented = request.getHeader(web.originSecretHeader());
            if (presented != null && MessageDigest.isEqual(presented.getBytes(StandardCharsets.UTF_8),
                    web.originSecret().getBytes(StandardCharsets.UTF_8))) {
                String viewer = request.getHeader("CloudFront-Viewer-Address");
                if (viewer != null && viewer.lastIndexOf(':') > 0) {
                    return viewer.substring(0, viewer.lastIndexOf(':'));  // "ip:port", IPv6 included
                }
            }
        }
        return request.getRemoteAddr();
    }

    /** Stored instead of the IP: enough to count, not to read back. */
    public String ipHash(HttpServletRequest request) {
        return Hashing.hmacSha256Hex(web.ipHashKey(), ip(request));
    }
}
```

`B/src/main/java/co/scuby/platform/security/Caller.java`:

```java
package co.scuby.platform.security;

import org.jspecify.annotations.Nullable;

import java.util.UUID;

/**
 * Who is asking (docs/eng/api.md · Device identity): the signed-in person if any, the device always,
 * and the IP as a hash. A signed-in session wins when both are present.
 */
public record Caller(@Nullable UUID personId, String deviceHash, String ipHash) {

    /** Set by identity's device-cookie filter on every request. */
    public static final String DEVICE_HASH_ATTRIBUTE = "scuby.deviceHash";

    public boolean signedIn() {
        return personId != null;
    }

    /** One key per uploader/reporter: the account when signed in, else the device. */
    public String ownerKey() {
        return personId != null ? "p:" + personId : "d:" + deviceHash;
    }
}
```

`B/src/main/java/co/scuby/platform/security/Account.java`:

```java
package co.scuby.platform.security;

import java.util.UUID;

/** A controller parameter that requires a signed-in person; resolving it without one answers `unauthorized`. */
public record Account(UUID personId) {}
```

`B/src/main/java/co/scuby/platform/security/CallerArgumentResolver.java`:

```java
package co.scuby.platform.security;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ClientAddress;
import co.scuby.platform.web.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;

final class CallerArgumentResolver implements HandlerMethodArgumentResolver {

    private final ClientAddress address;

    CallerArgumentResolver(ClientAddress address) {
        this.address = address;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        Class<?> type = parameter.getParameterType();
        return type == Caller.class || type == Account.class;
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav,
                                  NativeWebRequest webRequest, WebDataBinderFactory binders) {
        UUID person = SecurityContextHolder.getContext().getAuthentication() instanceof SignedInAuthentication s
                ? s.personId() : null;
        if (parameter.getParameterType() == Account.class) {
            if (person == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "sign in first");
            return new Account(person);
        }
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        Object device = request.getAttribute(Caller.DEVICE_HASH_ATTRIBUTE);
        if (!(device instanceof String hash)) {
            throw new IllegalStateException("the device-cookie filter did not run for " + request.getRequestURI());
        }
        return new Caller(person, hash, address.ipHash(request));
    }
}
```

`B/src/main/java/co/scuby/platform/security/CallerWebConfiguration.java`:

```java
package co.scuby.platform.security;

import co.scuby.platform.web.ClientAddress;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration(proxyBeanMethods = false)
class CallerWebConfiguration implements WebMvcConfigurer {

    private final ClientAddress address;

    CallerWebConfiguration(ClientAddress address) {
        this.address = address;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CallerArgumentResolver(address));
    }
}
```

`B/src/main/java/co/scuby/identity/CookieProperties.java`:

```java
package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.cookies.secure: true everywhere (browsers accept Secure cookies from http://localhost). */
@ConfigurationProperties("scuby.cookies")
record CookieProperties(boolean secure) {}
```

`B/src/main/java/co/scuby/identity/DeviceCookieFilter.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The anonymous identity (decision #35): set by the API, only its hash used server-side. Renewed on
 * unsafe requests (where it is used); never written to the database by this filter.
 */
final class DeviceCookieFilter extends OncePerRequestFilter {

    static final String COOKIE = "device";
    private static final Pattern VALUE = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final CookieProperties cookies;

    DeviceCookieFilter(CookieProperties cookies) {
        this.cookies = cookies;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String value = read(request);
        boolean valid = value != null && VALUE.matcher(value).matches();
        if (!valid) value = Hashing.randomToken(32);
        request.setAttribute(Caller.DEVICE_HASH_ATTRIBUTE, Hashing.sha256Hex(value));
        boolean preflight = "OPTIONS".equals(request.getMethod());
        if (!preflight && (!valid || !SAFE.contains(request.getMethod()))) {
            response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(COOKIE, value)
                    .httpOnly(true).secure(cookies.secure()).sameSite("Lax").path("/")
                    .maxAge(Duration.ofDays(365)).build().toString());
        }
        chain.doFilter(request, response);
    }

    private static String read(HttpServletRequest request) {
        Cookie[] all = request.getCookies();
        if (all == null) return null;
        for (Cookie c : all) if (COOKIE.equals(c.getName())) return c.getValue();
        return null;
    }
}
```

`B/src/main/java/co/scuby/identity/DeviceCookieConfiguration.java`:

```java
package co.scuby.identity;

import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Runs before Spring Security so even a 401/403 answer sets the device cookie. */
@Configuration(proxyBeanMethods = false)
class DeviceCookieConfiguration {

    @Bean
    FilterRegistrationBean<DeviceCookieFilter> deviceCookieFilter(CookieProperties cookies) {
        var registration = new FilterRegistrationBean<>(new DeviceCookieFilter(cookies));
        registration.setOrder(SecurityFilterProperties.DEFAULT_FILTER_ORDER - 10);
        return registration;
    }
}
```

If `SecurityFilterProperties` is not at that package in Boot 4.1.2, use the literal `-110` (Spring Security's filter is registered at `-100`) with a comment saying so.

In `B/src/main/resources/application.yml`, thin-slice `scuby:` block, add:

```yaml
  cookies:
    secure: true
```

- [ ] **Step 4: Run**

Run: `[mvn] -q test -Dtest='HashingTest,DeviceCookieTest,SecurityBaselineTest,ArchitectureTest'`
Expected: PASS. `ArchitectureTest` still passes: `identity` depends only on `platform`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/java/co/scuby/platform backend/src/main/java/co/scuby/identity backend/src/main/resources/application*.yml backend/src/test/java/co/scuby/platform/crypto backend/src/test/java/co/scuby/identity/DeviceCookieTest.java
git commit -m "feat: device cookie (hash only, renewed when used) and Caller/Account controller parameters with the client IP hash"
```

---

### Task 7: Sessions — opaque token, SHA-256 at rest, 12 months, reads never write

**Files:**
- Create: `B/src/main/resources/db/migration/V20261029_1020__accounts_and_sessions.sql`
- Create in `B/src/main/java/co/scuby/identity/`: `Person.java`, `People.java`, `UserView.java`, `ActiveSession.java`, `SessionLookup.java`, `DbSessionLookup.java`, `CachingSessionLookup.java`, `SessionProperties.java`, `SessionConfiguration.java`, `SessionStore.java`, `SessionCookies.java`, `SessionAuthenticator.java`, `SignInSessions.java`, `SessionController.java`, `IdentitySecurityRules.java`, `IdentityPurge.java`
- Modify: `B/src/main/resources/application.yml` (thin-slice block)
- Modify: `B/src/test/java/co/scuby/support/TestDb.java`, `StatementCeilings.java`
- Create: `B/src/test/java/co/scuby/support/Accounts.java`
- Modify: `B/src/test/java/co/scuby/platform/flags/FeatureFlagsTest.java` (remove `@Disabled`)
- Test: `B/src/test/java/co/scuby/identity/SessionTest.java`, `B/src/test/java/co/scuby/identity/SessionConfigurationTest.java`

**Interfaces:**
- Consumes: `Hashing`, `RequestAuthenticator`, `SecurityRules`, `ClearableCache`, `Account`, `CookieProperties`.
- Produces (identity, package-private unless noted):
  - Tables `person` (id, display_name, email unique lower-case, google_sub unique, phone E.164, phone_verified_at, city, bio, notify_lost/found/adoption/help, photo_url, created_at) and `session` (token_hash PK, person_id, created_at, expires_at).
  - `record Person(UUID id, String displayName, String email, @Nullable String googleSub, @Nullable String phone, @Nullable Instant phoneVerifiedAt, @Nullable String city, @Nullable String bio, boolean notifyLost, boolean notifyFound, boolean notifyAdoption, boolean notifyHelp, @Nullable String photoUrl)` with `@Nullable String verifiedPhone()` (phone only when verified).
  - `People`: `Person get(UUID)`, `Optional<Person> byEmail(String normalizedEmail)`, `Optional<Person> byGoogleSub(String)`, `Person create(String normalizedEmail, String displayName, @Nullable String googleSub)`, `void linkGoogle(UUID, String sub)`, `void setPhone(UUID, String e164, @Nullable Instant verifiedAt)`. **The only writer of `person`.**
  - `record UserView(String id, String displayName, String email, @Nullable String phone)` + `static UserView of(Person)` — the contract's `User`.
  - `interface SessionLookup { Optional<ActiveSession> find(String tokenHash); void evict(String tokenHash); }`, `record ActiveSession(UUID personId, Instant expiresAt)`.
  - `SessionStore`: `String create(UUID personId)` (returns the raw token), `void delete(String tokenHash)` (also evicts), `int purgeExpired()`.
  - `SessionCookies`: `NAME = "session"`, `Optional<String> read(HttpServletRequest)`, `void issue(HttpServletResponse, String token)`, `void clear(HttpServletResponse)`.
  - `SignInSessions.open(UUID personId, HttpServletRequest, HttpServletResponse)` — ends a session the request carried, creates a new one, sets the cookie. Used by Tasks 8 and 9.
  - `GET /session` → `UserView`; `POST /auth/sign-out` → 204.
  - Test support `co.scuby.support.Accounts`: `UUID person(String email)` (creates a person directly), `UUID signIn(ApiClient api, String email)` (person + session row + cookie in the jar).

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/support/Accounts.java`:

```java
package co.scuby.support;

import co.scuby.platform.crypto.Hashing;
import org.jooq.DSLContext;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.SESSION;

/** Test shortcuts that bypass sign-in (the sign-in endpoints have their own tests). */
public final class Accounts {

    private final DSLContext db;
    private final Clock clock;

    Accounts(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    public UUID person(String email) {
        UUID id = UUID.randomUUID();
        db.insertInto(PERSON)
          .set(PERSON.ID, id)
          .set(PERSON.DISPLAY_NAME, email.substring(0, email.indexOf('@')))
          .set(PERSON.EMAIL, email.toLowerCase())
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .execute();
        return id;
    }

    public UUID signIn(ApiClient api, String email) {
        UUID id = person(email);
        String token = Hashing.randomToken(32);
        db.insertInto(SESSION)
          .set(SESSION.TOKEN_HASH, Hashing.sha256Hex(token))
          .set(SESSION.PERSON_ID, id)
          .set(SESSION.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .set(SESSION.EXPIRES_AT, clock.instant().atOffset(ZoneOffset.UTC).plusMonths(12))
          .execute();
        api.setCookie("session", token);
        return id;
    }
}
```

jOOQ generates `timestamptz` as `OffsetDateTime` by default. Keep that everywhere: convert with `instant.atOffset(ZoneOffset.UTC)` on write and `.toInstant()` on read. (Do not configure `javaTimeTypes` differently — later tasks assume `OffsetDateTime`.)

Register it in `TestSupportConfiguration`:

```java
    @Bean
    Accounts accounts(DSLContext db, java.time.Clock clock) {
        return new Accounts(db, clock);
    }
```

`B/src/test/java/co/scuby/identity/SessionTest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import com.zaxxer.hikari.HikariDataSource;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SESSION;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class SessionTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired HikariDataSource dataSource;
    @Autowired SessionLookup lookup;
    @Autowired SessionStore store;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aSignedInPersonGetsTheirUser() {
        UUID id = accounts.signIn(api, "ana.gomez@correo.co");
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(id.toString());
        assertThat(r.str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(r.isNull("/phone")).isTrue();
    }

    @Test
    void aSessionReadIssuesNoInsertOrUpdateAndReturnsItsConnection() {
        accounts.signIn(api, "ana.gomez@correo.co");
        ApiResponse r = api.get("/session");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.statements()).noneMatch(s -> s.trim().toLowerCase().matches("^(insert|update|delete|merge).*"));
        assertThat(dataSource.getHikariPoolMXBean().getActiveConnections()).isZero();
    }

    @Test
    void theLookupIsCachedSoTheSecondReadSkipsIt() {
        accounts.signIn(api, "ana.gomez@correo.co");
        int first = api.get("/session").statements().size();
        int second = api.get("/session").statements().size();
        assertThat(second).isEqualTo(first - 1);
    }

    @Test
    void sessionsExpireTwelveMonthsAfterSignInWhateverTheUse() {
        accounts.signIn(api, "ana.gomez@correo.co");
        clock.advance(Duration.ofDays(200));
        assertThat(api.get("/session").status()).isEqualTo(200);   // use does not slide the expiry
        clock.set(MutableClock.START.atOffset(ZoneOffset.UTC).plusMonths(12).toInstant());
        assertThat(api.get("/session").status()).isEqualTo(401);
    }

    @Test
    void signOutEndsTheSessionAndClearsTheCookie() {
        accounts.signIn(api, "ana.gomez@correo.co");
        String token = api.cookie("session").orElseThrow();
        api.get("/session");                                      // now cached
        ApiResponse out = api.post("/auth/sign-out", null);
        assertThat(out.status()).isEqualTo(204);
        assertThat(out.setCookies()).anyMatch(c -> c.startsWith("session=;") && c.contains("Max-Age=0"));
        assertThat(db.fetchCount(SESSION, SESSION.TOKEN_HASH.eq(Hashing.sha256Hex(token)))).isZero();
        assertThat(lookup.find(Hashing.sha256Hex(token))).isEmpty();   // evicted, not just deleted
        ApiClient stolen = clients.newBrowser();
        stolen.setCookie("session", token);
        assertThat(stolen.get("/session").status()).isEqualTo(401);
    }

    @Test
    void signOutWithoutASessionIs204() {
        assertThat(api.post("/auth/sign-out", null).status()).isEqualTo(204);
    }

    @Test
    void aGarbageCookieIsJustNobody() {
        api.setCookie("session", "garbage");
        assertThat(api.get("/session").status()).isEqualTo(401);
    }

    @Test
    void purgeRemovesOnlyExpiredSessions() {
        accounts.signIn(api, "old@correo.co");
        clock.advance(Duration.ofDays(400));
        accounts.signIn(clients.newBrowser(), "new@correo.co");
        assertThat(store.purgeExpired()).isEqualTo(1);
        assertThat(db.fetchCount(SESSION)).isEqualTo(1);
    }
}
```

`B/src/test/java/co/scuby/identity/SessionConfigurationTest.java`:

```java
package co.scuby.identity;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class SessionConfigurationTest {

    @Test
    void cacheSizeZeroDisablesTheCache() {
        var config = new SessionConfiguration();
        assertThat(config.sessionLookup(null, Clock.systemUTC(), new SessionProperties(0, Duration.ofSeconds(60), 12)))
                .isInstanceOf(DbSessionLookup.class);
        assertThat(config.sessionLookup(null, Clock.systemUTC(), new SessionProperties(10_000, Duration.ofSeconds(60), 12)))
                .isInstanceOf(CachingSessionLookup.class);
    }
}
```

In `FeatureFlagsTest`, remove the `@Disabled` annotation from `anOverrideWinsInEitherDirection`.

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='SessionTest,SessionConfigurationTest'`
Expected: compilation FAILURE (`PERSON`, `SESSION`, `SessionLookup` … not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261029_1020__accounts_and_sessions.sql`:

```sql
-- Accounts and sessions (docs/eng/auth.md · Sign-in, Profile; docs/eng/backend.md · Sessions).
-- person: one row per account, born lazily at sign-in. No password column, ever.
CREATE TABLE person (
  id                 uuid PRIMARY KEY,
  display_name       text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  email              text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  google_sub         text UNIQUE,
  phone              text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified_at  timestamptz,
  city               text,
  bio                text CHECK (length(bio) <= 280),
  notify_lost        boolean NOT NULL DEFAULT true,
  notify_found       boolean NOT NULL DEFAULT true,
  notify_adoption    boolean NOT NULL DEFAULT true,
  notify_help        boolean NOT NULL DEFAULT true,
  photo_url          text,
  created_at         timestamptz NOT NULL,
  CHECK (phone_verified_at IS NULL OR phone IS NOT NULL)
);

-- session: an opaque 256-bit token; only its SHA-256 is stored. Absolute expiry 12 months after
-- sign-in; reading a session never writes. No index on person_id yet: it is earned when account
-- deletion (which cascades here) or "sign out everywhere" lands.
CREATE TABLE session (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

ALTER TABLE feature_flag_overrides
  ADD CONSTRAINT feature_flag_overrides_person_fk FOREIGN KEY (person_id) REFERENCES person (id) ON DELETE CASCADE;
```

Also fix the test helper in `FeatureFlagsTest.insertPerson` if needed: it inserts `created_at` with `now()` — allowed in tests.

- [ ] **Step 4: Code**

`Person.java`:

```java
package co.scuby.identity;

import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.UUID;

record Person(UUID id, String displayName, String email, @Nullable String googleSub,
              @Nullable String phone, @Nullable Instant phoneVerifiedAt,
              @Nullable String city, @Nullable String bio,
              boolean notifyLost, boolean notifyFound, boolean notifyAdoption, boolean notifyHelp,
              @Nullable String photoUrl) {

    /** The contract's `phone`: the publisher's verified number, null until one is verified. */
    @Nullable String verifiedPhone() {
        return phoneVerifiedAt != null ? phone : null;
    }
}
```

`People.java`:

```java
package co.scuby.identity;

import co.scuby.db.generated.tables.records.PersonRecord;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;

/** The only writer of `person`. Emails arrive already normalised (trimmed, lower-case). */
@Component
class People {

    private final DSLContext db;
    private final Clock clock;

    People(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    Person get(UUID id) {
        return db.selectFrom(PERSON).where(PERSON.ID.eq(id)).fetchOptional().map(People::toPerson)
                 .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED, "the account no longer exists"));
    }

    Optional<Person> byEmail(String normalizedEmail) {
        return db.selectFrom(PERSON).where(PERSON.EMAIL.eq(normalizedEmail)).fetchOptional().map(People::toPerson);
    }

    Optional<Person> byGoogleSub(String sub) {
        return db.selectFrom(PERSON).where(PERSON.GOOGLE_SUB.eq(sub)).fetchOptional().map(People::toPerson);
    }

    /** Creates the account, or returns the one a concurrent sign-in just created for the same email. */
    Person create(String normalizedEmail, String displayName, @Nullable String googleSub) {
        db.insertInto(PERSON)
          .set(PERSON.ID, UUID.randomUUID())
          .set(PERSON.EMAIL, normalizedEmail)
          .set(PERSON.DISPLAY_NAME, displayName)
          .set(PERSON.GOOGLE_SUB, googleSub)
          .set(PERSON.CREATED_AT, clock.instant().atOffset(ZoneOffset.UTC))
          .onConflict(PERSON.EMAIL).doNothing()
          .execute();
        return byEmail(normalizedEmail).orElseThrow();
    }

    void linkGoogle(UUID id, String sub) {
        db.update(PERSON).set(PERSON.GOOGLE_SUB, sub).where(PERSON.ID.eq(id)).execute();
    }

    /** Verification belongs to the number: a new number starts unverified unless verifiedAt is given. */
    void setPhone(UUID id, String e164, @Nullable Instant verifiedAt) {
        db.update(PERSON)
          .set(PERSON.PHONE, e164)
          .set(PERSON.PHONE_VERIFIED_AT, verifiedAt == null ? null : verifiedAt.atOffset(ZoneOffset.UTC))
          .where(PERSON.ID.eq(id))
          .execute();
    }

    private static Person toPerson(PersonRecord r) {
        return new Person(r.getId(), r.getDisplayName(), r.getEmail(), r.getGoogleSub(), r.getPhone(),
                r.getPhoneVerifiedAt() == null ? null : r.getPhoneVerifiedAt().toInstant(),
                r.getCity(), r.getBio(), r.getNotifyLost(), r.getNotifyFound(), r.getNotifyAdoption(),
                r.getNotifyHelp(), r.getPhotoUrl());
    }
}
```

`UserView.java`:

```java
package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The contract's `User` (web/src/contracts/session.ts). */
record UserView(String id, String displayName, String email, @Nullable String phone) {
    static UserView of(Person p) {
        return new UserView(p.id().toString(), p.displayName(), p.email(), p.verifiedPhone());
    }
}
```

`ActiveSession.java`:

```java
package co.scuby.identity;

import java.time.Instant;
import java.util.UUID;

record ActiveSession(UUID personId, Instant expiresAt) {}
```

`SessionLookup.java`:

```java
package co.scuby.identity;

import java.util.Optional;

/** Finds a live session by its token's hash. Implementations never write and never open a transaction. */
interface SessionLookup {
    Optional<ActiveSession> find(String tokenHash);

    void evict(String tokenHash);
}
```

`DbSessionLookup.java`:

```java
package co.scuby.identity;

import org.jooq.DSLContext;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Optional;

import static co.scuby.db.generated.Tables.SESSION;

/** One autocommit SELECT; the connection goes back to the pool before the controller runs. */
final class DbSessionLookup implements SessionLookup {

    private final DSLContext db;
    private final Clock clock;

    DbSessionLookup(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    @Override
    public Optional<ActiveSession> find(String tokenHash) {
        return db.select(SESSION.PERSON_ID, SESSION.EXPIRES_AT)
                 .from(SESSION)
                 .where(SESSION.TOKEN_HASH.eq(tokenHash))
                 .and(SESSION.EXPIRES_AT.gt(clock.instant().atOffset(ZoneOffset.UTC)))
                 .fetchOptional(r -> new ActiveSession(r.value1(), r.value2().toInstant()));
    }

    @Override
    public void evict(String tokenHash) {}
}
```

`CachingSessionLookup.java`:

```java
package co.scuby.identity;

import co.scuby.platform.cache.ClearableCache;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import java.time.Clock;
import java.util.Optional;

/**
 * A bounded, short-lived cache in front of the lookup. Only live sessions are cached; the expiry is
 * re-checked against the clock on every hit; sign-out evicts locally (one instance today).
 */
final class CachingSessionLookup implements SessionLookup, ClearableCache {

    private final SessionLookup delegate;
    private final Clock clock;
    private final Cache<String, ActiveSession> cache;

    CachingSessionLookup(SessionLookup delegate, SessionProperties properties, Clock clock) {
        this.delegate = delegate;
        this.clock = clock;
        this.cache = Caffeine.newBuilder()
                             .maximumSize(properties.cacheSize())
                             .expireAfterWrite(properties.cacheTtl())
                             .build();
    }

    @Override
    public Optional<ActiveSession> find(String tokenHash) {
        ActiveSession cached = cache.getIfPresent(tokenHash);
        if (cached != null) {
            if (cached.expiresAt().isAfter(clock.instant())) return Optional.of(cached);
            cache.invalidate(tokenHash);
            return Optional.empty();
        }
        Optional<ActiveSession> found = delegate.find(tokenHash);
        found.ifPresent(s -> cache.put(tokenHash, s));
        return found;
    }

    @Override
    public void evict(String tokenHash) {
        cache.invalidate(tokenHash);
    }

    @Override
    public void clear() {
        cache.invalidateAll();
    }
}
```

`SessionProperties.java`:

```java
package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** scuby.sessions.*: cache size (0 disables it), cache TTL, absolute lifetime in months. */
@ConfigurationProperties("scuby.sessions")
record SessionProperties(int cacheSize, Duration cacheTtl, int lifetimeMonths) {}
```

`SessionConfiguration.java`:

```java
package co.scuby.identity;

import org.jooq.DSLContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration(proxyBeanMethods = false)
class SessionConfiguration {

    @Bean
    SessionLookup sessionLookup(DSLContext db, Clock clock, SessionProperties properties) {
        SessionLookup database = new DbSessionLookup(db, clock);
        return properties.cacheSize() == 0 ? database : new CachingSessionLookup(database, properties, clock);
    }
}
```

`SessionStore.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SESSION;

/** Session writes happen only here: sign-in, sign-out, the purge (account deletion cascades). */
@Component
class SessionStore {

    private final DSLContext db;
    private final Clock clock;
    private final SessionLookup lookup;
    private final SessionProperties properties;

    SessionStore(DSLContext db, Clock clock, SessionLookup lookup, SessionProperties properties) {
        this.db = db;
        this.clock = clock;
        this.lookup = lookup;
        this.properties = properties;
    }

    /** Returns the raw token for the cookie; only its hash is stored. */
    String create(UUID personId) {
        String token = Hashing.randomToken(32);
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        db.insertInto(SESSION)
          .set(SESSION.TOKEN_HASH, Hashing.sha256Hex(token))
          .set(SESSION.PERSON_ID, personId)
          .set(SESSION.CREATED_AT, now)
          .set(SESSION.EXPIRES_AT, now.plusMonths(properties.lifetimeMonths()))
          .execute();
        return token;
    }

    void delete(String tokenHash) {
        db.deleteFrom(SESSION).where(SESSION.TOKEN_HASH.eq(tokenHash)).execute();
        lookup.evict(tokenHash);
    }

    int purgeExpired() {
        return db.deleteFrom(SESSION)
                 .where(SESSION.EXPIRES_AT.le(clock.instant().atOffset(ZoneOffset.UTC)))
                 .execute();
    }
}
```

`SessionCookies.java`:

```java
package co.scuby.identity;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;
import java.util.regex.Pattern;

/** The session cookie of decision #37: httpOnly, Secure, SameSite=Lax, on the API's own host. */
@Component
class SessionCookies {

    static final String NAME = "session";
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final CookieProperties cookies;
    private final SessionProperties sessions;

    SessionCookies(CookieProperties cookies, SessionProperties sessions) {
        this.cookies = cookies;
        this.sessions = sessions;
    }

    Optional<String> read(HttpServletRequest request) {
        Cookie[] all = request.getCookies();
        if (all == null) return Optional.empty();
        for (Cookie c : all) {
            if (NAME.equals(c.getName()) && TOKEN.matcher(c.getValue()).matches()) return Optional.of(c.getValue());
        }
        return Optional.empty();
    }

    void issue(HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, base(token).maxAge(Duration.ofDays(30L * sessions.lifetimeMonths())).build().toString());
    }

    void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, base("").maxAge(Duration.ZERO).build().toString());
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value).httpOnly(true).secure(cookies.secure()).sameSite("Lax").path("/");
    }
}
```

`SessionAuthenticator.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.RequestAuthenticator;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/** The session cookie → the signed-in person. Read-only (design · Sessions: reading never writes). */
@Component
class SessionAuthenticator implements RequestAuthenticator {

    private final SessionCookies cookies;
    private final SessionLookup lookup;

    SessionAuthenticator(SessionCookies cookies, SessionLookup lookup) {
        this.cookies = cookies;
        this.lookup = lookup;
    }

    @Override
    public Optional<UUID> authenticate(HttpServletRequest request) {
        return cookies.read(request).map(Hashing::sha256Hex).flatMap(lookup::find).map(ActiveSession::personId);
    }
}
```

`SignInSessions.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Every sign-in ends here: the session the browser carried (if any) ends, a new one starts. */
@Component
class SignInSessions {

    private final SessionStore store;
    private final SessionCookies cookies;

    SignInSessions(SessionStore store, SessionCookies cookies) {
        this.store = store;
        this.cookies = cookies;
    }

    void open(UUID personId, HttpServletRequest request, HttpServletResponse response) {
        cookies.read(request).map(Hashing::sha256Hex).ifPresent(store::delete);
        cookies.issue(response, store.create(personId));
    }
}
```

`SessionController.java`:

```java
package co.scuby.identity;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class SessionController {

    private final People people;
    private final SessionStore store;
    private final SessionCookies cookies;

    SessionController(People people, SessionStore store, SessionCookies cookies) {
        this.people = people;
        this.store = store;
        this.cookies = cookies;
    }

    @GetMapping("/session")
    UserView session(Account account) {
        return UserView.of(people.get(account.personId()));
    }

    /** 204 whether or not there was a session (contract: signOut). */
    @PostMapping("/auth/sign-out")
    ResponseEntity<Void> signOut(HttpServletRequest request, HttpServletResponse response) {
        cookies.read(request).map(Hashing::sha256Hex).ifPresent(store::delete);
        cookies.clear(response);
        return ResponseEntity.noContent().build();
    }
}
```

`IdentitySecurityRules.java`:

```java
package co.scuby.identity;

import co.scuby.platform.security.SecurityRules;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.stereotype.Component;

/** identity's `session` endpoints (openapi.json security: session). */
@Component
class IdentitySecurityRules implements SecurityRules {
    @Override
    public void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules) {
        rules.requestMatchers(HttpMethod.GET, "/session").authenticated()
             .requestMatchers("/me/**").authenticated();
    }
}
```

`IdentityPurge.java`:

```java
package co.scuby.identity;

import co.scuby.platform.roles.WorkerComponent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/** Daily housekeeping of identity's rows (worker role). Later tasks add their own purges here. */
@WorkerComponent
class IdentityPurge {

    private static final Logger log = LoggerFactory.getLogger(IdentityPurge.class);

    private final SessionStore sessions;

    IdentityPurge(SessionStore sessions) {
        this.sessions = sessions;
    }

    @Scheduled(cron = "${scuby.purge.cron:0 17 3 * * *}", zone = "UTC")
    void purge() {
        log.info("purged {} expired sessions", sessions.purgeExpired());
    }
}
```

Scheduling must be enabled once: create `B/src/main/java/co/scuby/platform/time/SchedulingConfiguration.java`:

```java
package co.scuby.platform.time;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Cron-style housekeeping (@Scheduled on @WorkerComponent beans). db-scheduler replaces it when cluster-safe jobs are needed. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class SchedulingConfiguration {}
```

`application.yml`, thin-slice `scuby:` block, add:

```yaml
  sessions:
    cache-size: 10000
    cache-ttl: 60s
    lifetime-months: 12
```

`TestDb.MUTABLE_TABLES`: add `"session"` and `"person"` (order does not matter: `TRUNCATE … CASCADE`).

`StatementCeilings`: add `Map.entry("GET /session", 2)` (lookup + person) and `Map.entry("POST /auth/sign-out", 1)`.

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='SessionTest,SessionConfigurationTest,FeatureFlagsTest,DeviceCookieTest,ArchitectureTest'`
Expected: PASS. If `aSessionReadIssuesNoInsertOrUpdateAndReturnsItsConnection` reports an active connection, something opened a transaction across the request — find it (a `@Transactional` on a controller or filter) and remove it; never relax the assertion.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261029_1020__accounts_and_sessions.sql backend/src/main/java/co/scuby/identity backend/src/main/java/co/scuby/platform/time backend/src/main/resources/application.yml backend/src/test/java/co/scuby/support backend/src/test/java/co/scuby/identity backend/src/test/java/co/scuby/platform/flags
git commit -m "feat: sessions — opaque token hashed at rest, 12-month absolute expiry, cached read-only lookup, GET /session and sign-out"
```

---
### Task 8: Email-code sign-in

Rules (design · Behaviour decisions, "Email code"): 6 digits, stored hashed, 5-minute expiry, 3 attempts, 60 s resend cooldown, at most 10 sends per address per UTC day; address normalised (trim, lower-case); `start` always answers 204 (it never reveals whether an account exists, nor whether a send was skipped). Accounts are born lazily at the first successful verify, named from the address like the client mock does (`juan.perez@correo.co` → «Juan Perez»). **Test bypass:** for addresses on a configured test domain the code is the fixed `scuby.auth.test-bypass.code`; enabling any bypass under `prod` fails start-up. The sender writes the code to the log in `local`, `test` and `staging`; no `EmailSender` exists under `prod` yet (the real provider comes with the domain — open item O23), so a prod start-up fails loudly instead of silently not sending.

**Files:**
- Create: `B/src/main/resources/db/migration/V20261029_1030__email_codes.sql`
- Create in `B/src/main/java/co/scuby/identity/`: `EmailSender.java`, `LogEmailSender.java`, `TestBypass.java`, `TestBypassGuard.java`, `DisplayNames.java`, `EmailCodes.java`, `EmailSignIn.java`, `EmailRequests.java`, `EmailSignInController.java`
- Modify: `B/src/main/resources/application.yml`, `application-test.yml`, `application-local.yml`
- Create: `B/src/test/java/co/scuby/support/RecordingEmailSender.java`; modify `TestSupportConfiguration.java`, `TestDb.java`, `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/identity/EmailSignInTest.java`, `DisplayNamesTest.java`, `TestBypassGuardTest.java`

**Interfaces:**
- Consumes: `People`, `SignInSessions`, `UserView`, `Hashing`, `Prod`, `Clock`.
- Produces:
  - `interface EmailSender { void sendSignInCode(String email, String code); }` (identity, package-private) + `LogEmailSender` (`@Profile("!prod")`).
  - `record TestBypass(List<String> emailDomains, List<String> smsPrefixes, String code)` bound to `scuby.auth.test-bypass`; `boolean emailBypassed(String normalizedEmail)`, `boolean smsBypassed(String e164)`. Task 10 uses `smsBypassed`.
  - `DisplayNames.fromEmail(String) → String`.
  - `EmailCodes.start(String normalizedEmail)`, `EmailCodes.consume(String normalizedEmail, String code) → boolean`.
  - `POST /auth/email/start` → 204; `POST /auth/email/verify` → `UserView` + session cookie.
  - Test support `RecordingEmailSender`: `List<Sent> sent()`, `String lastCodeFor(String email)`, `void clear()`; `record Sent(String email, String code)`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/support/RecordingEmailSender.java`:

```java
package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Stands in for EmailSender in tests (registered @Primary by TestSupportConfiguration). */
public class RecordingEmailSender {

    public record Sent(String email, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    public void record(String email, String code) { sent.add(new Sent(email, code)); }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String email) {
        return sent.reversed().stream().filter(s -> s.email().equals(email)).findFirst()
                   .orElseThrow(() -> new AssertionError("no code sent to " + email)).code();
    }

    public void clear() { sent.clear(); }
}
```

`EmailSender` is package-private in `identity`, so the test adapter that implements it lives in the test sources of `identity` — create `B/src/test/java/co/scuby/identity/IdentityTestBeans.java`:

```java
package co.scuby.identity;

import co.scuby.support.RecordingEmailSender;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Test doubles for identity's package-private ports; imported by TestSupportConfiguration. */
@TestConfiguration(proxyBeanMethods = false)
public class IdentityTestBeans {

    @Bean
    RecordingEmailSender recordingEmailSender() {
        return new RecordingEmailSender();
    }

    @Bean
    @Primary
    EmailSender testEmailSender(RecordingEmailSender recorder) {
        return recorder::record;
    }
}
```

In `TestSupportConfiguration`, add `@org.springframework.context.annotation.Import(co.scuby.identity.IdentityTestBeans.class)` on the class. In `TestDb`, add a constructor parameter `ObjectProvider<RecordingEmailSender> emails` and call `emails.ifAvailable(RecordingEmailSender::clear)` in `reset()`; update the `testDb` bean method accordingly.

`B/src/test/java/co/scuby/identity/DisplayNamesTest.java`:

```java
package co.scuby.identity;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class DisplayNamesTest {

    @ParameterizedTest
    @CsvSource({
            "juan.perez@correo.co, Juan Perez",
            "ana_gomez-ruiz@x.co, Ana Gomez Ruiz",
            "carolina@correo.co, Carolina",
            "...@x.co, ...",
    })
    void nameFromTheAddress(String email, String expected) {
        assertThat(DisplayNames.fromEmail(email)).isEqualTo(expected);
    }
}
```

`B/src/test/java/co/scuby/identity/TestBypassGuardTest.java`:

```java
package co.scuby.identity;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class TestBypassGuardTest {

    @Configuration
    @EnableConfigurationProperties(TestBypass.class)
    static class Config {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Config.class, TestBypassGuard.class);

    @Test
    void aBypassUnderProdFailsStartUp() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("prod"))
              .withPropertyValues("scuby.auth.test-bypass.email-domains=e2e.scuby.test")
              .run(ctx -> assertThat(ctx).hasFailed());
    }

    @Test
    void noBypassUnderProdStarts() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("prod"))
              .run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void aBypassElsewhereStarts() {
        runner.withInitializer(ctx -> ctx.getEnvironment().setActiveProfiles("staging"))
              .withPropertyValues("scuby.auth.test-bypass.sms-prefixes=+5730000000")
              .run(ctx -> assertThat(ctx).hasNotFailed());
    }
}
```

`B/src/test/java/co/scuby/identity/EmailSignInTest.java`:

```java
package co.scuby.identity;

import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class EmailSignInTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired RecordingEmailSender emails;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse start(String email) {
        return api.post("/auth/email/start", "{\"email\":\"" + email + "\"}");
    }

    private ApiResponse verify(String email, String code) {
        return api.post("/auth/email/verify", "{\"email\":\"" + email + "\",\"code\":\"" + code + "\"}");
    }

    @Test
    void theEmailedCodeSignsInAndBearsTheAccountLazily() {
        assertThat(start("Juan.Perez@Correo.co").status()).isEqualTo(204);
        String code = emails.lastCodeFor("juan.perez@correo.co");
        assertThat(code).matches("^\\d{6}$");
        assertThat(db.fetchCount(PERSON)).isZero();

        ApiResponse r = verify("juan.perez@correo.co", code);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Juan Perez");
        assertThat(r.str("/email")).isEqualTo("juan.perez@correo.co");
        assertThat(r.setCookies()).anyMatch(c -> c.startsWith("session=") && c.contains("HttpOnly")
                && c.contains("Secure") && c.contains("SameSite=Lax"));
        assertThat(api.get("/session").str("/email")).isEqualTo("juan.perez@correo.co");
    }

    @Test
    void aSecondSignInReusesTheAccount() {
        start("ana@correo.co");
        String first = verify("ana@correo.co", emails.lastCodeFor("ana@correo.co")).str("/id");
        clock.advance(Duration.ofMinutes(2));
        start("ana@correo.co");
        String second = clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"ana@correo.co\",\"code\":\"" + emails.lastCodeFor("ana@correo.co") + "\"}").str("/id");
        assertThat(second).isEqualTo(first);
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void aWrongCodeIsInvalidAndThreeWrongOnesBurnTheCode() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 3; i++) assertThat(verify("ana@correo.co", wrong).errorCode()).isEqualTo("invalid_code");
        assertThat(verify("ana@correo.co", code).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeExpiresAfterFiveMinutes() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(verify("ana@correo.co", code).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeWorksOnce() {
        start("ana@correo.co");
        String code = emails.lastCodeFor("ana@correo.co");
        assertThat(verify("ana@correo.co", code).status()).isEqualTo(200);
        assertThat(clients.newBrowser().post("/auth/email/verify",
                "{\"email\":\"ana@correo.co\",\"code\":\"" + code + "\"}").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void anAddressNeverStartedIsInvalid() {
        assertThat(verify("nadie@correo.co", "123456").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void resendingWaitsSixtySecondsAndStopsAtTenADayButAlwaysAnswers204() {
        start("ana@correo.co");
        assertThat(start("ana@correo.co").status()).isEqualTo(204);
        assertThat(emails.sent()).hasSize(1);
        for (int i = 0; i < 12; i++) {
            clock.advance(Duration.ofSeconds(61));
            assertThat(start("ana@correo.co").status()).isEqualTo(204);
        }
        assertThat(emails.sent()).hasSize(10);
        clock.set(MutableClock.START.plus(Duration.ofDays(1)));
        start("ana@correo.co");
        assertThat(emails.sent()).hasSize(11);
    }

    @Test
    void theTestDomainUsesTheFixedCode() {
        start("e2e-1@e2e.scuby.test");
        assertThat(verify("e2e-1@e2e.scuby.test", "123456").status()).isEqualTo(200);
    }

    @Test
    void aBodyTheContractRejectsNamesTheField() {
        ApiResponse r = api.post("/auth/email/verify", "{\"email\":\"no-arroba\",\"code\":\"12\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("email")).isTrue();
        assertThat(r.json().at("/error/fields").has("code")).isTrue();
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='EmailSignInTest,DisplayNamesTest,TestBypassGuardTest'`
Expected: compilation FAILURE (`EmailSender`, `TestBypass` … not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261029_1030__email_codes.sql`:

```sql
-- Email sign-in codes (docs/eng/auth.md · Sign-in): one pending code per address, stored hashed;
-- 5-minute expiry, 3 attempts, 60 s resend cooldown, 10 sends per address per UTC day.
-- Lookups are by primary key only.
CREATE TABLE email_code (
  email         text PRIMARY KEY CHECK (email = lower(btrim(email))),
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL,
  sends_day     date NOT NULL,
  sends_on_day  int NOT NULL
);
```

- [ ] **Step 4: Code**

`EmailSender.java`:

```java
package co.scuby.identity;

/** The email channel for sign-in codes. Real provider: open item O23 (leaning SES). */
interface EmailSender {
    void sendSignInCode(String email, String code);
}
```

`LogEmailSender.java`:

```java
package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** local, test and staging: the code goes to the log. Not under prod — prod has no sender until O23 closes. */
@Component
@Profile("!prod")
class LogEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LogEmailSender.class);

    @Override
    public void sendSignInCode(String email, String code) {
        log.info("sign-in code for {}: {}", email, code);
    }
}
```

`TestBypass.java`:

```java
package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;
import java.util.Locale;

/**
 * Fixed codes for e2e runs (design · Test bypasses): addresses on these domains and numbers with these
 * prefixes accept `code`. Refused under prod by TestBypassGuard.
 */
@ConfigurationProperties("scuby.auth.test-bypass")
record TestBypass(List<String> emailDomains, List<String> smsPrefixes, String code) {

    TestBypass {
        emailDomains = emailDomains == null ? List.of() : emailDomains.stream().map(d -> d.toLowerCase(Locale.ROOT)).toList();
        smsPrefixes = smsPrefixes == null ? List.of() : List.copyOf(smsPrefixes);
        if (code == null || !code.matches("^\\d{6}$")) code = "123456";
    }

    boolean emailBypassed(String normalizedEmail) {
        return emailDomains.stream().anyMatch(d -> normalizedEmail.endsWith("@" + d));
    }

    boolean smsBypassed(String e164) {
        return smsPrefixes.stream().anyMatch(e164::startsWith);
    }

    boolean any() {
        return !emailDomains.isEmpty() || !smsPrefixes.isEmpty();
    }
}
```

`TestBypassGuard.java`:

```java
package co.scuby.identity;

import co.scuby.platform.config.Prod;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
class TestBypassGuard {
    TestBypassGuard(TestBypass bypass, Environment env) {
        Prod.refuse(env, bypass.any(), "a sign-in/SMS test bypass is configured (scuby.auth.test-bypass)");
    }
}
```

`DisplayNames.java`:

```java
package co.scuby.identity;

import java.util.Arrays;
import java.util.stream.Collectors;

/** «juan.perez@correo.co» → «Juan Perez» until the person names themselves (as the client mock: web/src/mocks/rules.ts). */
final class DisplayNames {

    private DisplayNames() {}

    static String fromEmail(String email) {
        String local = email.substring(0, Math.max(email.indexOf('@'), 0));
        String name = Arrays.stream(local.split("[._-]+"))
                            .filter(p -> !p.isEmpty())
                            .map(p -> Character.toUpperCase(p.charAt(0)) + p.substring(1))
                            .collect(Collectors.joining(" "));
        String result = name.isBlank() ? local : name;
        return result.length() > 80 ? result.substring(0, 80) : result;
    }
}
```

`EmailCodes.java`:

```java
package co.scuby.identity;

import co.scuby.db.generated.tables.records.EmailCodeRecord;
import co.scuby.platform.crypto.Hashing;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.EMAIL_CODE;

/** Sign-in codes (design · Behaviour decisions, Email code). Callers run these inside a transaction. */
@Component
class EmailCodes {

    static final Duration TTL = Duration.ofMinutes(5);
    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 3;
    static final int MAX_SENDS_PER_DAY = 10;

    private final DSLContext db;
    private final Clock clock;
    private final EmailSender sender;
    private final TestBypass bypass;

    EmailCodes(DSLContext db, Clock clock, EmailSender sender, TestBypass bypass) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
    }

    /** Sends a new code unless inside the cooldown or over the daily cap. Silent either way. */
    void start(String email) {
        Instant now = clock.instant();
        LocalDate today = now.atOffset(ZoneOffset.UTC).toLocalDate();
        EmailCodeRecord row = db.selectFrom(EMAIL_CODE).where(EMAIL_CODE.EMAIL.eq(email)).forUpdate().fetchOne();
        if (row != null && row.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return;
        int sendsToday = row != null && row.getSendsDay().equals(today) ? row.getSendsOnDay() : 0;
        if (sendsToday >= MAX_SENDS_PER_DAY) return;

        String code = bypass.emailBypassed(email) ? bypass.code() : Hashing.randomDigits(6);
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        db.insertInto(EMAIL_CODE)
          .set(EMAIL_CODE.EMAIL, email)
          .set(EMAIL_CODE.CODE_HASH, hash(email, code))
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .set(EMAIL_CODE.SENDS_DAY, today)
          .set(EMAIL_CODE.SENDS_ON_DAY, sendsToday + 1)
          .onConflict(EMAIL_CODE.EMAIL).doUpdate()
          .set(EMAIL_CODE.CODE_HASH, hash(email, code))
          .set(EMAIL_CODE.EXPIRES_AT, at.plus(TTL))
          .set(EMAIL_CODE.ATTEMPTS, 0)
          .set(EMAIL_CODE.SENT_AT, at)
          .set(EMAIL_CODE.SENDS_DAY, today)
          .set(EMAIL_CODE.SENDS_ON_DAY, sendsToday + 1)
          .execute();
        sender.sendSignInCode(email, code);
    }

    /** True once per code: a right code is consumed; a wrong one costs an attempt (the caller's transaction must commit it). */
    boolean consume(String email, String code) {
        EmailCodeRecord row = db.selectFrom(EMAIL_CODE).where(EMAIL_CODE.EMAIL.eq(email)).forUpdate().fetchOne();
        if (row == null || row.getAttempts() >= MAX_ATTEMPTS || !row.getExpiresAt().toInstant().isAfter(clock.instant())) {
            return false;
        }
        if (!row.getCodeHash().equals(hash(email, code))) {
            db.update(EMAIL_CODE).set(EMAIL_CODE.ATTEMPTS, row.getAttempts() + 1).where(EMAIL_CODE.EMAIL.eq(email)).execute();
            return false;
        }
        // Keep the row (its send counters gate the daily cap); make the code unusable.
        db.update(EMAIL_CODE).set(EMAIL_CODE.ATTEMPTS, MAX_ATTEMPTS).where(EMAIL_CODE.EMAIL.eq(email)).execute();
        return true;
    }

    private static String hash(String email, String code) {
        return Hashing.sha256Hex(email + ":" + code);
    }
}
```

`EmailRequests.java`:

```java
package co.scuby.identity;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** EmailStartRequest / EmailVerifyRequest (web/src/contracts/session.ts). */
final class EmailRequests {

    static final String EMAIL = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

    private EmailRequests() {}

    record Start(@NotNull @Pattern(regexp = EMAIL) String email) {}

    record Verify(@NotNull @Pattern(regexp = EMAIL) String email, @NotNull @Pattern(regexp = "^\\d{6}$") String code) {}
}
```

`EmailSignIn.java`:

```java
package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
class EmailSignIn {

    private final EmailCodes codes;
    private final People people;

    EmailSignIn(EmailCodes codes, People people) {
        this.codes = codes;
        this.people = people;
    }

    static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public void start(String email) {
        codes.start(normalize(email));
    }

    /** A wrong code throws invalid_code, but the spent attempt is committed (noRollbackFor). */
    @Transactional(noRollbackFor = ApiException.class)
    public Person verify(String email, String code) {
        String normalized = normalize(email);
        if (!codes.consume(normalized, code)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        return people.byEmail(normalized).orElseGet(() -> people.create(normalized, DisplayNames.fromEmail(normalized), null));
    }
}
```

`EmailSignInController.java`:

```java
package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class EmailSignInController {

    private final EmailSignIn signIn;
    private final SignInSessions sessions;

    EmailSignInController(EmailSignIn signIn, SignInSessions sessions) {
        this.signIn = signIn;
        this.sessions = sessions;
    }

    /** Always 204: never reveals whether the address has an account or whether a send was skipped. */
    @PostMapping("/auth/email/start")
    ResponseEntity<Void> start(@Valid @RequestBody EmailRequests.Start body) {
        signIn.start(body.email());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/auth/email/verify")
    UserView verify(@Valid @RequestBody EmailRequests.Verify body, HttpServletRequest request, HttpServletResponse response) {
        Person person = signIn.verify(body.email(), body.code());
        sessions.open(person.id(), request, response);
        return UserView.of(person);
    }
}
```

Configuration. `application.yml`, thin-slice `scuby:` block, add:

```yaml
  auth:
    test-bypass:
      email-domains: []
      sms-prefixes: []
      code: "123456"
```

`application-test.yml`, under `scuby:` add:

```yaml
  auth:
    test-bypass:
      email-domains: [ "e2e.scuby.test" ]
      sms-prefixes: [ "+5730000000" ]
```

`application-local.yml`, under `scuby:` add the same `auth.test-bypass` block (local runs and the e2e acceptance in plan A2 use it; the log sender still prints real codes for every other address).

`TestDb.MUTABLE_TABLES`: add `"email_code"`. `StatementCeilings`: add `Map.entry("POST /auth/email/start", 2)` and `Map.entry("POST /auth/email/verify", 6)` (consume select+update, person lookup, person insert+select, session insert; the new browser has no session to delete).

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='EmailSignInTest,DisplayNamesTest,TestBypassGuardTest,ArchitectureTest'`
Expected: PASS. Note the measured statement counts for both endpoints in the report and lower the ceilings to them if lower.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261029_1030__email_codes.sql backend/src/main/java/co/scuby/identity backend/src/main/resources/application*.yml backend/src/test/java/co/scuby/support backend/src/test/java/co/scuby/identity
git commit -m "feat: email-code sign-in — hashed 6-digit codes, expiry, attempts, cooldown, daily cap, lazy accounts, prod-refused test domain"
```

---

### Task 9: Google sign-in (ID token verified with NimbusJwtDecoder)

The client sends Google's ID token (`POST /auth/google {credential}`); the backend verifies the signature against Google's keys, `aud` = our client ID, `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, expiry; requires `email_verified`; the identity key is `sub`; a first Google sign-in links to an existing account with the same (verified) email. Any rejection is `unauthorized`. No OAuth redirect, no client secret. Tests use a locally generated RSA key — no network.

**Files:**
- Create in `B/src/main/java/co/scuby/identity/`: `GoogleProperties.java`, `GoogleIdTokenConfiguration.java`, `GoogleIdentity.java`, `GoogleIdTokens.java`, `GoogleSignIn.java`, `GoogleSignInController.java`
- Modify: `B/src/main/resources/application.yml`, `application-test.yml`
- Create: `B/src/test/java/co/scuby/support/GoogleTestKeys.java`; modify `B/src/test/java/co/scuby/identity/IdentityTestBeans.java`, `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/identity/GoogleSignInTest.java`

**Interfaces:**
- Consumes: `People`, `SignInSessions`, `UserView`, `DisplayNames`, `EmailSignIn.normalize`.
- Produces:
  - `record GoogleProperties(String clientId, String jwkSetUri)` bound to `scuby.auth.google`.
  - `GoogleIdTokenConfiguration.validator(String clientId, Clock clock) → OAuth2TokenValidator<Jwt>` (static, reused by the test decoder) and the bean `JwtDecoder googleIdTokenDecoder`.
  - `GoogleIdTokens.verify(String credential) → GoogleIdentity` (throws `ApiException(UNAUTHORIZED)`); `record GoogleIdentity(String sub, String email, String name)`.
  - `POST /auth/google` → `UserView` + session cookie.
  - Test support `GoogleTestKeys`: `String token(Map<String, Object> claims)` signed with the test key, `String tokenSignedByAnotherKey(Map<String, Object>)`, `RSAPublicKey publicKey()`, `static Map<String, Object> claims(String sub, String email, Instant now)` (valid defaults: `iss`, `aud` = `test-google-client-id`, `iat`, `exp` = now + 1 h, `email_verified` = true, `name`).

- [ ] **Step 1: Write the failing test**

`B/src/test/java/co/scuby/support/GoogleTestKeys.java`:

```java
package co.scuby.support;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** A local stand-in for Google's signing keys: tests never reach the network. */
public final class GoogleTestKeys {

    public static final String CLIENT_ID = "test-google-client-id";

    private final KeyPair ours = generate();
    private final KeyPair theirs = generate();

    public RSAPublicKey publicKey() { return (RSAPublicKey) ours.getPublic(); }

    public String token(Map<String, Object> claims) { return sign(claims, ours); }

    public String tokenSignedByAnotherKey(Map<String, Object> claims) { return sign(claims, theirs); }

    public static Map<String, Object> claims(String sub, String email, Instant now) {
        Map<String, Object> c = new HashMap<>();
        c.put("iss", "https://accounts.google.com");
        c.put("aud", CLIENT_ID);
        c.put("sub", sub);
        c.put("email", email);
        c.put("email_verified", true);
        c.put("name", "Carolina Mejía");
        c.put("iat", Date.from(now));
        c.put("exp", Date.from(now.plusSeconds(3600)));
        return c;
    }

    private static String sign(Map<String, Object> claims, KeyPair key) {
        try {
            JWTClaimsSet.Builder b = new JWTClaimsSet.Builder();
            claims.forEach((k, v) -> b.claim(k, v instanceof List<?> l ? l : v));
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test").build(), b.build());
            jwt.sign(new RSASSASigner(key.getPrivate()));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static KeyPair generate() {
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            return g.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

In `IdentityTestBeans` add:

```java
    @Bean
    co.scuby.support.GoogleTestKeys googleTestKeys() {
        return new co.scuby.support.GoogleTestKeys();
    }

    /** Same validators as production, keys from GoogleTestKeys instead of Google's JWKS URL. */
    @Bean
    @Primary
    org.springframework.security.oauth2.jwt.JwtDecoder testGoogleIdTokenDecoder(co.scuby.support.GoogleTestKeys keys, java.time.Clock clock) {
        var decoder = org.springframework.security.oauth2.jwt.NimbusJwtDecoder.withPublicKey(keys.publicKey()).build();
        decoder.setJwtValidator(GoogleIdTokenConfiguration.validator(co.scuby.support.GoogleTestKeys.CLIENT_ID, clock));
        return decoder;
    }
```

`B/src/test/java/co/scuby/identity/GoogleSignInTest.java`:

```java
package co.scuby.identity;

import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.GoogleTestKeys;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingEmailSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.Map;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class GoogleSignInTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired GoogleTestKeys keys;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired RecordingEmailSender emails;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    private ApiResponse google(String credential) {
        return api.post("/auth/google", "{\"credential\":\"" + credential + "\"}");
    }

    private Map<String, Object> claims() {
        return GoogleTestKeys.claims("google-sub-1", "carolina@correo.co", clock.instant());
    }

    @Test
    void aValidTokenSignsInAndCreatesTheAccountNamedByGoogle() {
        ApiResponse r = google(keys.token(claims()));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Carolina Mejía");
        assertThat(r.str("/email")).isEqualTo("carolina@correo.co");
        assertThat(api.get("/session").status()).isEqualTo(200);
        assertThat(db.fetchOne(PERSON).getGoogleSub()).isEqualTo("google-sub-1");
    }

    @Test
    void theSameGoogleAccountIsTheSamePerson() {
        String first = google(keys.token(claims())).str("/id");
        String second = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}").str("/id");
        assertThat(second).isEqualTo(first);
    }

    @Test
    void aFirstGoogleSignInLinksToTheAccountWithThatEmail() {
        api.post("/auth/email/start", "{\"email\":\"carolina@correo.co\"}");
        String viaEmail = api.post("/auth/email/verify",
                "{\"email\":\"carolina@correo.co\",\"code\":\"" + emails.lastCodeFor("carolina@correo.co") + "\"}").str("/id");
        String viaGoogle = clients.newBrowser().post("/auth/google", "{\"credential\":\"" + keys.token(claims()) + "\"}").str("/id");
        assertThat(viaGoogle).isEqualTo(viaEmail);
        assertThat(db.fetchCount(PERSON)).isEqualTo(1);
    }

    @Test
    void anUnverifiedEmailIsRefused() {
        var c = claims();
        c.put("email_verified", false);
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anotherAppsTokenIsRefused() {
        var c = claims();
        c.put("aud", "someone-elses-client-id");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aForeignIssuerIsRefused() {
        var c = claims();
        c.put("iss", "https://evil.example");
        assertThat(google(keys.token(c)).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anExpiredTokenIsRefused() {
        String token = keys.token(claims());
        clock.advance(Duration.ofHours(2));
        assertThat(google(token).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aTokenSignedByAnotherKeyIsRefused() {
        assertThat(google(keys.tokenSignedByAnotherKey(claims())).errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void garbageIsRefused() {
        assertThat(google("not-a-jwt").errorCode()).isEqualTo("unauthorized");
    }
}
```

`application-test.yml`, under `scuby.auth` add:

```yaml
    google:
      client-id: test-google-client-id
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=GoogleSignInTest`
Expected: compilation FAILURE (`GoogleIdTokenConfiguration` not found).

- [ ] **Step 3: Code**

`GoogleProperties.java`:

```java
package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.auth.google.*: our OAuth client ID (the token's audience) and Google's key set. */
@ConfigurationProperties("scuby.auth.google")
record GoogleProperties(String clientId, String jwkSetUri) {}
```

`GoogleIdTokenConfiguration.java`:

```java
package co.scuby.identity;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.time.Clock;
import java.time.Duration;
import java.util.Collection;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
class GoogleIdTokenConfiguration {

    private static final Set<String> ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");

    /** Keys are fetched from Google lazily, at the first sign-in (no network at start-up). */
    @Bean
    JwtDecoder googleIdTokenDecoder(GoogleProperties google, Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(google.jwkSetUri())
                                                   .jwsAlgorithm(SignatureAlgorithm.RS256).build();
        decoder.setJwtValidator(validator(google.clientId(), clock));
        return decoder;
    }

    /** Expiry (60 s skew) on our clock, Google as issuer, our client ID in the audience. */
    static OAuth2TokenValidator<Jwt> validator(String clientId, Clock clock) {
        JwtTimestampValidator time = new JwtTimestampValidator(Duration.ofSeconds(60));
        time.setClock(clock);
        OAuth2TokenValidator<Jwt> issuer = new JwtClaimValidator<Object>(JwtClaimNames.ISS,
                iss -> iss != null && ISSUERS.contains(iss.toString()));
        OAuth2TokenValidator<Jwt> audience = new JwtClaimValidator<Object>(JwtClaimNames.AUD,
                aud -> aud instanceof Collection<?> c ? c.contains(clientId) : clientId.equals(aud));
        return new DelegatingOAuth2TokenValidator<>(time, issuer, audience);
    }
}
```

`GoogleIdentity.java`:

```java
package co.scuby.identity;

record GoogleIdentity(String sub, String email, String name) {}
```

`GoogleIdTokens.java`:

```java
package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;

@Component
class GoogleIdTokens {

    private final JwtDecoder decoder;

    GoogleIdTokens(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    /** Any failure — signature, issuer, audience, expiry, unverified email — is `unauthorized`. */
    GoogleIdentity verify(String credential) {
        Jwt jwt;
        try {
            jwt = decoder.decode(credential);
        } catch (JwtException e) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google rejected the token");
        }
        Object verified = jwt.getClaim("email_verified");
        String email = jwt.getClaimAsString("email");
        if (!(Boolean.TRUE.equals(verified) || "true".equals(verified)) || email == null || jwt.getSubject() == null) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Google account email is not verified");
        }
        String name = jwt.getClaimAsString("name");
        return new GoogleIdentity(jwt.getSubject(), email, name);
    }
}
```

`GoogleSignIn.java`:

```java
package co.scuby.identity;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class GoogleSignIn {

    private final GoogleIdTokens tokens;
    private final People people;

    GoogleSignIn(GoogleIdTokens tokens, People people) {
        this.tokens = tokens;
        this.people = people;
    }

    /** By `sub`; else link the account with the same verified email; else create one. */
    @Transactional
    public Person signIn(String credential) {
        GoogleIdentity google = tokens.verify(credential);
        return people.byGoogleSub(google.sub()).orElseGet(() -> {
            String email = EmailSignIn.normalize(google.email());
            return people.byEmail(email).map(p -> {
                people.linkGoogle(p.id(), google.sub());
                return people.get(p.id());
            }).orElseGet(() -> people.create(email,
                    google.name() == null || google.name().isBlank() ? DisplayNames.fromEmail(email) : google.name().strip(),
                    google.sub()));
        });
    }
}
```

`GoogleSignInController.java`:

```java
package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class GoogleSignInController {

    record GoogleSignInRequest(@NotBlank String credential) {}

    private final GoogleSignIn signIn;
    private final SignInSessions sessions;

    GoogleSignInController(GoogleSignIn signIn, SignInSessions sessions) {
        this.signIn = signIn;
        this.sessions = sessions;
    }

    @PostMapping("/auth/google")
    UserView google(@Valid @RequestBody GoogleSignInRequest body, HttpServletRequest request, HttpServletResponse response) {
        Person person = signIn.signIn(body.credential());
        sessions.open(person.id(), request, response);
        return UserView.of(person);
    }
}
```

`application.yml`, thin-slice `scuby.auth` block, add:

```yaml
    google:
      client-id: local-google-client-id
      jwk-set-uri: https://www.googleapis.com/oauth2/v3/certs
```

`StatementCeilings`: add `Map.entry("POST /auth/google", 5)`.

- [ ] **Step 4: Run**

Run: `[mvn] -q test -Dtest='GoogleSignInTest,EmailSignInTest,ArchitectureTest'`
Expected: PASS (9 + 9 + 4). Also check the start-up log of this run no longer prints `Using generated security password` (a `JwtDecoder` bean now exists); if it does, apply the exclusion described in Task 1 Step 8.

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/java/co/scuby/identity backend/src/main/resources/application*.yml backend/src/test/java/co/scuby/support backend/src/test/java/co/scuby/identity
git commit -m "feat: Google sign-in — ID token verified with NimbusJwtDecoder (signature, aud, iss, expiry, email_verified), linked by sub then email"
```

---
### Task 10: Phone OTP — `POST /me/phone`, `POST /me/phone/verify`

The checklist of `docs/eng/auth.md` · OTP mechanics, none skippable: 6-digit code stored hashed, 5-minute expiry, max 3 attempts, invalidated on success; resend cooldown 60 s; max 4 sends per number per rolling 24 h; per-device and per-IP throttles (decided here: **10 per device and 20 per IP per rolling 24 h** — record in the report; Task 13 writes the numbers into `auth.md`); number validated **before any send** (libphonenumber + the country's `mobile_pattern` from `supported_countries`); a daily spend alarm (a `WARN` log line `sms.daily_send_alarm` when sends in the last 24 h exceed `scuby.sms.alarm-daily-sends`, default 50 — the metric/alert itself arrives with telemetry on branch `be/observability`). Test numbers (`scuby.auth.test-bypass.sms-prefixes`) accept the fixed code and send nothing. `/me/phone` is **not** gated by `publisher_phone_otp` (the flag gates the publish step only — `docs/eng/feature-flags.md` registry); a repeat inside the cooldown answers 204 without resending; a throttle answers `rate_limited`.

**Files:**
- Create: `B/src/main/resources/db/migration/V20261029_1040__phone_otp.sql`
- Create (only after Step 6 shows the seq scan): `B/src/main/resources/db/migration/V20261029_1050__sms_send_sent_at_index.sql`
- Create in `B/src/main/java/co/scuby/identity/`: `SmsSender.java`, `LogSmsSender.java`, `SmsProperties.java`, `PhoneNumbers.java`, `PhoneOtp.java`, `ProfileView.java`, `PhoneRequests.java`, `PhoneController.java`
- Modify: `IdentityPurge.java`, `application.yml`, `IdentityTestBeans.java`, `TestDb.java`, `StatementCeilings.java`
- Create: `B/src/test/java/co/scuby/support/RecordingSmsSender.java`
- Test: `B/src/test/java/co/scuby/identity/PhoneNumbersTest.java`, `PhoneEndpointsTest.java`, `SmsSendPlanTest.java`

**Interfaces:**
- Consumes: `SupportedCountries`, `TestBypass.smsBypassed`, `People.setPhone`, `Caller`, `Account`, `Hashing`.
- Produces:
  - `@ModuleApi public class PhoneNumbers`: `public String requireMobile(String e164, String field)` → normalised E.164, or `ApiException(VALIDATION_FAILED, fields = {field: "not a supported mobile number"})`.
  - `interface SmsSender { void sendCode(String e164, String code); }` + `LogSmsSender` (`@Profile("!prod")`).
  - `PhoneOtp`: `enum Sent { SENT, COOLDOWN }`; `Sent send(UUID personId, String e164, Caller caller)` (throws `rate_limited`; runs in the caller's transaction or its own); `boolean check(UUID personId, String e164, String code)` — **`Propagation.REQUIRES_NEW`**, so a wrong attempt is committed even when the caller then throws and rolls back.
  - `record ProfileView(String displayName, String email, @Nullable String phone, @Nullable String city, @Nullable String bio, NotificationPrefs notificationPrefs, @Nullable String photoUrl)` — the contract's `Profile`.
  - Tables `phone_otp` (PK person_id+phone) and `sms_send` (send log for the throttles; purged after 30 days).
  - Test support `RecordingSmsSender`: `List<Sent> sent()`, `String lastCodeFor(String e164)`, `void clear()`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/support/RecordingSmsSender.java`:

```java
package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class RecordingSmsSender {

    public record Sent(String phone, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    public void record(String phone, String code) { sent.add(new Sent(phone, code)); }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String phone) {
        return sent.reversed().stream().filter(s -> s.phone().equals(phone)).findFirst()
                   .orElseThrow(() -> new AssertionError("no SMS sent to " + phone)).code();
    }

    public void clear() { sent.clear(); }
}
```

In `IdentityTestBeans` add:

```java
    @Bean
    co.scuby.support.RecordingSmsSender recordingSmsSender() {
        return new co.scuby.support.RecordingSmsSender();
    }

    @Bean
    @Primary
    SmsSender testSmsSender(co.scuby.support.RecordingSmsSender recorder) {
        return recorder::record;
    }
```

In `TestDb`, add `ObjectProvider<RecordingSmsSender> sms` and clear it in `reset()` like the email recorder.

`B/src/test/java/co/scuby/identity/PhoneNumbersTest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PhoneNumbersTest {

    @Autowired PhoneNumbers numbers;

    @Test
    void aColombianMobileIsAccepted() {
        assertThat(numbers.requireMobile("+573007152284", "phone")).isEqualTo("+573007152284");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "+5716012345",        // Bogotá landline: valid number, not a mobile (pattern ^3\d{9}$)
            "+57300715228",       // one digit short
            "+12025550123",       // a country we do not support
            "3007152284",         // not E.164
            "+57abc"
    })
    void anythingElseIsValidationFailedOnTheField(String phone) {
        assertThatThrownBy(() -> numbers.requireMobile(phone, "pet.phone"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getBody().getProperties().get("fields").toString()).contains("pet.phone"));
    }
}
```

`B/src/test/java/co/scuby/identity/PhoneEndpointsTest.java`:

```java
package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class PhoneEndpointsTest {

    static final String PHONE = "+573009998877";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        accounts.signIn(api, "carolina@correo.co");
    }

    private ApiResponse startChange(ApiClient as, String phone) {
        return as.post("/me/phone", "{\"phone\":\"" + phone + "\"}");
    }

    private ApiResponse verify(String phone, String code) {
        return api.post("/me/phone/verify", "{\"phone\":\"" + phone + "\",\"code\":\"" + code + "\"}");
    }

    // Port of web/src/mocks/backend.test.ts «changes the phone only after the SMS code».
    @Test
    void changesThePhoneOnlyAfterTheSmsCode() {
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(api.get("/session").isNull("/phone")).isTrue();
        String code = sms.lastCodeFor(PHONE);
        String wrong = code.equals("000000") ? "111111" : "000000";
        assertThat(verify(PHONE, wrong).errorCode()).isEqualTo("invalid_code");
        ApiResponse profile = verify(PHONE, code);
        assertThat(profile.status()).isEqualTo(200);
        assertThat(profile.str("/phone")).isEqualTo(PHONE);
        assertThat(profile.json().at("/notification_prefs/lost").asBoolean()).isTrue();
        assertThat(profile.isNull("/photo_url")).isTrue();
        assertThat(api.get("/session").str("/phone")).isEqualTo(PHONE);
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        ApiResponse r = startChange(clients.newBrowser(), PHONE);
        assertThat(r.status()).isEqualTo(401);
    }

    @Test
    void theNumberIsValidatedBeforeAnySend() {
        ApiResponse r = startChange(api, "+5716012345");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void verifyingWithoutAStartIsInvalid() {
        assertThat(verify(PHONE, "123456").errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aCodeExpiresAfterFiveMinutesAndBurnsAfterThreeMisses() {
        startChange(api, PHONE);
        String code = sms.lastCodeFor(PHONE);
        clock.advance(Duration.ofMinutes(5).plusSeconds(1));
        assertThat(verify(PHONE, code).errorCode()).isEqualTo("invalid_code");

        clock.advance(Duration.ofMinutes(1));
        startChange(api, PHONE);
        String fresh = sms.lastCodeFor(PHONE);
        String wrong = fresh.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 3; i++) verify(PHONE, wrong);
        assertThat(verify(PHONE, fresh).errorCode()).isEqualTo("invalid_code");
    }

    @Test
    void aRepeatInsideTheCooldownDoesNotResend() {
        startChange(api, PHONE);
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
        assertThat(sms.sent()).hasSize(1);
        clock.advance(Duration.ofSeconds(61));
        startChange(api, PHONE);
        assertThat(sms.sent()).hasSize(2);
    }

    @Test
    void fourSendsPerNumberPerDayThenRateLimited() {
        for (int i = 0; i < 4; i++) {
            assertThat(startChange(api, PHONE).status()).isEqualTo(204);
            clock.advance(Duration.ofSeconds(61));
        }
        assertThat(startChange(api, PHONE).errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofHours(24));
        assertThat(startChange(api, PHONE).status()).isEqualTo(204);
    }

    @Test
    void oneDeviceIsThrottledAcrossNumbersAndAccounts() {
        for (int i = 0; i < 10; i++) {
            assertThat(startChange(api, "+57300000%04d".formatted(100 + i)).status()).isEqualTo(204);
        }
        assertThat(startChange(api, "+573000000200").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void oneIpIsThrottledAcrossDevices() {
        for (int i = 0; i < 20; i++) {
            ApiClient other = clients.newBrowser().from("198.51.100.99");
            accounts.signIn(other, "p" + i + "@correo.co");
            assertThat(startChange(other, "+57300100%04d".formatted(i)).status()).isEqualTo(204);
        }
        ApiClient last = clients.newBrowser().from("198.51.100.99");
        accounts.signIn(last, "last@correo.co");
        assertThat(startChange(last, "+573001009999").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void aTestNumberUsesTheFixedCodeAndSendsNothing() {
        startChange(api, "+573000000001");
        assertThat(sms.sent()).isEmpty();
        assertThat(verify("+573000000001", "123456").str("/phone")).isEqualTo("+573000000001");
    }
}
```

Note `oneDeviceIsThrottledAcrossNumbersAndAccounts` uses numbers `+573000000100`…`+573000000109`, which are **not** in the test-bypass prefix `+5730000000` (that prefix covers `+573000000000`–`+573000000009` only) — check before running; they must be real sends to count.

`B/src/test/java/co/scuby/identity/SmsSendPlanTest.java`:

```java
package co.scuby.identity;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

/** Growth-sensitive query (design · Queries and indexes): the SMS throttle counts. */
@IntegrationTest
class SmsSendPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired PhoneOtp otp;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theThrottleCountReadsOnlyTheLastDay() {
        db.execute("""
                INSERT INTO scuby.sms_send (phone, device_hash, ip_hash, sent_at)
                SELECT '+57300' || lpad(g::text, 7, '0'), md5(g::text) || md5(g::text), md5((g % 500)::text) || md5('x'),
                       timestamptz '2026-01-01' + g * interval '10 minutes'
                FROM generate_series(1, 30000) g""");
        db.execute("ANALYZE scuby.sms_send");
        PlanAssert.assertNoSeqScanOn(db, otp.throttleQuery("+573007152284", "d", "i", Instant.parse("2026-10-13T17:00:00Z")), "sms_send");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='PhoneNumbersTest,PhoneEndpointsTest,SmsSendPlanTest'`
Expected: compilation FAILURE (`PhoneNumbers`, `PhoneOtp`, `SmsSender` not found).

- [ ] **Step 3: Migration (no index yet)**

`B/src/main/resources/db/migration/V20261029_1040__phone_otp.sql`:

```sql
-- Phone OTP (docs/eng/auth.md · OTP mechanics). phone_otp: one pending code per (person, number),
-- stored hashed; 5-minute expiry, 3 attempts, 60 s cooldown. sms_send: the send log behind the
-- throttles (4 per number, 10 per device, 20 per IP per rolling 24 h) and the spend alarm; rows
-- older than 30 days are purged (IdentityPurge). IPs and devices are stored as hashes only.
CREATE TABLE phone_otp (
  person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  phone       text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL,
  PRIMARY KEY (person_id, phone)
);

CREATE TABLE sms_send (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone        text NOT NULL,
  person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  device_hash  text NOT NULL,
  ip_hash      text NOT NULL,
  sent_at      timestamptz NOT NULL
);
```

- [ ] **Step 4: Code**

`SmsSender.java`:

```java
package co.scuby.identity;

/** The SMS channel for OTP codes. Real provider: open item O23. */
interface SmsSender {
    void sendCode(String e164, String code);
}
```

`LogSmsSender.java`:

```java
package co.scuby.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** local, test and staging: the code goes to the log. Not under prod (no provider until O23 closes). */
@Component
@Profile("!prod")
class LogSmsSender implements SmsSender {

    private static final Logger log = LoggerFactory.getLogger(LogSmsSender.class);

    @Override
    public void sendCode(String e164, String code) {
        log.info("SMS code for {}: {}", e164, code);
    }
}
```

`SmsProperties.java`:

```java
package co.scuby.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.sms.*: throttles per rolling 24 h and the spend alarm threshold (docs/eng/auth.md · OTP mechanics). */
@ConfigurationProperties("scuby.sms")
record SmsProperties(int maxPerNumber, int maxPerDevice, int maxPerIp, int alarmDailySends) {}
```

`PhoneNumbers.java`:

```java
package co.scuby.identity;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import com.google.i18n.phonenumbers.NumberParseException;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.Phonenumber.PhoneNumber;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.regex.Pattern;

/** Server re-check of a mobile number before any send or store (docs/eng/auth.md · OTP mechanics). */
@ModuleApi
@Component
public class PhoneNumbers {

    private static final Pattern E164 = Pattern.compile("^\\+[1-9]\\d{6,14}$");
    private static final String REASON = "not a supported mobile number";

    private final PhoneNumberUtil util = PhoneNumberUtil.getInstance();
    private final SupportedCountries countries;

    PhoneNumbers(SupportedCountries countries) {
        this.countries = countries;
    }

    /** The number in E.164, or validation_failed on {@code field}. */
    public String requireMobile(String e164, String field) {
        if (e164 == null || !E164.matcher(e164).matches()) throw invalid(field);
        SupportedCountries.Country country = countries.forE164(e164).orElseThrow(() -> invalid(field));
        PhoneNumber number;
        try {
            number = util.parse(e164, null);
        } catch (NumberParseException e) {
            throw invalid(field);
        }
        if (!util.isValidNumber(number)) throw invalid(field);
        if (!Pattern.matches(country.mobilePattern(), util.getNationalSignificantNumber(number))) throw invalid(field);
        return util.format(number, PhoneNumberUtil.PhoneNumberFormat.E164);
    }

    private static ApiException invalid(String field) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, REASON, Map.of(field, REASON), Map.of());
    }
}
```

`PhoneOtp.java`:

```java
package co.scuby.identity;

import co.scuby.db.generated.tables.records.PhoneOtpRecord;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jooq.Record4;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PHONE_OTP;
import static co.scuby.db.generated.Tables.SMS_SEND;

/** SMS one-time codes with the full checklist of docs/eng/auth.md · OTP mechanics. */
@Component
class PhoneOtp {

    enum Sent { SENT, COOLDOWN }

    static final Duration TTL = Duration.ofMinutes(5);
    static final Duration COOLDOWN = Duration.ofSeconds(60);
    static final int MAX_ATTEMPTS = 3;

    private static final Logger log = LoggerFactory.getLogger(PhoneOtp.class);

    private final DSLContext db;
    private final Clock clock;
    private final SmsSender sender;
    private final TestBypass bypass;
    private final SmsProperties limits;

    PhoneOtp(DSLContext db, Clock clock, SmsSender sender, TestBypass bypass, SmsProperties limits) {
        this.db = db;
        this.clock = clock;
        this.sender = sender;
        this.bypass = bypass;
        this.limits = limits;
    }

    /** Sends a code to a number already validated by PhoneNumbers. Inside the cooldown: no resend. */
    @Transactional
    public Sent send(UUID personId, String phone, Caller caller) {
        Instant now = clock.instant();
        PhoneOtpRecord pending = db.selectFrom(PHONE_OTP)
                                   .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
                                   .forUpdate().fetchOne();
        if (pending != null && pending.getSentAt().toInstant().plus(COOLDOWN).isAfter(now)) return Sent.COOLDOWN;

        Record4<Integer, Integer, Integer, Integer> counts =
                throttleQuery(phone, caller.deviceHash(), caller.ipHash(), now.minus(Duration.ofHours(24))).fetchOne();
        if (counts.value1() >= limits.maxPerNumber() || counts.value2() >= limits.maxPerDevice()
                || counts.value3() >= limits.maxPerIp()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many codes sent");
        }

        boolean test = bypass.smsBypassed(phone);
        String code = test ? bypass.code() : Hashing.randomDigits(6);
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        db.insertInto(PHONE_OTP)
          .set(PHONE_OTP.PERSON_ID, personId).set(PHONE_OTP.PHONE, phone)
          .set(PHONE_OTP.CODE_HASH, hash(phone, code)).set(PHONE_OTP.EXPIRES_AT, at.plus(TTL))
          .set(PHONE_OTP.ATTEMPTS, 0).set(PHONE_OTP.SENT_AT, at)
          .onConflict(PHONE_OTP.PERSON_ID, PHONE_OTP.PHONE).doUpdate()
          .set(PHONE_OTP.CODE_HASH, hash(phone, code)).set(PHONE_OTP.EXPIRES_AT, at.plus(TTL))
          .set(PHONE_OTP.ATTEMPTS, 0).set(PHONE_OTP.SENT_AT, at)
          .execute();
        db.insertInto(SMS_SEND)
          .set(SMS_SEND.PHONE, phone).set(SMS_SEND.PERSON_ID, personId)
          .set(SMS_SEND.DEVICE_HASH, caller.deviceHash()).set(SMS_SEND.IP_HASH, caller.ipHash())
          .set(SMS_SEND.SENT_AT, at)
          .execute();
        if (counts.value4() + 1 > limits.alarmDailySends()) {
            log.warn("sms.daily_send_alarm sends_24h={} threshold={}", counts.value4() + 1, limits.alarmDailySends());
        }
        if (!test) sender.sendCode(phone, code);
        return Sent.SENT;
    }

    /**
     * True once per code. Its own transaction (REQUIRES_NEW): a wrong attempt stays counted even when
     * the caller answers invalid_code and rolls its own transaction back.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean check(UUID personId, String phone, String code) {
        PhoneOtpRecord row = db.selectFrom(PHONE_OTP)
                               .where(PHONE_OTP.PERSON_ID.eq(personId), PHONE_OTP.PHONE.eq(phone))
                               .forUpdate().fetchOne();
        if (row == null || row.getAttempts() >= MAX_ATTEMPTS || !row.getExpiresAt().toInstant().isAfter(clock.instant())) {
            return false;
        }
        if (!row.getCodeHash().equals(hash(phone, code))) {
            row.setAttempts(row.getAttempts() + 1);
            row.update();
            return false;
        }
        row.delete();
        return true;
    }

    /** One pass over the last 24 h of sends: per number, per device, per IP, and all (the alarm). */
    Select<Record4<Integer, Integer, Integer, Integer>> throttleQuery(String phone, String deviceHash, String ipHash, Instant since) {
        return db.select(
                         DSL.count().filterWhere(SMS_SEND.PHONE.eq(phone)),
                         DSL.count().filterWhere(SMS_SEND.DEVICE_HASH.eq(deviceHash)),
                         DSL.count().filterWhere(SMS_SEND.IP_HASH.eq(ipHash)),
                         DSL.count())
                 .from(SMS_SEND)
                 .where(SMS_SEND.SENT_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    int purgeOlderThan(Duration age) {
        OffsetDateTime cutoff = clock.instant().minus(age).atOffset(ZoneOffset.UTC);
        int sends = db.deleteFrom(SMS_SEND).where(SMS_SEND.SENT_AT.lt(cutoff)).execute();
        db.deleteFrom(PHONE_OTP).where(PHONE_OTP.EXPIRES_AT.lt(cutoff)).execute();
        return sends;
    }

    private static String hash(String phone, String code) {
        return Hashing.sha256Hex(phone + ":" + code);
    }
}
```

`ProfileView.java`:

```java
package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The contract's `Profile` (web/src/contracts/session.ts). */
record ProfileView(String displayName, String email, @Nullable String phone, @Nullable String city,
                   @Nullable String bio, NotificationPrefs notificationPrefs, @Nullable String photoUrl) {

    record NotificationPrefs(boolean lost, boolean found, boolean adoption, boolean help) {}

    static ProfileView of(Person p) {
        return new ProfileView(p.displayName(), p.email(), p.verifiedPhone(), p.city(), p.bio(),
                new NotificationPrefs(p.notifyLost(), p.notifyFound(), p.notifyAdoption(), p.notifyHelp()),
                p.photoUrl());
    }
}
```

`PhoneRequests.java`:

```java
package co.scuby.identity;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** PhoneStartRequest / PhoneVerifyRequest (web/src/contracts/session.ts). */
final class PhoneRequests {

    static final String E164 = "^\\+[1-9]\\d{6,14}$";

    private PhoneRequests() {}

    record Start(@NotNull @Pattern(regexp = E164) String phone) {}

    record Verify(@NotNull @Pattern(regexp = E164) String phone, @NotNull @Pattern(regexp = "^\\d{6}$") String code) {}
}
```

`PhoneController.java`:

```java
package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;

@ApiComponent
@RestController
class PhoneController {

    private final PhoneNumbers numbers;
    private final PhoneOtp otp;
    private final People people;
    private final Clock clock;

    PhoneController(PhoneNumbers numbers, PhoneOtp otp, People people, Clock clock) {
        this.numbers = numbers;
        this.otp = otp;
        this.people = people;
        this.clock = clock;
    }

    /** The number is not changed until verify; a repeat inside the cooldown is a silent 204. */
    @PostMapping("/me/phone")
    ResponseEntity<Void> start(Account account, Caller caller, @Valid @RequestBody PhoneRequests.Start body) {
        otp.send(account.personId(), numbers.requireMobile(body.phone(), "phone"), caller);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/me/phone/verify")
    ProfileView verify(Account account, @Valid @RequestBody PhoneRequests.Verify body) {
        String phone = numbers.requireMobile(body.phone(), "phone");
        if (!otp.check(account.personId(), phone, body.code())) {
            throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
        }
        people.setPhone(account.personId(), phone, clock.instant());
        return ProfileView.of(people.get(account.personId()));
    }
}
```

`IdentityPurge.java` — add `PhoneOtp` and purge its rows:

```java
@WorkerComponent
class IdentityPurge {

    private static final Logger log = LoggerFactory.getLogger(IdentityPurge.class);

    private final SessionStore sessions;
    private final PhoneOtp otp;

    IdentityPurge(SessionStore sessions, PhoneOtp otp) {
        this.sessions = sessions;
        this.otp = otp;
    }

    @Scheduled(cron = "${scuby.purge.cron:0 17 3 * * *}", zone = "UTC")
    void purge() {
        log.info("purged {} expired sessions, {} SMS send records older than 30 days",
                sessions.purgeExpired(), otp.purgeOlderThan(java.time.Duration.ofDays(30)));
    }
}
```

`application.yml`, thin-slice `scuby:` block, add:

```yaml
  sms:
    max-per-number: 4
    max-per-device: 10
    max-per-ip: 20
    alarm-daily-sends: 50
```

`TestDb.MUTABLE_TABLES`: add `"phone_otp"`, `"sms_send"`. `StatementCeilings`: add `Map.entry("POST /me/phone", 6)` (session lookup, supported_countries, otp select, throttle count, otp upsert, send insert) and `Map.entry("POST /me/phone/verify", 6)` (session lookup, supported_countries, otp select + delete, person update, person select).

- [ ] **Step 5: Run the endpoint tests**

Run: `[mvn] -q test -Dtest='PhoneNumbersTest,PhoneEndpointsTest,ArchitectureTest'`
Expected: PASS.

- [ ] **Step 6: Measure the throttle query — expect a seq scan first**

Run: `[mvn] -q test -Dtest=SmsSendPlanTest`
Expected: FAIL with `Seq Scan on sms_send` in the printed plan. Copy that plan into the report under "sms_send — before".

- [ ] **Step 7: Earn the index**

`B/src/main/resources/db/migration/V20261029_1050__sms_send_sent_at_index.sql`:

```sql
-- Serves PhoneOtp.throttleQuery: count(*) FILTER (phone | device_hash | ip_hash), count(*)
--   FROM sms_send WHERE sent_at > now - 24 h — one range scan over the last day's sends.
-- Plan before (30,000 rows, ANALYZE): Seq Scan on sms_send (see the A1 report).
-- Plan after: Index Scan / Bitmap Index Scan on sms_send_sent_at_idx.
-- Write cost: one more index entry per SMS sent (≈ one per publisher, ever). Overlaps: none
-- (the table has only its primary key). The same index serves the 30-day purge.
-- Needs human approval before merge (design · Queries and indexes).
CREATE INDEX sms_send_sent_at_idx ON sms_send (sent_at);
```

Run: `[mvn] -q test -Dtest=SmsSendPlanTest`
Expected: PASS; the printed plan uses `sms_send_sent_at_idx`. Copy it into the report under "sms_send — after" and add the index to the report's **Indexes for human approval** list.

- [ ] **Step 8: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261029_1040__phone_otp.sql backend/src/main/resources/db/migration/V20261029_1050__sms_send_sent_at_index.sql backend/src/main/java/co/scuby/identity backend/src/main/resources/application.yml backend/src/test/java/co/scuby/support backend/src/test/java/co/scuby/identity
git commit -m "feat: phone OTP — /me/phone and verify with the auth.md checklist (hashed code, expiry, attempts, cooldown, throttles, spend alarm)"
```

---

### Task 11: The publish phone step — `PhoneStepDerivation` and `PublisherPhone`

What `POST /lost-cases` (plan A2) calls to decide the phone step (design · Behaviour decisions, "Phone step at publish"; `docs/eng/auth.md` · Behind a flag): **OTP when `publisher_phone_otp` is on and the number is new or not verified** (stricter than the client mock, which skipped a stored-but-unverified number). The first call without a code sends the SMS and answers "code sent"; repeating it inside the 60 s cooldown answers "code sent" again without resending. A wrong code is `invalid_code` (and the attempt stays counted). Flag off: the number is still required and validated, stored E.164 **unverified**, and the publish goes through (the contract cannot say `unverified` — open item O24).

**Files:**
- Create: `B/src/main/java/co/scuby/identity/PhoneStepDerivation.java`
- Create: `B/src/main/java/co/scuby/identity/PublisherPhone.java`
- Test: `B/src/test/java/co/scuby/identity/PhoneStepDerivationTest.java`
- Test: `B/src/test/java/co/scuby/identity/PublisherPhoneTest.java`

**Interfaces:**
- Consumes: `FeatureFlags`/`Flag.PUBLISHER_PHONE_OTP`, `People`, `PhoneNumbers`, `PhoneOtp`, `Caller`.
- Produces:
  - `enum PhoneStepDerivation.Step { USE_VERIFIED, SEND_CODE, CHECK_CODE, STORE_UNVERIFIED }` and `static Step PhoneStepDerivation.decide(boolean otpOn, @Nullable String storedPhone, boolean storedVerified, String target, boolean codeGiven)` — pure.
  - `@ModuleApi public class PublisherPhone`: `public Outcome resolve(UUID personId, @Nullable String bodyPhone, @Nullable String otpCode, Caller caller)`; `public sealed interface Outcome permits Ready, CodeSent`; `public record Ready(String phone, boolean verified) implements Outcome`; `public record CodeSent() implements Outcome`. Throws `ApiException`: `phone_required` (no body phone and none stored), `validation_failed` on field `phone`, `invalid_code`, `rate_limited`. Runs inside the caller's transaction.

- [ ] **Step 1: Write the failing table test**

`B/src/test/java/co/scuby/identity/PhoneStepDerivationTest.java`:

```java
package co.scuby.identity;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static co.scuby.identity.PhoneStepDerivation.Step;
import static org.assertj.core.api.Assertions.assertThat;

/** docs/eng/auth.md · Phone, and the design's "Phone step at publish". Human review: this table is the rule. */
class PhoneStepDerivationTest {

    @ParameterizedTest(name = "otp={0} stored={1} verified={2} target={3} code={4} → {5}")
    @CsvSource(nullValues = "null", value = {
            // flag on
            "true,  +573001111111, true,  +573001111111, false, USE_VERIFIED",     // later publish, same verified number
            "true,  +573001111111, true,  +573001111111, true,  USE_VERIFIED",     // a stray code is ignored
            "true,  null,          false, +573001111111, false, SEND_CODE",        // first publish
            "true,  null,          false, +573001111111, true,  CHECK_CODE",
            "true,  +573001111111, true,  +573002222222, false, SEND_CODE",        // «cambiar»: verification belongs to the number
            "true,  +573001111111, true,  +573002222222, true,  CHECK_CODE",
            "true,  +573001111111, false, +573001111111, false, SEND_CODE",        // stored but unverified (stricter than the mock)
            "true,  +573001111111, false, +573001111111, true,  CHECK_CODE",
            // flag off
            "false, null,          false, +573001111111, false, STORE_UNVERIFIED",
            "false, null,          false, +573001111111, true,  STORE_UNVERIFIED",
            "false, +573001111111, true,  +573001111111, false, USE_VERIFIED",     // a verified number stays verified
            "false, +573001111111, true,  +573002222222, false, STORE_UNVERIFIED",
            "false, +573001111111, false, +573001111111, false, STORE_UNVERIFIED",
    })
    void decides(boolean otpOn, String stored, boolean verified, String target, boolean codeGiven, Step expected) {
        assertThat(PhoneStepDerivation.decide(otpOn, stored, verified, target, codeGiven)).isEqualTo(expected);
    }
}
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=PhoneStepDerivationTest`
Expected: compilation FAILURE (`PhoneStepDerivation` not found).

- [ ] **Step 3: The derivation**

`B/src/main/java/co/scuby/identity/PhoneStepDerivation.java`:

```java
package co.scuby.identity;

import org.jspecify.annotations.Nullable;

/** The publish phone step as a pure decision (docs/eng/auth.md · Phone; design · Phone step at publish). */
final class PhoneStepDerivation {

    enum Step { USE_VERIFIED, SEND_CODE, CHECK_CODE, STORE_UNVERIFIED }

    private PhoneStepDerivation() {}

    static Step decide(boolean otpOn, @Nullable String storedPhone, boolean storedVerified, String target, boolean codeGiven) {
        if (storedVerified && target.equals(storedPhone)) return Step.USE_VERIFIED;
        if (!otpOn) return Step.STORE_UNVERIFIED;
        return codeGiven ? Step.CHECK_CODE : Step.SEND_CODE;
    }
}
```

Run: `[mvn] -q test -Dtest=PhoneStepDerivationTest` → PASS (13).

- [ ] **Step 4: Write the failing service test**

`B/src/test/java/co/scuby/identity/PublisherPhoneTest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PHONE_OTP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PublisherPhoneTest {

    static final String PHONE = "+573007152284";

    @Autowired PublisherPhone publisherPhone;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    UUID ana;
    final Caller caller = new Caller(null, "d".repeat(64), "i".repeat(64));

    @BeforeEach
    void setUp() {
        testDb.reset();
        ana = accounts.person("ana.gomez@correo.co");
    }

    private PublisherPhone.Outcome resolve(String phone, String code) {
        return tx.execute(s -> publisherPhone.resolve(ana, phone, code, caller));
    }

    private String codeOf(ApiException e) {
        return (String) e.getBody().getProperties().get("code");
    }

    @Test
    void aNewNumberGetsACodeThenTheRightCodeVerifiesIt() {
        assertThat(resolve(PHONE, null)).isInstanceOf(PublisherPhone.CodeSent.class);
        assertThat(sms.sent()).hasSize(1);
        assertThat(resolve(PHONE, sms.lastCodeFor(PHONE))).isEqualTo(new PublisherPhone.Ready(PHONE, true));
        var person = db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
        assertThat(person.getPhone()).isEqualTo(PHONE);
        assertThat(person.getPhoneVerifiedAt()).isNotNull();
        assertThat(resolve(null, null)).isEqualTo(new PublisherPhone.Ready(PHONE, true));   // later publishes: no SMS
        assertThat(sms.sent()).hasSize(1);
    }

    @Test
    void repeatingTheFirstCallInsideTheCooldownAnswersCodeSentWithoutResending() {
        resolve(PHONE, null);
        clock.advance(Duration.ofSeconds(30));
        assertThat(resolve(PHONE, null)).isInstanceOf(PublisherPhone.CodeSent.class);
        assertThat(sms.sent()).hasSize(1);
    }

    @Test
    void aWrongCodeIsInvalidAndTheAttemptSurvivesTheRollback() {
        resolve(PHONE, null);
        String wrong = sms.lastCodeFor(PHONE).equals("000000") ? "111111" : "000000";
        assertThatThrownBy(() -> resolve(PHONE, wrong))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("invalid_code"));
        assertThat(db.select(PHONE_OTP.ATTEMPTS).from(PHONE_OTP).fetchOne().value1()).isEqualTo(1);
    }

    @Test
    void noNumberAnywhereIsPhoneRequired() {
        assertThatThrownBy(() -> resolve(null, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("phone_required"));
    }

    @Test
    void aBadNumberIsValidationFailedOnPhoneBeforeAnySend() {
        assertThatThrownBy(() -> resolve("+5716012345", null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(codeOf(e)).isEqualTo("validation_failed"));
        assertThat(sms.sent()).isEmpty();
    }

    @Test
    void aStoredButUnverifiedNumberStillNeedsTheCodeWhenTheFlagIsOn() {
        db.update(PERSON).set(PERSON.PHONE, PHONE).where(PERSON.ID.eq(ana)).execute();
        assertThat(resolve(null, null)).isInstanceOf(PublisherPhone.CodeSent.class);
    }

    @Test
    void flagOffStoresTheNumberUnverifiedAndPublishes() {
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", ana);
        assertThat(resolve(PHONE, null)).isEqualTo(new PublisherPhone.Ready(PHONE, false));
        var person = db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
        assertThat(person.getPhone()).isEqualTo(PHONE);
        assertThat(person.getPhoneVerifiedAt()).isNull();
        assertThat(sms.sent()).isEmpty();
    }
}
```

- [ ] **Step 5: Run to see it fail**

Run: `[mvn] -q test -Dtest=PublisherPhoneTest`
Expected: compilation FAILURE (`PublisherPhone` not found).

- [ ] **Step 6: The service**

`B/src/main/java/co/scuby/identity/PublisherPhone.java`:

```java
package co.scuby.identity;

import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.UUID;

/**
 * The phone step of every publish (docs/eng/auth.md · UI contract — the phone step). Called inside
 * the publish's transaction; identity stays the only writer of `person` and `phone_otp`.
 */
@ModuleApi
@Component
public class PublisherPhone {

    public sealed interface Outcome permits Ready, CodeSent {}

    /** Publish with this number; {@code verified} is false only with publisher_phone_otp off (O24). */
    public record Ready(String phone, boolean verified) implements Outcome {}

    /** The SMS went out (or is inside its cooldown): answer `{phone_step: "otp"}` and write nothing else. */
    public record CodeSent() implements Outcome {}

    private final People people;
    private final PhoneNumbers numbers;
    private final PhoneOtp otp;
    private final FeatureFlags flags;
    private final Clock clock;

    PublisherPhone(People people, PhoneNumbers numbers, PhoneOtp otp, FeatureFlags flags, Clock clock) {
        this.people = people;
        this.numbers = numbers;
        this.otp = otp;
        this.flags = flags;
        this.clock = clock;
    }

    public Outcome resolve(UUID personId, @Nullable String bodyPhone, @Nullable String otpCode, Caller caller) {
        Person person = people.get(personId);
        String target = bodyPhone != null ? numbers.requireMobile(bodyPhone, "phone") : person.phone();
        if (target == null) throw new ApiException(ErrorCode.PHONE_REQUIRED, "a phone number is required to publish");
        boolean otpOn = flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, personId);
        return switch (PhoneStepDerivation.decide(otpOn, person.phone(), person.phoneVerifiedAt() != null, target, otpCode != null)) {
            case USE_VERIFIED -> new Ready(target, true);
            case SEND_CODE -> {
                otp.send(personId, target, caller);
                yield new CodeSent();
            }
            case CHECK_CODE -> {
                if (!otp.check(personId, target, otpCode)) throw new ApiException(ErrorCode.INVALID_CODE, "wrong or expired code");
                people.setPhone(personId, target, clock.instant());
                yield new Ready(target, true);
            }
            case STORE_UNVERIFIED -> {
                if (!target.equals(person.phone()) || person.phoneVerifiedAt() != null) people.setPhone(personId, target, null);
                yield new Ready(target, false);
            }
        };
    }
}
```

Note `STORE_UNVERIFIED` with a stored *verified* different number: the new number replaces it, unverified (verification belongs to the number).

- [ ] **Step 7: Run, including PIT**

Run: `[mvn] -q test -Dtest='PublisherPhoneTest,PhoneStepDerivationTest,ArchitectureTest'`
Expected: PASS.

Run: `[mvn] verify`
Expected: `BUILD SUCCESS`; the PIT section reports mutations generated for `co.scuby.identity.PhoneStepDerivation` with a mutation score ≥ 80 % (the table kills every boundary/negation mutant; expect 100 %). Record the score in the report. If PIT fails below the threshold, add the missing rows to the table — never lower the threshold.

- [ ] **Step 8: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/java/co/scuby/identity/PhoneStepDerivation.java backend/src/main/java/co/scuby/identity/PublisherPhone.java backend/src/test/java/co/scuby/identity/PhoneStepDerivationTest.java backend/src/test/java/co/scuby/identity/PublisherPhoneTest.java
git commit -m "feat: publish phone step — pure PhoneStepDerivation (OTP for new or unverified numbers, flag-off stores unverified) and PublisherPhone"
```

---
### Task 12: Run the whole backend locally with Docker

One command brings up Postgres and the API (profile `local`) on `http://localhost:8080`, so the web client's dev server (`http://localhost:5173`) and its Playwright preview build (`http://localhost:4173`, `web/playwright.config.ts`) can call it with credentials. Plan A2's final acceptance task depends on this. The image is the one Jib builds (`scuby-backend`); `docker compose up -d` alone still starts only Postgres (tests and codegen use it), because the API service sits behind the compose profile `app`.

**Cookies on localhost:** the session and device cookies are `Secure; SameSite=Lax`. Browsers treat `http://localhost` as a secure context and accept `Secure` cookies from it, and `localhost:5173` → `localhost:8080` is same-site (the port is not part of the site), so `SameSite=Lax` cookies flow on `fetch(..., {credentials: 'include'})`. CORS allows both client origins with credentials (`application-local.yml`, Task 1). Nothing to relax.

**Files:**
- Modify: `B/compose.yaml`
- Create: `B/run-local.sh`
- Modify: `B/README.md`
- Test: manual verification below (no Java test: this task is wiring)

**Interfaces:**
- Consumes: the Jib configuration (Task 1: base image pinned), profile `local` (`application-local.yml`: allowed origins 5173/4173, test bypass for `e2e.scuby.test` and `+5730000000x`).
- Produces: `bash backend/run-local.sh` → API healthy on `http://127.0.0.1:8080`; `docker compose --profile app down` stops it. Compose service name `backend`, image `scuby-backend`. Environment variables set there override `application-local.yml`; plan A2 adds `SCUBY_MEDIA_PUBLIC_BASE_URL` to this service.

- [ ] **Step 1: Extend `B/compose.yaml`**

Replace the file with:

```yaml
# Local database for `SPRING_PROFILES_ACTIVE=local` (backend/README.md).
# `docker compose up -d` starts only Postgres (tests, jOOQ codegen, the API run from Maven).
# `docker compose --profile app up -d --wait` also starts the API from the Jib image `scuby-backend`
# (backend/run-local.sh builds it first).
services:
  postgres:
    build: ../infra/docker/postgres
    image: scuby/postgres:17
    environment:
      POSTGRES_DB: scuby
      POSTGRES_USER: scuby
      POSTGRES_PASSWORD: scuby
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U scuby -d scuby"]
      interval: 2s
      timeout: 3s
      retries: 30

  backend:
    image: scuby-backend
    profiles: [ "app" ]
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SPRING_PROFILES_ACTIVE: local
      # Inside the compose network Postgres is `postgres:5432`, not the host's 5433.
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/scuby
      SPRING_DATASOURCE_USERNAME: scuby
      SPRING_DATASOURCE_PASSWORD: scuby
    ports:
      - "127.0.0.1:8080:8080"

volumes:
  pgdata:
```

- [ ] **Step 2: `B/run-local.sh`**

```bash
#!/usr/bin/env bash
# Runs the whole backend locally in Docker: Postgres + the API (profile local) on http://localhost:8080.
# Usage (from anywhere): bash backend/run-local.sh      Stop: docker compose -f backend/compose.yaml --profile app down
set -euo pipefail
cd "$(dirname "$0")"

# Java 25 (backend/.java-version); the Maven enforcer refuses any other JDK.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"

# The build needs Docker (jOOQ codegen) and the image scuby/postgres:17.
docker image inspect scuby/postgres:17 >/dev/null 2>&1 || docker build -t scuby/postgres:17 ../infra/docker/postgres

./mvnw -q -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker compose --profile app up -d --wait

for _ in $(seq 1 90); do
  if curl -sf http://localhost:8080/actuator/health >/dev/null; then break; fi
  sleep 1
done
curl -sf http://localhost:8080/actuator/health || { echo "the API did not become healthy: docker compose logs backend"; exit 1; }
echo
echo "API:    http://localhost:8080"
echo "Health: http://localhost:8080/actuator/health"
echo "Stop:   docker compose -f $(pwd)/compose.yaml --profile app down"
```

- [ ] **Step 3: Document it in `B/README.md` (Spanish)**

In the table under `## Cómo correrlo`, replace the row for `./mvnw -DskipTests package jib:dockerBuild …` with these two rows (keep the other rows):

```markdown
| `bash run-local.sh` | Todo en Docker: construye la imagen `scuby-backend` con Jib, levanta Postgres y la API (perfil `local`) y espera a que la salud diga `UP`. La API queda en `http://localhost:8080`; el cliente (`pnpm dev`, puerto 5173) y su build de e2e (puerto 4173) pueden llamarla con credenciales. Se detiene con `docker compose --profile app down` |
| `./mvnw -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64` | Solo la imagen local `scuby-backend` (el pom lista arm64 y amd64 para publicar en un registro) |
```

and add below the table:

```markdown
`docker compose up -d` sin `--profile app` levanta solo Postgres (lo que necesitan las pruebas y la
generación de jOOQ). En el perfil `local` los códigos de correo y SMS salen en el log
(`docker compose logs -f backend`); las direcciones `@e2e.scuby.test` y los números
`+57 300 000 000x` aceptan siempre `123456`.
```

- [ ] **Step 4: Verify**

Run: `bash /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend/run-local.sh`
Expected: ends with `{"status":"UP"...}` and the three `API/Health/Stop` lines.

Run: `curl -sf localhost:8080/actuator/health` → `{"status":"UP"...}`.
Run: `curl -s -i localhost:8080/config | head -20` → `HTTP/1.1 200`, a `Set-Cookie: device=…; Secure; HttpOnly; SameSite=Lax` header and the Colombia row.
Run (CORS for the client's origin): `curl -s -i -X OPTIONS localhost:8080/auth/email/start -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | grep -i '^access-control'`
Expected: `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`. Repeat with `Origin: http://localhost:4173` → same.
Run: `docker compose -f /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend/compose.yaml --profile app down`
Expected: both containers removed. Then `docker compose -f …/backend/compose.yaml up -d --wait` starts **only** `postgres` (check `docker compose -f …/backend/compose.yaml ps` lists one service); stop it again with `docker compose -f …/backend/compose.yaml down`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/compose.yaml backend/run-local.sh backend/README.md
git commit -m "feat: run the whole backend locally in Docker — compose app profile with the Jib image, run-local.sh"
```

---

### Task 13: `backend/CLAUDE.md`, owning docs, decision #40, final verification

**Files:**
- Create: `B/CLAUDE.md`
- Modify: `W/docs/eng/backend.md`, `W/docs/eng/auth.md`, `W/docs/eng/feature-flags.md`, `W/docs/product/00-product-map.md`, `B/README.md` (structure section)

**Interfaces:**
- Consumes: everything above; the report's recorded decisions (CSRF, no device table, SMS throttle numbers).
- Produces: docs that later plans (A2) extend: `docs/eng/backend.md` gains the sections **Code structure**, **Security**, **Sessions**; A2 adds to them.

- [ ] **Step 1: `B/CLAUDE.md`**

```markdown
# backend/ — the API and its background work

Behaviour lives in `../docs/` and wins over this code. Architecture: `../docs/eng/backend.md`
(read *Code structure*, *Security*, *Sessions* before writing code). The contract:
`../docs/eng/openapi.json` (generated by the client — never edit it here; propose changes).

## Commands (from `backend/`, Docker running)

| | |
|---|---|
| `./mvnw verify` | Everything CI runs: jOOQ codegen, tests, ArchUnit, PIT on derivations |
| `./mvnw test -Dtest=X` | One test class |
| `bash run-local.sh` | Postgres + the API in Docker on http://localhost:8080 (profile `local`) |
| `docker compose up -d` | Postgres only |

## Java version

One version, three places that must agree — change them in one commit:

1. `pom.xml` `<java.version>` — compilation, and Jib's base image `eclipse-temurin:${java.version}-jre@sha256:…`.
2. `.java-version` — jenv locally; CI reads it (`java-version-file` in `.github/workflows/backend.yml`).
3. The Jib base-image digest in `pom.xml` — bump with `docker buildx imagetools inspect eclipse-temurin:<version>-jre` (copy the index `Digest:`).

The Maven enforcer fails `validate` on any JDK outside `[25,26)` or Maven older than 3.9.

## Package rules (ArchUnit fails the build)

- Package by feature, **flat**: `platform` (domain-free), foundations `identity`, `uploads`, `pets`,
  verticals `cases` (later `adoption`, `help`…). No layer subpackages.
- Package-private by default. A class another feature uses is `public` **and** `@ModuleApi`.
- Dependencies: `platform` → nothing of ours; foundations → `platform` only; verticals →
  foundations + `platform`, never another vertical. A new feature package is added to
  `ArchitectureRules.FOUNDATIONS` or `VERTICALS` in the same commit.
- Each table has **one writing feature**; reads may join any table (`db.generated` is shared).
- Cross-feature side effects go through the outbox, never a direct call to another vertical.
- Roles: `@ApiComponent` and `@WorkerComponent` never depend on each other.

## Writing an endpoint

1. Request/response records by hand, matching the contract (snake_case comes from Jackson).
   Responses are complete: every field present, `null` not absent.
2. Controller (`@ApiComponent @RestController`, package-private) takes `Caller` (who asks: person?,
   device, IP hash) and/or `Account` (sign-in required) parameters. A `session` endpoint is also
   declared in the feature's `SecurityRules` bean.
3. Service methods own transactions. Never a transaction across a request; never `@Transactional`
   on a controller or filter.
4. jOOQ for every query. Time comes from the `Clock` bean, passed as a parameter — never `now()`
   in SQL, never `Instant.now()`.
5. Viewer-dependent responses: **access → facts → derivation → record**. Load `*Facts` according
   to the access (private facts are not even queried for the public); `XDerivation.derive(facts,
   viewer, now, …)` is pure (no Spring, jOOQ, I/O, clock or randomness) and table-tested in
   `XDerivationTest` (PIT mutates it; ≥ 80 %).
6. Errors: throw `ApiException(ErrorCode…, message, fields, details)`; fields are wire paths.

## Tests

- Endpoint tests are `@IntegrationTest`, call `testDb.reset()` first, and go through `ApiClient`:
  every response is validated against `openapi.json` and the request's SQL statements are counted
  against `StatementCeilings` (add your endpoint's line; a ceiling never grows with row counts —
  seed several rows to prove it).
- Viewer-dependent endpoints get a **leak test**: as a non-owner, every owner-only field is `null`.
- Time travel: `MutableClock` (`advance`, `set`). Codes sent by email/SMS: `RecordingEmailSender`,
  `RecordingSmsSender`. Signed-in shortcut: `Accounts.signIn(api, email)`.
- A new writable table goes into `TestDb.MUTABLE_TABLES`.

## Migrations and indexes

- Flyway file names are timestamps: `V20261029_1430__what.sql` (never sequence numbers). Each
  starts with a comment: what it is for, which doc owns it. Qualify tables with `scuby.` inside
  PL/pgSQL.
- **An index is earned:** only growth-sensitive queries get a plan check (`PlanAssert`, seeded
  thousands of rows). Write the failing plan check first, then the index; its migration comment
  carries the query, the plan before/after, the write cost and overlaps. Every new index is listed
  for human approval in the task report.

## What reviewers check (humans)

Derivation test tables (the business rules), access policies (who sees whose phone and location),
migrations (data changes are not undone by a revert), jOOQ queries (indexes, PostGIS), anything
exposing personal data. Automation covers shape, architecture and test strength.
```

- [ ] **Step 2: `docs/eng/backend.md`**

(a) After the section `## The API contract` (before `## Testing`), add:

```markdown
## Code structure

*Decided 2026-10-29 — decision #40 ([00](../product/00-product-map.md)).* Agent-facing rules:
[`backend/CLAUDE.md`](../../backend/CLAUDE.md).

**Package by feature, flat, package-private by default.** `co.scuby.platform` is technical and
domain-free (roles, web envelope, PostGIS helpers, security wiring, flags, time); foundations
`identity`, `uploads`, `pets` depend only on `platform`; verticals (`cases` today) depend on
foundations and `platform`, never on each other. A class used from another feature carries
`@ModuleApi`; everything else stays package-private. Reads may join any table; each table has one
writing feature; cross-feature side effects go through the outbox. Background code stays in its
feature, marked `@WorkerComponent`. When a second vertical arrives, `cases` keeps what every case
shares and defines a `@ModuleApi` `CaseKind` each vertical implements.

**Viewer-dependent responses: access → facts → derivation → record.** One policy decides the
access (`PUBLIC`, `OWNER`); facts are loaded according to it, so private facts are never queried
for the public; a pure `*Derivation` (time and viewer as parameters) builds the response; the
record is serialised. Request/response records are written by hand next to their feature
(generation was rejected: openapi-generator turns the contract's unions into unusable classes).

**Guardrails that fail the build:** ArchUnit (derivation purity — no Spring, jOOQ, I/O, clock or
randomness; roles by annotation; the DAG; the declared surface), PIT mutation testing on
derivations (≥ 80 %), contract conformance of every response an integration test produces, leak
tests on viewer-dependent endpoints, statement-count ceilings per request (an N+1 fails the test),
plan checks on growth-sensitive queries only, and indexes added only with a measured plan and human
approval. Flyway versions are timestamps so parallel branches never collide.

## Security

One Spring Security filter chain, stateless (`platform.security`): no HTTP session, form login,
basic auth or logout filter. Features declare their own route rules (`SecurityRules` beans);
`identity` supplies who is signed in (`RequestAuthenticator`). `401`/`403` come in the contract's
envelope.

**CSRF without a token** (the client sends none): an unsafe request (`POST`/`PUT`/`PATCH`/`DELETE`)
whose `Origin` is not an allowed client origin, or that has no `Origin` but `Sec-Fetch-Site:
cross-site`, is `forbidden`. `SameSite=Lax` cookies are the second layer. Rejected: Spring's token
CSRF (needs a contract change for no gain here); `SameSite` alone (a sibling subdomain is
same-site). **CORS** allows only the client's origins (`scuby.web.allowed-origins`), with
credentials.

**Client IP** (a rate-limit key): `CloudFront-Viewer-Address` only when the request carries the
origin secret header, else the socket address. IPs are stored only as an HMAC.

**Device cookie** (decision #35): only its SHA-256 is used; it is set when missing and renewed on
unsafe requests by a `Set-Cookie` header. There is no `device` table: the hash is stored on the rows
that need it, so reads never write. A table arrives with the first consumer of device-level data.

## Sessions

An **opaque** 256-bit token in the `session` cookie (decision #37); the database stores only its
SHA-256, with `expires_at` = sign-in + 12 months (absolute). **Reading a session never writes** —
no `last_seen_at`, no sliding expiry; writes happen on sign-in, sign-out, account deletion and a
daily purge. A bounded in-process cache (10,000 entries, 60 s) sits in front of the lookup behind
`SessionLookup`; sign-out evicts locally; size `0` disables it. **Connection hygiene:** the lookup
runs outside any transaction and returns its connection at once; transactions live in service
methods, never across a request — a test asserts 0 active connections after an authenticated
request and no `INSERT`/`UPDATE` on a session read. Rejected: JWT sessions (cannot be revoked
before they expire — sign-out, account deletion, a stolen phone); a short JWT plus refresh token
(more code and keys for nothing at one instance).
```

(b) In `## Stack`, change the `Rate limiting` row to:

```markdown
| Rate limiting | Counts over the rows themselves (rolling windows with SQL, indexed where measured) — the limits in this slice key on rows that exist anyway (sends, sightings, uploads). **Bucket4j** with its Postgres store if a limit ever needs tokens without rows |
```

(c) In `## Testing`, add a bullet:

```markdown
- **Statement ceilings and plan checks** (*Code structure*): every endpoint test counts SQL
  statements per request; growth-sensitive queries get a plan check against seeded volume.
```

- [ ] **Step 3: `docs/eng/auth.md`**

(a) Replace the bullet `- Sessions are long-lived (refresh ~12 months, device-bound).` with:

```markdown
- Sessions are long-lived: an opaque token in an httpOnly cookie, stored only as its SHA-256,
  expiring 12 months after sign-in whatever the use (no sliding refresh); sign-out ends it at once.
  Mechanics: [backend.md](backend.md) · Sessions.
- **Email code:** 6 digits, stored hashed, 5-minute expiry, 3 attempts, 60 s resend cooldown, at
  most 10 sends per address per day; the address is trimmed and lower-cased; starting a sign-in
  always answers the same (it never reveals whether an account exists). The account is named from
  the address («juan.perez@…» → «Juan Perez») until the person edits it.
- **Google:** the client sends Google's ID token; the server verifies the signature against
  Google's keys, the audience (our client ID), the issuer and the expiry, requires a verified
  email, keys the account on Google's `sub`, and links a first Google sign-in to the account with
  the same email. No redirect flow, no client secret.
- **Until the providers exist** ([O23](../open-items.md)), local, test and staging write email and
  SMS codes to the log. For e2e runs, addresses on a test domain and numbers in a reserved range
  accept a fixed code; configuring either under the production profile stops the server at start-up.
```

(b) In `### OTP mechanics`, replace `per-device and per-IP throttles (same rate-limit machinery the flows already use)` with `per-device (10 per day) and per-IP (20 per day) throttles over rolling 24 h; a repeat inside the cooldown answers as if sent, without sending`.

(c) After the paragraph that starts `**Behind a flag.**`, add one sentence at its end: `The flag gates the publish step only; changing the number in settings always verifies it.`

- [ ] **Step 4: `docs/eng/feature-flags.md`** — add a registry row after `publisher_phone_otp`:

```markdown
| `reverse_geocoding` | **off** | Place names (`place_name` on cases and feed items) from a reverse-geocoding provider, computed once at publish | A generic localized label («Zona marcada en el mapa») | [backend.md](backend.md) · Place names (added by the lost-case work) | Deleted once a provider is chosen and stable |
```

- [ ] **Step 5: Decision #40 in `docs/product/00-product-map.md`**

Append as the last row of the decision-log table (after the highest-numbered row present on this branch; #39 belongs to another branch):

```markdown
| 40 | Backend code structure and guardrails *(2026-10-29)* | **Package by feature, flat, package-private by default**: `platform` (domain-free), foundations (`identity`, `uploads`, `pets`) that depend only on it, verticals (`cases`) that depend on foundations and never on each other; a declared cross-feature surface (`@ModuleApi`); one writing feature per table; viewer-dependent responses built as access → facts → pure derivation → record; **rules that fail the build** — ArchUnit (derivation purity, roles by annotation, the DAG, the declared surface), PIT mutation testing on derivations, contract conformance and leak tests, statement-count ceilings per request, plan checks on growth-sensitive queries, indexes only with a measured plan and human approval; timestamped Flyway versions — [eng/backend.md](../eng/backend.md) · Code structure | Package by layer (a feature's code spread over the tree, nothing stops cross-feature reach-ins); by feature with layer subpackages (a subpackage cannot see its parent's package-private classes, so everything turns public); hexagonal ports and adapters (a port per table for two engineers — ceremony without a second adapter); Spring Modulith (its checks are what ArchUnit gives here, plus an event-publication registry we do not need beside the outbox); conventions in a README instead of build rules (AI agents write most of the code and human review time is the scarce resource) |
```

- [ ] **Step 6: README structure section**

In `B/README.md`, replace the `## Estructura` code block with:

```
src/main/java/co/scuby/
├── platform/    técnico, sin dominio: roles, web (sobre de errores), db (PostGIS), security, flags, time
├── identity/    cuentas, sesiones, cookie de dispositivo, código por correo, Google, OTP por SMS, GET /config
src/test/java/co/scuby/support/     arnés de pruebas: ApiClient (contrato + techo de sentencias), TestDb, MutableClock
src/test/java/co/scuby/architecture/ reglas de ArchUnit que fallan el build
```

- [ ] **Step 7: Final verification**

Run: `[mvn] verify`
Expected: `BUILD SUCCESS`; tests all green; PIT ≥ 80 % on `PhoneStepDerivation`.

Run: `git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice status --short`
Expected: only the doc files of this task modified/added.

- [ ] **Step 8: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/CLAUDE.md backend/README.md docs/eng/backend.md docs/eng/auth.md docs/eng/feature-flags.md docs/product/00-product-map.md
git commit -m "doc: backend code structure, security and sessions; auth mechanics; reverse_geocoding flag; decision #40; backend/CLAUDE.md"
```

- [ ] **Step 9: Finish the report**

Append to the report a final section: the commit list (`git log --oneline origin/main..HEAD`), every measured statement count vs. ceiling, PIT score, **Indexes for human approval** (expected: `sms_send_sent_at_idx`), deviations from this plan, and open questions. Do not commit the report.

---

## Self-review notes (for the plan's reader)

- Spec coverage (design → task): dependencies up front (1); guardrails 1–5 (3; 6 = harness 2 + every endpoint test; 7 = A2); timestamped Flyway (from 4); flags of decision #18 with both flags (4); `supported_countries` + `GET /config` (5); device cookie (6); sessions, Spring Security filter by identity, per-feature `SecurityRules`, CSRF/CORS, envelope 401/403, connection hygiene (1, 6, 7); email code + test-domain bypass refused in prod (8); Google ID token with NimbusJwtDecoder, local keys (9); phone OTP + `/me/phone(/verify)` + libphonenumber + country pattern (10); the publish phone step for A2 (11); local Docker run, Java version single source (1, 12); `backend/CLAUDE.md` + owning docs + decision #40 (13).
- Not in this plan: telemetry/OpenTelemetry (branch `be/observability`; expect a merge in `pom.xml` and `application.yml` — this plan's additions are grouped in one block per file); uploads, pets, lost cases, feed, sightings, place names (plan A2); real email/SMS providers (O23); notifications and check-ins (design: not in this slice).
- Handoff: when `infra/b1-sandbox` merges, its image build should use this branch's pinned Jib base image (`eclipse-temurin:${java.version}-jre@sha256:…`).
