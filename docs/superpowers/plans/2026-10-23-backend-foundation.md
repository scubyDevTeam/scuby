# Backend Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Maven/Spring Boot backend skeleton in `backend/` that builds, tests against a real PostGIS database, generates jOOQ code from Flyway migrations, answers errors in the contract's envelope, validates responses against `docs/eng/openapi.json`, packages an ARM64 image with Jib, and runs in CI — phase 0 of [docs/eng/backend-plan.md](../../eng/backend-plan.md).

**Architecture:** One Maven module, one deployable, base package `co.scuby`. Roles (`api`, `worker`) are properties that beans are conditional on. Postgres 17 + PostGIS comes from a project-built image (`infra/docker/postgres/Dockerfile`) used by Testcontainers, jOOQ codegen, local Compose and CI. No AWS, no external accounts, no domain features in this plan.

**Tech Stack:** Java 25 (via jenv), Maven 3.9 + wrapper, Spring Boot 4.1.2 (Jackson 3, modular starters), jOOQ 3.21 (OSS), Flyway 12, PostgreSQL 17 + PostGIS 3 + pgvector, Testcontainers 2.0.5, networknt json-schema-validator 3.0.8, ArchUnit 1.5.1, Jib 3.5.2, GitHub Actions.

## Global Constraints

- Read first: `docs/eng/backend.md`, `docs/eng/infra.md` · Database, `docs/eng/api.md` · Conventions and Errors. Docs win over this plan on behaviour; if they disagree, stop that task and record it in the night report.
- Java **25**: `backend/.java-version` contains `25`; `pom.xml` sets `<java.version>25</java.version>`. Run every `mvn`/`./mvnw` from `backend/` so jenv selects 25. If `java -version` inside `backend/` is not 25, run `jenv local 25` there.
- Spring Boot **4.1.2** parent. Versions managed by Boot are never re-declared (jOOQ 3.21.9, Flyway 12.4.0, Testcontainers 2.0.5, PostgreSQL driver 42.7.14).
- Base package `co.scuby`. Database schema for application tables: `scuby`. PostGIS lives in `public`.
- JSON on the wire is snake_case (the contract's convention).
- Commit prefixes (repo rule): `feat:` behaviour, `test:` tests, `doc:` docs, `ci:` CI — one kind per commit where it can be split.
- **Never**: push, open PRs, touch AWS, install software beyond Maven dependencies and Docker images, edit `web/`, or change `docs/eng/openapi.json`.
- Branch: `be/0-foundation`, created from `doc/backend-architecture`.
- **Stuck rule:** if a step fails 3 times after honest fixes, stop that task, write what happened to the night report (Task 11), and continue with the next task whose *Consumes* are satisfied.
- Night report path (outside the repo): `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/night-report.md`.

## File map

```
backend/
  .java-version                         25 (jenv)
  pom.xml                               the build
  mvnw, mvnw.cmd, .mvn/wrapper/         Maven wrapper
  compose.yaml                          local Postgres (project image) on :5433
  README.md                             how to run, test, build the image
  src/main/java/co/scuby/
    ScubyApplication.java
    platform/roles/ApiComponent.java    role meta-annotations
    platform/roles/WorkerComponent.java
    platform/web/ErrorCode.java         the 14 codes + HTTP status (mirror of web/src/contracts/errors.ts)
    platform/web/ApiException.java
    platform/web/ApiErrorBody.java      the envelope
    platform/web/ApiErrorHandler.java   @RestControllerAdvice
    platform/db/GeoPoint.java           lat/lng value
    platform/db/Spatial.java            PostGIS templates for jOOQ OSS
  src/main/resources/
    application.yml, application-local.yml, application-test.yml,
    application-staging.yml, application-prod.yml
    db/migration/V1__postgis.sql, V2__outbox_events.sql
  src/test/java/co/scuby/
    TestcontainersConfiguration.java    singleton PostGIS container
    ApplicationHealthTest.java
    platform/roles/RolesTest.java
    platform/roles/RoleBoundariesTest.java   ArchUnit
    platform/db/MigrationsTest.java
    platform/db/OutboxTableTest.java    jOOQ generated code round-trip
    platform/db/SpatialTest.java
    platform/web/ApiErrorHandlerTest.java
    contract/ContractValidator.java     validates bodies against docs/eng/openapi.json
    contract/ContractValidatorTest.java
infra/docker/postgres/Dockerfile        postgres:17 + postgis + pgvector
infra/docker/postgres/verify.sh         smoke test of the image
.github/workflows/backend.yml           CI
```

---

### Task 0: Branch and toolchain

**Files:** none (environment only).

- [ ] **Step 1: Branch**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo
git checkout doc/backend-architecture && git checkout -b be/0-foundation
```

- [ ] **Step 2: Verify the toolchain**

```bash
jenv versions          # must list 25
docker info --format '{{.ServerVersion}} {{.Architecture}}'   # must answer (aarch64)
mvn -v | head -1       # Maven 3.9.x
```

Expected: all three answer. If jenv does not list 25: `jenv add /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`. If Docker does not answer, write it to the night report and stop the whole plan (every later task needs it).

---

### Task 1: Maven skeleton that starts and reports health

**Files:**
- Create: `backend/.java-version`, `backend/pom.xml`, `backend/src/main/java/co/scuby/ScubyApplication.java`, `backend/src/main/resources/application.yml`, `application-{local,test,staging,prod}.yml`, Maven wrapper files
- Test: `backend/src/test/java/co/scuby/ApplicationHealthTest.java`

**Interfaces:**
- Produces: `co.scuby.ScubyApplication`; profiles `local`, `test`, `staging`, `prod`; property namespace `scuby.*`.

- [ ] **Step 1: Toolchain pin and wrapper**

```bash
mkdir -p backend && cd backend
echo 25 > .java-version
java -version 2>&1 | head -1     # expect: 25.x
mvn -N org.apache.maven.plugins:maven-wrapper-plugin:3.3.2:wrapper -Dmaven=3.9.16
```

- [ ] **Step 2: `backend/pom.xml`** (dependencies for later tasks are added by those tasks)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.2</version>
    <relativePath/>
  </parent>

  <groupId>co.scuby</groupId>
  <artifactId>scuby-backend</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <name>scuby-backend</name>

  <properties>
    <java.version>25</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-webmvc</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>

    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-webmvc-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 3: Write the failing test** — `backend/src/test/java/co/scuby/ApplicationHealthTest.java`

```java
package co.scuby;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ApplicationHealthTest {

    @Autowired MockMvc mvc;

    @Test
    void healthIsUp() throws Exception {
        mvc.perform(get("/actuator/health"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.status").value("UP"));
    }
}
```

If `org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc` does not resolve, find the class in the `spring-boot-webmvc-test` jar (`unzip -l ~/.m2/repository/org/springframework/boot/spring-boot-webmvc-test/4.1.2/*.jar | grep AutoConfigureMockMvc`) and use that package. Same for every later test that uses it.

- [ ] **Step 4: Run it to see it fail**

Run: `./mvnw -q test -Dtest=ApplicationHealthTest`
Expected: FAIL — no `@SpringBootConfiguration` found.

- [ ] **Step 5: Application class and config**

`backend/src/main/java/co/scuby/ScubyApplication.java`:

```java
package co.scuby;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ScubyApplication {
    public static void main(String[] args) {
        SpringApplication.run(ScubyApplication.class, args);
    }
}
```

`backend/src/main/resources/application.yml`:

```yaml
spring:
  application:
    name: scuby-backend
  threads:
    virtual:
      enabled: true
  jackson:
    property-naming-strategy: SNAKE_CASE

management:
  endpoints:
    web:
      exposure:
        include: health
```

`application-local.yml`, `application-test.yml`, `application-staging.yml`, `application-prod.yml` — each starts as a one-line comment naming its environment (filled by later tasks), e.g.:

```yaml
# Local development — see backend/README.md
```

- [ ] **Step 6: Run it to see it pass**

Run: `./mvnw -q test -Dtest=ApplicationHealthTest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat: backend skeleton — Spring Boot 4.1 on Java 25, virtual threads, health endpoint"
```

---

### Task 2: Roles — `@ApiComponent`, `@WorkerComponent` and their boundary

**Files:**
- Create: `backend/src/main/java/co/scuby/platform/roles/ApiComponent.java`, `WorkerComponent.java`
- Modify: `backend/pom.xml` (ArchUnit, test scope)
- Test: `backend/src/test/java/co/scuby/platform/roles/RolesTest.java`, `RoleBoundariesTest.java`

**Interfaces:**
- Produces: `@co.scuby.platform.roles.ApiComponent` (on `scuby.roles.api`), `@co.scuby.platform.roles.WorkerComponent` (on `scuby.roles.worker`); both on unless the property is `false`. Package convention: API-only code under `co.scuby..api..`, worker-only code under `co.scuby..worker..`.

- [ ] **Step 1: Failing tests** — `RolesTest.java`

```java
package co.scuby.platform.roles;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class RolesTest {

    @WorkerComponent static class SampleWorker {}
    @ApiComponent static class SampleApi {}

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(SampleWorker.class, SampleApi.class);

    @Test
    void bothRolesRunWhenNothingIsConfigured() {
        runner.run(ctx -> {
            assertThat(ctx).hasSingleBean(SampleWorker.class);
            assertThat(ctx).hasSingleBean(SampleApi.class);
        });
    }

    @Test
    void workerOffLeavesApiOn() {
        runner.withPropertyValues("scuby.roles.worker=false").run(ctx -> {
            assertThat(ctx).doesNotHaveBean(SampleWorker.class);
            assertThat(ctx).hasSingleBean(SampleApi.class);
        });
    }

    @Test
    void apiOffLeavesWorkerOn() {
        runner.withPropertyValues("scuby.roles.api=false").run(ctx -> {
            assertThat(ctx).doesNotHaveBean(SampleApi.class);
            assertThat(ctx).hasSingleBean(SampleWorker.class);
        });
    }
}
```

`RoleBoundariesTest.java`:

```java
package co.scuby.platform.roles;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "co.scuby")
class RoleBoundariesTest {

    @ArchTest
    static final ArchRule workerDoesNotUseApi = noClasses()
            .that().resideInAPackage("co.scuby..worker..")
            .should().dependOnClassesThat().resideInAPackage("co.scuby..api..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule apiDoesNotUseWorker = noClasses()
            .that().resideInAPackage("co.scuby..api..")
            .should().dependOnClassesThat().resideInAPackage("co.scuby..worker..")
            .allowEmptyShould(true);
}
```

Add to `pom.xml` dependencies:

```xml
<dependency>
  <groupId>com.tngtech.archunit</groupId>
  <artifactId>archunit-junit5</artifactId>
  <version>1.5.1</version>
  <scope>test</scope>
</dependency>
```

- [ ] **Step 2: Run to see `RolesTest` fail** — `./mvnw -q test -Dtest='RolesTest,RoleBoundariesTest'` → compile error (annotations missing).

- [ ] **Step 3: The annotations**

`ApiComponent.java`:

```java
package co.scuby.platform.roles;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** A bean of the `api` role: on unless `scuby.roles.api=false` (docs/eng/backend.md · One deployable, two roles). */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
@ConditionalOnProperty(name = "scuby.roles.api", havingValue = "true", matchIfMissing = true)
public @interface ApiComponent {}
```

`WorkerComponent.java`: identical with `scuby.roles.worker` and the word `worker` in the comment.

If `ConditionalOnProperty` is not in `org.springframework.boot.autoconfigure.condition` in Boot 4.1, locate it in the `spring-boot-autoconfigure` jar and fix the import.

- [ ] **Step 4: Run to see both pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: api and worker roles as conditional components, with an ArchUnit boundary between them"
```

---

### Task 3: The project Postgres image (Postgres 17 + PostGIS + pgvector, ARM64 and amd64)

**Files:**
- Create: `infra/docker/postgres/Dockerfile`, `infra/docker/postgres/verify.sh`, `backend/compose.yaml`

**Interfaces:**
- Produces: image tag `scuby/postgres:17`; local database `jdbc:postgresql://localhost:5433/scuby`, user `scuby`, password `scuby`.

Background: the official `postgis/postgis` images are amd64-only (docs/eng/infra.md · Database). The official `postgres:17` image is Debian-based and already has the PGDG apt repository configured, which publishes PostGIS and pgvector for both architectures.

- [ ] **Step 1: `infra/docker/postgres/Dockerfile`**

```dockerfile
# Postgres 17 + PostGIS 3 + pgvector, multi-arch (docs/eng/infra.md · Database).
FROM postgres:17

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-postgis-3 \
      postgresql-17-postgis-3-scripts \
      postgresql-17-pgvector \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: `infra/docker/postgres/verify.sh`** (the image's test)

```bash
#!/usr/bin/env bash
# Builds the image, starts it, and checks that both extensions install. Exit non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t scuby/postgres:17 .
cid=$(docker run -d -e POSTGRES_PASSWORD=verify scuby/postgres:17)
trap 'docker rm -f "$cid" >/dev/null' EXIT
for _ in $(seq 1 30); do
  docker exec "$cid" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$cid" psql -U postgres -v ON_ERROR_STOP=1 -tAc \
  "CREATE EXTENSION postgis; CREATE EXTENSION vector; SELECT postgis_lib_version();"
echo "OK: postgis and vector install on $(docker exec "$cid" uname -m)"
```

- [ ] **Step 3: Run it**

```bash
chmod +x infra/docker/postgres/verify.sh && infra/docker/postgres/verify.sh
```

Expected: a PostGIS version line, then `OK: postgis and vector install on aarch64`. If `postgresql-17-postgis-3` is unavailable, try the package names from `apt-cache search postgis` inside `postgres:17`; only as last resort switch every `17` in this task to `16` and note it in the night report (docs/eng/infra.md names 16 as the tested fallback).

- [ ] **Step 4: `backend/compose.yaml`**

```yaml
# Local database for `SPRING_PROFILES_ACTIVE=local` (backend/README.md).
services:
  postgres:
    build: ../infra/docker/postgres
    image: scuby/postgres:17
    environment:
      POSTGRES_DB: scuby
      POSTGRES_USER: scuby
      POSTGRES_PASSWORD: scuby
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Run: `cd backend && docker compose up -d && docker compose exec postgres pg_isready -U scuby && docker compose down`
Expected: `accepting connections`.

- [ ] **Step 5: Commit**

```bash
git add infra/docker/postgres backend/compose.yaml
git commit -m "feat: project Postgres image with PostGIS and pgvector for ARM64 and amd64; local compose"
```

---

### Task 4: Testcontainers singleton + Flyway migrations

**Files:**
- Modify: `backend/pom.xml`, `backend/src/main/resources/application.yml`, `application-local.yml`
- Create: `backend/src/main/resources/db/migration/V1__postgis.sql`, `V2__outbox_events.sql`, `backend/src/test/java/co/scuby/TestcontainersConfiguration.java`
- Modify: `backend/src/test/java/co/scuby/ApplicationHealthTest.java` (import the container config)
- Test: `backend/src/test/java/co/scuby/platform/db/MigrationsTest.java`

**Interfaces:**
- Consumes: `infra/docker/postgres/Dockerfile` (Task 3).
- Produces: `co.scuby.TestcontainersConfiguration` — every `@SpringBootTest` that needs the database adds `@Import(TestcontainersConfiguration.class)`; table `scuby.outbox_events`.

- [ ] **Step 1: Dependencies** — add to `pom.xml`:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-flyway</artifactId>
</dependency>
<dependency>
  <groupId>org.flywaydb</groupId>
  <artifactId>flyway-database-postgresql</artifactId>
</dependency>
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <scope>runtime</scope>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-testcontainers</artifactId>
  <scope>test</scope>
</dependency>
<dependency>
  <groupId>org.testcontainers</groupId>
  <artifactId>testcontainers-postgresql</artifactId>
  <scope>test</scope>
</dependency>
<dependency>
  <groupId>org.testcontainers</groupId>
  <artifactId>testcontainers-junit-jupiter</artifactId>
  <scope>test</scope>
</dependency>
```

- [ ] **Step 2: Failing test** — `MigrationsTest.java`

```java
package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class MigrationsTest {

    @Autowired JdbcTemplate jdbc;

    @Test
    void postgisIsInstalled() {
        String version = jdbc.queryForObject("SELECT postgis_lib_version()", String.class);
        assertThat(version).startsWith("3.");
    }

    @Test
    void pgvectorIsAvailableForLater() {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM pg_available_extensions WHERE name = 'vector'", Integer.class);
        assertThat(n).isEqualTo(1);
    }

    @Test
    void outboxTableExistsInTheAppSchema() {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'scuby' AND table_name = 'outbox_events'",
                Integer.class);
        assertThat(n).isEqualTo(1);
    }
}
```

- [ ] **Step 3: Run to see it fail** — `./mvnw -q test -Dtest=MigrationsTest` → compile error (`TestcontainersConfiguration` missing).

- [ ] **Step 4: Container configuration** — `backend/src/test/java/co/scuby/TestcontainersConfiguration.java`

```java
package co.scuby;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Path;

/**
 * One PostGIS container per test JVM, built from the project image (infra/docker/postgres).
 * Spring's context cache shares it across every test class that imports this configuration.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    private static final Path DOCKERFILE = Path.of("..", "infra", "docker", "postgres", "Dockerfile");

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        String image = new ImageFromDockerfile("scuby/postgres", false)
                .withDockerfile(DOCKERFILE)
                .get();
        return new PostgreSQLContainer(DockerImageName.parse(image).asCompatibleSubstituteFor("postgres"));
    }
}
```

Testcontainers 2.x moved `PostgreSQLContainer` to `org.testcontainers.postgresql` and dropped its generic parameter. If the build says otherwise, locate the class in the `testcontainers-postgresql-2.0.5` jar and adapt the import/type only.

- [ ] **Step 5: Migrations**

`V1__postgis.sql`:

```sql
-- PostGIS lives in public; application tables live in the scuby schema (docs/eng/backend.md · Data access).
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
```

`V2__outbox_events.sql` — exactly the table of docs/eng/outbox-relay.md §2:

```sql
CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  payload_json  jsonb NOT NULL,
  locked_until  timestamptz NULL,
  attempts      int NOT NULL DEFAULT 0
) WITH (fillfactor = 70);

CREATE INDEX ON outbox_events (created_at);
```

Add to `application.yml` under `spring:`:

```yaml
  flyway:
    schemas: scuby
    default-schema: scuby
    create-schemas: true
```

`application-local.yml`:

```yaml
# Local development — database from backend/compose.yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5433/scuby
    username: scuby
    password: scuby
```

- [ ] **Step 6: Keep the health test green** — add `@Import(TestcontainersConfiguration.class)` (and its import) to `ApplicationHealthTest`, since the application now needs a database.

- [ ] **Step 7: Run** — `./mvnw -q test -Dtest='MigrationsTest,ApplicationHealthTest'` → PASS (first run builds the image; allow a few minutes).

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat: Flyway migrations (PostGIS, outbox table) tested on a singleton PostGIS container"
```

---

### Task 5: jOOQ code generation from the migrations

**Files:**
- Modify: `backend/pom.xml`, `backend/src/main/resources/application.yml`
- Test: `backend/src/test/java/co/scuby/platform/db/OutboxTableTest.java`

**Interfaces:**
- Consumes: migrations (Task 4), image `scuby/postgres:17` built locally (Task 3 — `infra/docker/postgres/verify.sh` builds it).
- Produces: generated package `co.scuby.db.generated` (e.g. `co.scuby.db.generated.Tables.OUTBOX_EVENTS`); a Spring-managed `DSLContext`.

- [ ] **Step 1: Dependencies and the generator**

Add to `pom.xml` dependencies:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-jooq</artifactId>
</dependency>
```

Add to `<build><plugins>`:

```xml
<plugin>
  <groupId>org.testcontainers</groupId>
  <artifactId>testcontainers-jooq-codegen-maven-plugin</artifactId>
  <version>0.0.4</version>
  <dependencies>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <version>${postgresql.version}</version>
    </dependency>
  </dependencies>
  <executions>
    <execution>
      <id>generate-jooq-sources</id>
      <phase>generate-sources</phase>
      <goals><goal>generate</goal></goals>
      <configuration>
        <database>
          <type>POSTGRES</type>
          <containerImage>scuby/postgres:17</containerImage>
        </database>
        <flyway>
          <locations>filesystem:src/main/resources/db/migration</locations>
          <defaultSchema>scuby</defaultSchema>
          <schemas>scuby</schemas>
          <createSchemas>true</createSchemas>
        </flyway>
        <jooq>
          <generator>
            <database>
              <inputSchema>scuby</inputSchema>
              <excludes>flyway_schema_history</excludes>
            </database>
            <target>
              <packageName>co.scuby.db.generated</packageName>
              <directory>target/generated-sources/jooq</directory>
            </target>
          </generator>
        </jooq>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Add to `application.yml` under `spring:`:

```yaml
  jooq:
    sql-dialect: postgres
```

**Fallback if the plugin cannot run** (it is old and built for Testcontainers 1.x; failures look like class-not-found or a container that never starts): replace it with a Maven profile `jooq-codegen` that runs `flyway-maven-plugin` (`migrate`) then `jooq-codegen-maven` (`generate`) against the Compose database on `localhost:5433`, writing to `src/main/jooq-generated` (added as a source root with `build-helper-maven-plugin`), and **commit the generated sources**. Regeneration becomes `docker compose up -d && ./mvnw -Pjooq-codegen generate-sources`. Record which path was taken in the night report and in `backend/README.md`.

- [ ] **Step 2: Failing test** — `OutboxTableTest.java`

```java
package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.util.UUID;

import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class OutboxTableTest {

    @Autowired DSLContext db;

    @Test
    void generatedCodeRoundTripsARow() {
        UUID id = UUID.randomUUID();
        db.insertInto(OUTBOX_EVENTS)
          .set(OUTBOX_EVENTS.ID, id)
          .set(OUTBOX_EVENTS.PAYLOAD_JSON, JSONB.valueOf("{\"type\":\"probe\"}"))
          .execute();

        var row = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ID.eq(id)).fetchOne();

        assertThat(row).isNotNull();
        assertThat(row.getAttempts()).isZero();
        assertThat(row.getLockedUntil()).isNull();
        assertThat(row.getCreatedAt()).isNotNull();
    }
}
```

- [ ] **Step 3: Run** — `./mvnw -q test -Dtest=OutboxTableTest`. Before the generator exists: compile error on `co.scuby.db.generated`. After Step 1: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat: jOOQ classes generated from the Flyway migrations on a real Postgres"
```

---

### Task 6: PostGIS helpers for jOOQ OSS

**Files:**
- Create: `backend/src/main/java/co/scuby/platform/db/GeoPoint.java`, `Spatial.java`
- Test: `backend/src/test/java/co/scuby/platform/db/SpatialTest.java`

**Interfaces:**
- Consumes: `DSLContext` (Task 5), `TestcontainersConfiguration` (Task 4).
- Produces:
  - `record GeoPoint(double lat, double lng)` — rejects lat ∉ [-90, 90] or lng ∉ [-180, 180] with `IllegalArgumentException`.
  - `Spatial.geography(GeoPoint p): Field<Object>` — `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`.
  - `Spatial.distanceMeters(Field<?> a, Field<?> b): Field<Double>`.
  - `Spatial.withinMeters(Field<?> a, Field<?> b, double meters): Condition`.

Background: jOOQ's spatial support is a commercial-edition feature; the OSS edition uses plain-SQL templates (docs/eng/backend.md · Data access). A custom `Binding` for `geography` columns is added later, with the first table that has one.

- [ ] **Step 1: Failing test** — `SpatialTest.java`

```java
package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import static co.scuby.platform.db.Spatial.distanceMeters;
import static co.scuby.platform.db.Spatial.geography;
import static co.scuby.platform.db.Spatial.withinMeters;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class SpatialTest {

    // Plaza de Bolívar and Parque de la 93, Bogotá: ~9.2 km apart.
    static final GeoPoint PLAZA = new GeoPoint(4.5981, -74.0760);
    static final GeoPoint PARQUE_93 = new GeoPoint(4.6766, -74.0484);

    @Autowired DSLContext db;

    @Test
    void distanceIsInMeters() {
        Double d = db.select(distanceMeters(geography(PLAZA), geography(PARQUE_93))).fetchOne(0, Double.class);
        assertThat(d).isBetween(9_000.0, 9_500.0);
    }

    @Test
    void withinIsInclusiveOfTheRadius() {
        Boolean near = db.select(org.jooq.impl.DSL.field(withinMeters(geography(PLAZA), geography(PARQUE_93), 10_000)))
                         .fetchOne(0, Boolean.class);
        Boolean far = db.select(org.jooq.impl.DSL.field(withinMeters(geography(PLAZA), geography(PARQUE_93), 5_000)))
                        .fetchOne(0, Boolean.class);
        assertThat(near).isTrue();
        assertThat(far).isFalse();
    }

    @Test
    void pointsOutsideTheGlobeAreRejected() {
        assertThatThrownBy(() -> new GeoPoint(91, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GeoPoint(0, 181)).isInstanceOf(IllegalArgumentException.class);
    }
}
```

- [ ] **Step 2: Run to see it fail** — `./mvnw -q test -Dtest=SpatialTest` → compile error.

- [ ] **Step 3: Implementation**

`GeoPoint.java`:

```java
package co.scuby.platform.db;

/** A point on the wire's `{ lat, lng }` shape (docs/eng/api.md · Conventions). */
public record GeoPoint(double lat, double lng) {
    public GeoPoint {
        if (lat < -90 || lat > 90) throw new IllegalArgumentException("lat out of range: " + lat);
        if (lng < -180 || lng > 180) throw new IllegalArgumentException("lng out of range: " + lng);
    }
}
```

`Spatial.java`:

```java
package co.scuby.platform.db;

import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;

/**
 * The PostGIS functions we use, as jOOQ plain-SQL templates. jOOQ's own spatial API is
 * commercial-only; keep every spatial SQL string in this class.
 */
public final class Spatial {

    private Spatial() {}

    /** A WGS 84 geography point; distances on it are in meters. */
    public static Field<Object> geography(GeoPoint p) {
        return DSL.field("ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography",
                Object.class, DSL.val(p.lng()), DSL.val(p.lat()));
    }

    public static Field<Double> distanceMeters(Field<?> a, Field<?> b) {
        return DSL.field("ST_Distance({0}, {1})", SQLDataType.DOUBLE, a, b);
    }

    public static Condition withinMeters(Field<?> a, Field<?> b, double meters) {
        return DSL.condition("ST_DWithin({0}, {1}, {2})", a, b, DSL.val(meters));
    }
}
```

- [ ] **Step 4: Run to see it pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: PostGIS distance and radius helpers for jOOQ open-source edition"
```

---

### Task 7: The error envelope

**Files:**
- Create: `backend/src/main/java/co/scuby/platform/web/ErrorCode.java`, `ApiException.java`, `ApiErrorBody.java`, `ApiErrorHandler.java`
- Test: `backend/src/test/java/co/scuby/platform/web/ApiErrorHandlerTest.java`

**Interfaces:**
- Produces:
  - `enum ErrorCode` — wire value via `wire()` (snake_case), HTTP status via `status()`; exactly the 14 codes of `docs/eng/api.md` · Errors / `web/src/contracts/errors.ts`.
  - `ApiException(ErrorCode code, String message)` and `ApiException(ErrorCode, String, Map<String,String> fields, Map<String,String> details)`.
  - `ApiErrorBody.of(ErrorCode, String message, Map fields, Map details)` serializing to `{"error":{"code":…,"message":…,"fields"?:…,"details"?:…}}` — `fields`/`details` omitted when empty.

- [ ] **Step 1: Failing test** — `ApiErrorHandlerTest.java`

```java
package co.scuby.platform.web;

import co.scuby.TestcontainersConfiguration;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, ApiErrorHandlerTest.Probe.class})
class ApiErrorHandlerTest {

    record Body(@NotBlank String name) {}

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/conflict")
        void conflict() {
            throw new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "pet already has an active case",
                    Map.of(), Map.of("case_code", "7K3PQ"));
        }

        @GetMapping("/probe/boom")
        void boom() {
            throw new IllegalStateException("unexpected");
        }

        @PostMapping("/probe/validate")
        void validate(@Valid @RequestBody Body body) {}
    }

    @Autowired MockMvc mvc;

    @Test
    void apiExceptionKeepsCodeStatusAndDetails() throws Exception {
        mvc.perform(get("/probe/conflict"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.error.code").value("active_case_exists"))
           .andExpect(jsonPath("$.error.details.case_code").value("7K3PQ"))
           .andExpect(jsonPath("$.error.fields").doesNotExist());
    }

    @Test
    void beanValidationIsValidationFailedWithFields() throws Exception {
        mvc.perform(post("/probe/validate").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"))
           .andExpect(jsonPath("$.error.fields.name").exists());
    }

    @Test
    void unreadableBodyIsValidationFailed() throws Exception {
        mvc.perform(post("/probe/validate").contentType(MediaType.APPLICATION_JSON).content("{not json"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void unknownRouteIsNotFound() throws Exception {
        mvc.perform(get("/no/such/route"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    void anythingElseIsServerErrorWithoutLeakingTheMessage() throws Exception {
        mvc.perform(get("/probe/boom"))
           .andExpect(status().isInternalServerError())
           .andExpect(jsonPath("$.error.code").value("server_error"))
           .andExpect(jsonPath("$.error.message").value("server_error"));
    }
}
```

Add `spring-boot-starter-validation` to `pom.xml` dependencies (needed for `@Valid`/`@NotBlank`).

- [ ] **Step 2: Run to see it fail** — `./mvnw -q test -Dtest=ApiErrorHandlerTest` → compile error.

- [ ] **Step 3: Implementation**

`ErrorCode.java`:

```java
package co.scuby.platform.web;

import org.springframework.http.HttpStatus;

/** Every failure the API answers with — mirror of web/src/contracts/errors.ts (docs/eng/api.md · Errors). */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED),
    FORBIDDEN(HttpStatus.FORBIDDEN),
    NOT_FOUND(HttpStatus.NOT_FOUND),
    GONE(HttpStatus.GONE),
    INVALID_TRANSITION(HttpStatus.CONFLICT),
    ACTIVE_CASE_EXISTS(HttpStatus.CONFLICT),
    INVALID_CODE(HttpStatus.UNPROCESSABLE_ENTITY),
    PHONE_REQUIRED(HttpStatus.UNPROCESSABLE_ENTITY),
    SIGHTING_TOO_FAR(HttpStatus.UNPROCESSABLE_ENTITY),
    SEEN_AT_IN_FUTURE(HttpStatus.UNPROCESSABLE_ENTITY),
    SEEN_AT_BEFORE_CASE(HttpStatus.UNPROCESSABLE_ENTITY),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS),
    SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) { this.status = status; }

    public HttpStatus status() { return status; }

    public String wire() { return name().toLowerCase(java.util.Locale.ROOT); }
}
```

`ApiException.java`:

```java
package co.scuby.platform.web;

import java.util.Map;

/** Thrown by any layer to answer with a contract error. */
public class ApiException extends RuntimeException {
    private final ErrorCode code;
    private final Map<String, String> fields;
    private final Map<String, String> details;

    public ApiException(ErrorCode code, String message) {
        this(code, message, Map.of(), Map.of());
    }

    public ApiException(ErrorCode code, String message, Map<String, String> fields, Map<String, String> details) {
        super(message);
        this.code = code;
        this.fields = Map.copyOf(fields);
        this.details = Map.copyOf(details);
    }

    public ErrorCode code() { return code; }
    public Map<String, String> fields() { return fields; }
    public Map<String, String> details() { return details; }
}
```

`ApiErrorBody.java`:

```java
package co.scuby.platform.web;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/** `{ "error": { code, message, fields?, details? } }` — the one failure body (docs/eng/api.md · Errors). */
public record ApiErrorBody(Error error) {

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record Error(String code, String message, Map<String, String> fields, Map<String, String> details) {}

    public static ApiErrorBody of(ErrorCode code, String message, Map<String, String> fields, Map<String, String> details) {
        return new ApiErrorBody(new Error(code.wire(), message, fields, details));
    }
}
```

(Jackson 3 keeps annotations in `com.fasterxml.jackson.annotation`.)

`ApiErrorHandler.java`:

```java
package co.scuby.platform.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.LinkedHashMap;
import java.util.Map;

/** Turns every failure into the contract's envelope. The client writes its own copy per code. */
@RestControllerAdvice
public class ApiErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorBody> api(ApiException e) {
        return respond(e.code(), e.getMessage(), e.fields(), e.details());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiErrorBody> invalid(MethodArgumentNotValidException e) {
        Map<String, String> fields = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors()
         .forEach(f -> fields.putIfAbsent(f.getField(), f.getDefaultMessage()));
        return respond(ErrorCode.VALIDATION_FAILED, "request does not match the contract", fields, Map.of());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrorBody> unreadable(HttpMessageNotReadableException e) {
        return respond(ErrorCode.VALIDATION_FAILED, "unreadable request body", Map.of(), Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiErrorBody> notFound(NoResourceFoundException e) {
        return respond(ErrorCode.NOT_FOUND, "no such route", Map.of(), Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorBody> unexpected(Exception e) {
        log.error("unhandled exception", e);
        return respond(ErrorCode.SERVER_ERROR, "server_error", Map.of(), Map.of());
    }

    private static ResponseEntity<ApiErrorBody> respond(ErrorCode code, String message,
                                                        Map<String, String> fields, Map<String, String> details) {
        return ResponseEntity.status(code.status()).body(ApiErrorBody.of(code, message, fields, details));
    }
}
```

Field names in `fields` are Java property names; when request records gain snake_case wire names they must be mapped to the wire path (docs/eng/api.md · Errors says `fields` maps each *wire* path). Note this in the night report as a follow-up, not tonight's work.

- [ ] **Step 4: Run to see it pass** — same command → PASS. If the unknown-route test gets a 404 without the envelope, add `spring.mvc.problemdetails.enabled: false` to `application.yml` and check whether Boot 4 needs `spring.web.resources.add-mappings: false` so `NoResourceFoundException` reaches the advice.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: every failure answers with the contract's error envelope"
```

---

### Task 8: Contract validator against `docs/eng/openapi.json`

**Files:**
- Modify: `backend/pom.xml` (json-schema-validator, test scope)
- Create: `backend/src/test/java/co/scuby/contract/ContractValidator.java`
- Test: `backend/src/test/java/co/scuby/contract/ContractValidatorTest.java`

**Interfaces:**
- Consumes: `docs/eng/openapi.json` (read-only; OpenAPI 3.1 → JSON Schema 2020-12), `ApiErrorBody`/`ErrorCode` (Task 7).
- Produces: `ContractValidator.load(): ContractValidator` and `List<String> errors(String method, String pathTemplate, int status, String jsonBody)` — empty list = conforms. `pathTemplate` is the OpenAPI key, e.g. `/cases/{code}`. Unknown method/path/status → one error naming what is missing. Later tasks call this from integration tests on every response they produce.

- [ ] **Step 1: Dependency**

```xml
<dependency>
  <groupId>com.networknt</groupId>
  <artifactId>json-schema-validator</artifactId>
  <version>3.0.8</version>
  <scope>test</scope>
</dependency>
```

- [ ] **Step 2: Failing test** — `ContractValidatorTest.java`

```java
package co.scuby.contract;

import co.scuby.platform.web.ApiErrorBody;
import co.scuby.platform.web.ErrorCode;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.PropertyNamingStrategies;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ContractValidatorTest {

    static final ContractValidator contract = ContractValidator.load();

    static final String GOOD_CONFIG = """
            {"supported_countries":[{"code":"CO","phone_prefix":"+57","mobile_pattern":"^3\\\\d{9}$",
              "default_center":{"lat":4.6,"lng":-74.08}}]}""";

    @Test
    void aConformingBodyHasNoErrors() {
        assertThat(contract.errors("GET", "/config", 200, GOOD_CONFIG)).isEmpty();
    }

    @Test
    void aMissingRequiredFieldIsReported() {
        String bad = """
                {"supported_countries":[{"code":"CO","phone_prefix":"+57","mobile_pattern":"x"}]}""";
        assertThat(contract.errors("GET", "/config", 200, bad)).isNotEmpty();
    }

    @Test
    void anExtraFieldIsReported() {
        String bad = GOOD_CONFIG.replace("\"code\":\"CO\"", "\"code\":\"CO\",\"surprise\":1");
        assertThat(contract.errors("GET", "/config", 200, bad)).isNotEmpty();
    }

    @Test
    void anUndocumentedStatusIsReported() {
        assertThat(contract.errors("GET", "/config", 418, "{}")).singleElement().asString().contains("418");
    }

    @Test
    void ourErrorEnvelopeMatchesTheContractsErrorSchema() throws Exception {
        var mapper = JsonMapper.builder().propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE).build();
        String body = mapper.writeValueAsString(
                ApiErrorBody.of(ErrorCode.RATE_LIMITED, "slow down", Map.of(), Map.of()));
        assertThat(contract.errors("GET", "/config", 429, body)).isEmpty();
    }
}
```

- [ ] **Step 3: Run to see it fail** — `./mvnw -q test -Dtest=ContractValidatorTest` → compile error.

- [ ] **Step 4: Learn the library's API before writing the validator.** networknt 3.x renamed its classes relative to the widely documented 1.x API. Run:

```bash
J=$(find ~/.m2/repository/com/networknt/json-schema-validator/3.0.8 -name '*.jar' | head -1)
unzip -l "$J" | grep -E '/(SchemaRegistry|JsonSchemaFactory|Schema|JsonSchema|SchemaLocation|SpecificationVersion|SpecVersion|InputFormat|Error|ValidationMessage)\.class'
```

and read the project README for 3.x (`https://github.com/networknt/json-schema-validator`). Write `ContractValidator` with whatever names 3.0.8 uses, keeping exactly this behaviour:

1. Read `../docs/eng/openapi.json` once (path relative to `backend/`).
2. Register the **whole document** as a schema resource under a base URI (e.g. `https://scuby.local/openapi.json`) with the **Draft 2020-12** dialect, so `$ref: "#/components/schemas/Error"` resolves inside it.
3. For `(method, path, status)`, the schema is the JSON Pointer
   `#/paths/<escaped path>/<lowercase method>/responses/<status>/content/application~1json/schema`
   (escape `~` as `~0` and `/` as `~1` in the path). If that node does not exist, return
   `List.of("contract has no " + method + " " + path + " → " + status)`.
4. Load the schema by that pointer (`<base URI>#<pointer>`), validate the body as JSON, return each validation message as a string.

Skeleton (adapt only the library calls):

```java
package co.scuby.contract;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/** Validates response bodies against docs/eng/openapi.json (docs/eng/backend.md · The API contract). */
public final class ContractValidator {

    static final Path DOCUMENT = Path.of("..", "docs", "eng", "openapi.json");
    static final String BASE = "https://scuby.local/openapi.json";

    // fields: the parsed document (for existence checks) and the library's schema registry

    public static ContractValidator load() {
        try {
            String json = Files.readString(DOCUMENT);
            // parse json; build a Draft 2020-12 registry that knows BASE → this document
            return new ContractValidator(/* … */);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public List<String> errors(String method, String pathTemplate, int status, String jsonBody) {
        String pointer = "/paths/" + escape(pathTemplate) + "/" + method.toLowerCase(Locale.ROOT)
                + "/responses/" + status + "/content/application~1json/schema";
        // if the parsed document has no node at `pointer`:
        //     return List.of("contract has no " + method + " " + pathTemplate + " → " + status);
        // schema = registry.getSchema(BASE + "#" + pointer); validate jsonBody; map messages to strings
        return List.of();
    }

    static String escape(String path) {
        return path.replace("~", "~0").replace("/", "~1");
    }
}
```

- [ ] **Step 5: Run to see it pass** — `./mvnw -q test -Dtest=ContractValidatorTest` → PASS. If the 3.1 document trips the validator (e.g. an unsupported keyword), record the exact message in the night report — it is input for open item O19 (docs/open-items.md).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "test: responses can be validated against docs/eng/openapi.json; the error envelope conforms"
```

---

### Task 9: ARM64 image with Jib, verified against the local database

**Files:**
- Modify: `backend/pom.xml`

**Interfaces:**
- Consumes: everything above; `backend/compose.yaml`.
- Produces: `./mvnw jib:dockerBuild -Djib.from.platforms=linux/arm64` → local image `scuby-backend`; multi-arch (`linux/arm64`, `linux/amd64`) is configured for registry pushes later.

- [ ] **Step 1: Plugin** — add to `<build><plugins>`:

```xml
<plugin>
  <groupId>com.google.cloud.tools</groupId>
  <artifactId>jib-maven-plugin</artifactId>
  <version>3.5.2</version>
  <configuration>
    <from>
      <image>eclipse-temurin:25-jre</image>
      <platforms>
        <platform><architecture>arm64</architecture><os>linux</os></platform>
        <platform><architecture>amd64</architecture><os>linux</os></platform>
      </platforms>
    </from>
    <to>
      <image>scuby-backend</image>
    </to>
    <container>
      <mainClass>co.scuby.ScubyApplication</mainClass>
      <ports><port>8080</port></ports>
      <jvmFlags>
        <jvmFlag>-XX:MaxRAMPercentage=60</jvmFlag>
      </jvmFlags>
    </container>
  </configuration>
</plugin>
```

`mainClass` is explicit so Jib does not have to scan Java 25 bytecode.

- [ ] **Step 2: Build and run**

```bash
cd backend
./mvnw -q -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker compose up -d
docker run -d --name scuby-backend-smoke -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=local \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://host.docker.internal:5433/scuby \
  scuby-backend
for _ in $(seq 1 60); do curl -sf localhost:8080/actuator/health && break; sleep 2; done
docker rm -f scuby-backend-smoke; docker compose down
```

Expected: `{"status":"UP"}` (Flyway migrates the compose database on start-up).

- [ ] **Step 3: Commit**

```bash
git add backend/pom.xml
git commit -m "feat: Jib builds the backend image for ARM64 and amd64 on a Java 25 JRE"
```

---

### Task 10: CI workflow

**Files:**
- Create: `.github/workflows/backend.yml`

**Interfaces:**
- Consumes: `infra/docker/postgres/Dockerfile`, the Maven wrapper, `docs/eng/openapi.json`.

- [ ] **Step 1: Workflow**

```yaml
name: backend

on:
  pull_request:
    paths: ['backend/**', 'infra/docker/postgres/**', 'docs/eng/openapi.json', '.github/workflows/backend.yml']
  push:
    branches: [main]
    paths: ['backend/**', 'infra/docker/postgres/**', 'docs/eng/openapi.json', '.github/workflows/backend.yml']

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version-file: backend/.java-version
          cache: maven
      # jOOQ codegen and Testcontainers both use the project image (docs/eng/infra.md · Database).
      - run: docker build -t scuby/postgres:17 ../infra/docker/postgres
      - run: ./mvnw -B verify
```

If Task 5 took the committed-sources fallback, the `docker build` step is still needed by Testcontainers (it builds from the Dockerfile itself, but a pre-built tag keeps it fast).

- [ ] **Step 2: Local check of what CI runs**

```bash
cd backend && ./mvnw -B verify
```

Expected: `BUILD SUCCESS`, all tests green. The workflow itself cannot run tonight (nothing is pushed); syntax-check it with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backend.yml'))"` from the repo root.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backend.yml
git commit -m "ci: backend workflow — build the Postgres image, run the Maven verify"
```

---

### Task 11: Docs and the night report

**Files:**
- Create: `backend/README.md`
- Modify: `README.md` (root), `docs/eng/backend.md` (Stack table), `docs/eng/backend-plan.md` (P.3)
- Create (outside the repo): the night report

- [ ] **Step 1: `backend/README.md`** — in Spanish, like `web/README.md`: what this folder is; requirements (jenv with Java 25, Docker, Maven via `./mvnw`); commands: run tests (`./mvnw verify`), run locally (`docker compose up -d` + `SPRING_PROFILES_ACTIVE=local ./mvnw spring-boot:run`), regenerate jOOQ code (whichever path Task 5 ended with), build the image (Task 9's command); folder layout (`co.scuby.platform.*`, role package convention `..api..` / `..worker..`); links to `docs/eng/backend.md`, `infra.md`, `backend-plan.md`.

- [ ] **Step 2: Root `README.md`** — add rows to the folder table:

```markdown
| [`backend/`](backend/README.md) | API y trabajo de fondo (Java 25, Spring Boot, Maven) |
| [`infra/`](infra/) | Infraestructura: la imagen de Postgres; Terraform después |
```

- [ ] **Step 3: `docs/eng/backend.md`** — add a row to the Stack table, after *Container image*:

```markdown
| Build | **Maven** with the wrapper committed (`backend/mvnw`); Java version pinned for jenv in `backend/.java-version` |
```

- [ ] **Step 4: `docs/eng/backend-plan.md`** — replace the first bullet of *P.3 Decisions to close before code* with:

```markdown
- ~~Build tool and folder layout~~ — decided 2026-10-23: **Maven**; `backend/` and `infra/` beside `web/`.
```

- [ ] **Step 5: Verify links** (repo root):

```bash
python3 -I - <<'EOF'
import re,os
bad=[]
for root,_,fs in os.walk('.'):
  if '/node_modules' in root or '/.git' in root or '/target' in root: continue
  for f in fs:
    if not f.endswith('.md'): continue
    p=os.path.join(root,f); s=open(p).read()
    for m in re.finditer(r'\]\(([^)#\s]+)(#[^)]*)?\)',s):
      t=m.group(1)
      if t.startswith('http'): continue
      if not os.path.exists(os.path.normpath(os.path.join(root,t))): bad.append((p,t))
print(bad or 'all links ok')
EOF
```

Expected: `all links ok`.

- [ ] **Step 6: Commit**

```bash
git add backend/README.md README.md docs/eng/backend.md docs/eng/backend-plan.md
git commit -m "doc: how to run the backend; Maven and the folder layout decided"
```

- [ ] **Step 7: Night report** — write `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/night-report.md` (in Spanish, for the user):
  - per task: done / partial / blocked, with the commit hash;
  - every deviation from this plan and why (API renames, fallbacks taken, versions changed);
  - final `./mvnw -B verify` output summary (tests run, failures);
  - follow-ups found (e.g. wire-path mapping for `fields`, O19 findings from Task 8);
  - `git log --oneline doc/backend-architecture..be/0-foundation`.

---

## Not in this plan (and why)

- **Observability wiring** (OpenTelemetry → New Relic, Sentry): needs accounts to verify; added when staging exists.
- **SQS, the outbox relay, Parameter Store, Spring Cloud AWS**: phase I/L work; needs AWS.
- **Terraform**: phase I; needs the AWS account.
- **Any endpoint of the contract**: phase S, after the contract changes are agreed with the client engineer.
