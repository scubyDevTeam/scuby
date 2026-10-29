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

Convención de paquetes: por funcionalidad y plano (`platform`, `identity`, `uploads`, `pets`, `cases`);
las reglas de dependencia, roles y pureza las comprueba `ArchitectureTest` (ArchUnit) y fallan el
build. Instrucciones para agentes: [`CLAUDE.md`](CLAUDE.md).

## Más

- [`../docs/eng/backend.md`](../docs/eng/backend.md): arquitectura y decisiones.
- [`../docs/eng/infra.md`](../docs/eng/infra.md): infraestructura.
- [`../docs/eng/backend-plan.md`](../docs/eng/backend-plan.md): plan y decisiones por cerrar.
- [`../docs/eng/api.md`](../docs/eng/api.md): contrato de la API.
