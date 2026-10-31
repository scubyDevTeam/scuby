# backend/ — API y trabajo de fondo de Scuby

Backend de Scuby: Java 25, Spring Boot y Maven. Implementa el contrato `../docs/eng/openapi.json`
(ver `../docs/eng/api.md`). Todavía no expone endpoints del contrato; esta carpeta es la base sobre
la que se construyen.

## Requisitos

- **Solo Docker, sin JDK:** `bash build.sh` y `bash run-local.sh` compilan con Maven dentro de un contenedor (ver abajo). Es lo único que necesita quien solo quiere correr la API.
- **Para desarrollar el backend: jenv con Java 25** (`.java-version`). Si falta: `jenv add` del `openjdk@25` de Homebrew.
- **Docker corriendo.** **Todo build de Maven lo necesita** y también la imagen local
  `scuby/postgres:17`: jOOQ genera su código en `generate-sources` con
  `testcontainers-jooq-codegen-maven-plugin` contra esa imagen.
- Maven, siempre con `./mvnw`.

`build.sh` construye esa imagen si falta. Con JDK, constrúyela una vez (con `verify.sh` además se prueba PostGIS):

```bash
infra/docker/postgres/verify.sh        # desde la raíz del repo
# o: docker build -t scuby/postgres:17 infra/docker/postgres
```

## Cómo correrlo

Todos los comandos, desde `backend/`.

| Comando | Qué hace |
|---|---|
| `./mvnw verify` | Compila, genera jOOQ y corre las pruebas. Testcontainers usa la imagen de `infra/docker/postgres/Dockerfile`; las pruebas deben correr con `backend/` como directorio de trabajo |
| `COMPOSE_PROJECT_NAME=$(bash compose-project.sh) docker compose up -d --wait` | Levanta Postgres local |
| `SPRING_PROFILES_ACTIVE=local ./mvnw spring-boot:run` | Arranca la API; salud en `http://localhost:8080/actuator/health` |
| `bash run-local.sh` | Todo en Docker: ejecuta `build.sh`, levanta Postgres y la API (perfil `local`) como proyecto de compose propio de este checkout (`bash compose-project.sh` lo imprime) y espera a que la salud diga `UP`. La API queda en `http://localhost:8080` (`SCUBY_API_PORT` la mueve; Postgres en 5433, `SCUBY_DB_PORT`); el cliente (`pnpm dev`, puerto 5173) y su build de e2e (puerto 4173) pueden llamarla con credenciales. Se detiene con `bash run-local.sh down` |
| `bash build.sh [--verify]` | Solo Docker: corre `./mvnw package` (o `verify` con `--verify`, que ejecuta todas las pruebas) en un contenedor `maven:3.9-eclipse-temurin-25` con el socket de Docker montado (Testcontainers y la generación de jOOQ levantan Postgres en el Docker del host) y construye la imagen `scuby-backend:${SCUBY_IMAGE_TAG:-local}` con `Dockerfile` (solo runtime). Caché de Maven en el volumen `scuby-maven-cache` |

Las imágenes `scuby-backend:<checkout>` no las borra `down`: `docker image rm scuby-backend:<checkout>`.
Cada checkout (el principal y cada worktree) es su propio proyecto de compose: contenedores, volumen
de datos e imagen no se comparten. Para Postgres solo: `COMPOSE_PROJECT_NAME=$(bash compose-project.sh) docker compose up -d`
(lo que necesitan las pruebas y la generación de jOOQ). En el perfil `local` los códigos de correo y
SMS salen en el log (`COMPOSE_PROJECT_NAME=$(bash compose-project.sh) docker compose logs -f backend`);
las direcciones `@e2e.scuby.test` y los números `+57 300 000 00xx` aceptan siempre `123456`.

El código de jOOQ se regenera en cada build en `target/generated-sources/jooq`; no se versiona.

## Estructura

```
src/main/java/co/scuby/
├── platform/    técnico, sin dominio: roles, web (sobre de errores), db (PostGIS), security, flags, time, cache, config, crypto, modules
├── identity/    cuentas, sesiones, cookie de dispositivo, código por correo, Google, OTP por SMS, GET /config, GET /me/profile
├── uploads/     ranuras de subida, almacén de fotos (S3 en staging y producción; carpeta de desarrollo en local/test)
├── pets/        la mascota y quién responde por ella
└── cases/       casos perdidos, avistamientos («Lo vi») y el feed

e2e/            correr las pruebas e2e del cliente contra el backend local (run-client-e2e.sh)
src/test/java/co/scuby/support/     arnés de pruebas: ApiClient (contrato + techo de sentencias), TestDb, MutableClock
src/test/java/co/scuby/architecture/ reglas de ArchUnit que fallan el build
```

Convención de paquetes: por funcionalidad y plano (`platform`, `identity`, `uploads`, `pets`, `cases`);
las reglas de dependencia, roles y pureza las comprueba `ArchitectureTest` (ArchUnit) y fallan el
build. Instrucciones para agentes: [`CLAUDE.md`](CLAUDE.md).

## Más

- [`../docs/eng/backend.md`](../docs/eng/backend.md): arquitectura y decisiones.
- [`../docs/eng/infra.md`](../docs/eng/infra.md): infraestructura.
- [`../docs/eng/backend-plan.md`](../docs/eng/backend-plan.md): plan y decisiones por cerrar.
- [`../docs/eng/api.md`](../docs/eng/api.md): contrato de la API.
