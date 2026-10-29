# backend/ — API y trabajo de fondo de Scuby

Backend de Scuby: Java 25, Spring Boot y Maven. Implementa el contrato `../docs/eng/openapi.json`
(ver `../docs/eng/api.md`). Todavía no expone endpoints del contrato; esta carpeta es la base sobre
la que se construyen.

## Requisitos

- **jenv con Java 25** (`.java-version`). Si falta: `jenv add` del `openjdk@25` de Homebrew.
- **Docker corriendo.** **Todo build de Maven lo necesita** y también la imagen local
  `scuby/postgres:17`: jOOQ genera su código en `generate-sources` con
  `testcontainers-jooq-codegen-maven-plugin` contra esa imagen.
- Maven, siempre con `./mvnw`.

Construye la imagen de Postgres una vez (con `verify.sh` además se prueba PostGIS):

```bash
infra/docker/postgres/verify.sh        # desde la raíz del repo
# o: docker build -t scuby/postgres:17 infra/docker/postgres
```

## Cómo correrlo

Todos los comandos, desde `backend/`.

| Comando | Qué hace |
|---|---|
| `./mvnw verify` | Compila, genera jOOQ y corre las pruebas. Testcontainers usa la imagen de `infra/docker/postgres/Dockerfile`; las pruebas deben correr con `backend/` como directorio de trabajo |
| `docker compose up -d --wait` | Levanta Postgres local |
| `SPRING_PROFILES_ACTIVE=local ./mvnw spring-boot:run` | Arranca la API; salud en `http://localhost:8080/actuator/health` |
| `./mvnw -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64` | Imagen local `scuby-backend` (el pom lista arm64 y amd64 para publicar en un registro) |

El código de jOOQ se regenera en cada build en `target/generated-sources/jooq`; no se versiona.

## Estructura

```
src/main/java/co/scuby/
├── platform/
│   ├── roles/   Anotaciones de rol: @ApiComponent y @WorkerComponent
│   ├── web/     Sobre de errores: ApiException → ProblemDetail → ContractErrors → {"error":{…}} del contrato
│   └── db/      GeoPoint y Spatial (ayudas de PostGIS)
src/test/java/co/scuby/contract/ContractValidator   Valida respuestas contra docs/eng/openapi.json
```

Convención de paquetes: el código del API va en `..api..` y el del trabajo de fondo en `..worker..`;
una prueba de ArchUnit las mantiene separadas.

## Telemetría

En `local` y `test` no se exporta nada. Para mandar datos reales a New Relic desde el portátil, con
su propio Postgres y puertos para no chocar con otras ejecuciones locales (con
`SPRING_PROFILES_ACTIVE=local,newrelic` contra el compose habitual también funciona):

```bash
docker run --rm --name scuby-obs-pg -p 127.0.0.1:15433:5432 \
  -e POSTGRES_DB=scuby -e POSTGRES_USER=scuby -e POSTGRES_PASSWORD=scuby scuby/postgres:17   # en otra terminal, o añade -d
NR_KEY="$(security find-generic-password -s scuby-newrelic-license-key -w)"
export NEW_RELIC_LICENSE_KEY="$NR_KEY"
SERVER_PORT=18080 SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:15433/scuby \
  SPRING_PROFILES_ACTIVE=local,newrelic ./mvnw spring-boot:run
```

La llave sale del Keychain (ítem `scuby-newrelic-license-key`); nunca la imprimas ni la pegues en
archivos o chats.

Dónde mirar: el dashboard «Scuby — Backend» en New Relic (variable `env`, `local` seleccionable) o
`bash infra/scripts/nr-query.sh "<NRQL>"` desde la raíz. Los servidores la activan solos con los
grupos `staging`/`prod`; ver [`backend.md`](../docs/eng/backend.md) · Environments and profiles y
[`infra.md`](../docs/eng/infra.md) · Secrets.

## Más

- [`../docs/eng/backend.md`](../docs/eng/backend.md): arquitectura y decisiones.
- [`../docs/eng/infra.md`](../docs/eng/infra.md): infraestructura.
- [`../docs/eng/backend-plan.md`](../docs/eng/backend-plan.md): plan y decisiones por cerrar.
- [`../docs/eng/api.md`](../docs/eng/api.md): contrato de la API.
