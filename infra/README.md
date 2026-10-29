# infra/ — Infraestructura de Scuby

Imagen de Postgres, Terraform, las Lambdas de fotos y el **sandbox**: un entorno desechable en una
cuenta AWS de pruebas que se aplica, se prueba de punta a punta y se destruye en la misma corrida,
para demostrar el Terraform antes de que exista staging. Las decisiones están en
[`../docs/eng/infra.md`](../docs/eng/infra.md) y [`../docs/eng/media-pipeline.md`](../docs/eng/media-pipeline.md).

## Estructura

```
infra/
├── docker/postgres/     Imagen scuby/postgres:17 (Postgres + PostGIS) y verify.sh
├── terraform/
│   ├── modules/         Módulos reutilizables (network, compute, media, edge_api, queues, params, ...)
│   ├── envs/sandbox/    El sandbox: compone los módulos, estado local (ignorado por git)
│   └── bootstrap/       Bucket de estado remoto para staging
├── lambda/media/        Lambdas de fotos (Node + sharp): ingesta y variantes; build.sh las empaqueta
├── compose/sandbox/     Docker Compose que corre en la EC2 (backend + Postgres, con límites de memoria)
└── scripts/             sandbox-build / deploy / smoke / destroy, más los guardias (abajo)
```

## Requisitos

- **Terraform ≥ 1.15** (`versions.tf`).
- **AWS CLI v2** con SSO.
- **Node ≥ 22** (las Lambdas corren en `nodejs22.x`).
- **Docker**.
- El Java del backend (ver [`../backend/README.md`](../backend/README.md)): el sandbox construye la imagen del backend.

## Correr el sandbox

Todo con `AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1`. Los comandos largos corren en segundo
plano (con `nohup`), nunca en primer plano.

**Dónde clonar.** El watchdog corre bajo launchd, y macOS (TCC) no deja que un proceso de launchd
lea `~/Desktop`, `~/Documents` ni `~/Downloads`. El sandbox se corre desde un clon o worktree fuera
de esas carpetas (p. ej. `~/scuby-b1-run`), y el estado de Terraform vive en ese clon.

Orden:

1. `aws sso login --profile itslauyalejo-sso`
2. `infra/lambda/media/build.sh` (y `infra/scripts/sandbox-build.sh` para las imágenes)
3. **Arrancar el watchdog antes del apply**:
   `launchctl submit -l co.scuby.watchdog -- /usr/bin/caffeinate -dims /bin/bash <clon>/infra/scripts/sandbox-watchdog.sh <deadline-epoch>`,
   con el deadline unos 45 min antes de que expire la sesión SSO. Antes de aplicar, `watchdog.log`
   debe mostrar las rutas de `terraform` y `aws` (no `MISSING`).
4. `terraform -chdir=infra/terraform/envs/sandbox apply`
5. `infra/scripts/sandbox-deploy.sh`
6. `infra/scripts/sandbox-smoke.sh`
7. **Siempre, al final:** `infra/scripts/sandbox-destroy.sh`

El watchdog quita su propio job de launchd cuando dispara. Si la corrida termina con normalidad,
se detiene con `launchctl remove co.scuby.watchdog`.

## Guardias

- `infra/scripts/sso-remaining.sh`: imprime los minutos que le quedan a la sesión SSO (0 si no hay
  sesión). Se exige un mínimo antes de aplicar.
- `infra/scripts/sandbox-watchdog.sh <deadline>`: al llegar el deadline destruye el sandbox por su
  cuenta, salvo que el estado de Terraform esté vacío. Es la red de seguridad si la corrida se corta.

`infra/scripts/sweep.sh` lista lo que quede con la etiqueta `Project=scuby` después de destruir.

## No tocar

La cuenta del sandbox tiene recursos que **no son de Scuby** y que nada de aquí puede crear,
modificar ni borrar: la **VPC por defecto** (`vpc-9d15b4e0`) y el bucket **`wc2026-tfstate-itslauyalejo`**.
Solo se borra lo que lleva `Project=scuby` o lo que creó este estado de Terraform.
