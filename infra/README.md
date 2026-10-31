# infra/ — Infraestructura de Scuby

Contiene la imagen de Postgres, el Terraform, las Lambdas de fotos y los scripts para correr el
**sandbox**. Qué es el sandbox y por qué existe: [`../docs/eng/infra.md`](../docs/eng/infra.md) ·
Environments ("Sandbox"). Las demás decisiones: ese mismo documento y
[`../docs/eng/media-pipeline.md`](../docs/eng/media-pipeline.md).

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
└── scripts/             sandbox-build / deploy / smoke / destroy, más las salvaguardas (abajo)
```

## Requisitos

- **Terraform ≥ 1.15** (`versions.tf`).
- **AWS CLI v2** con SSO.
- **Node ≥ 22** (las Lambdas corren en `nodejs22.x`).
- **Docker**.
- Nada más: `sandbox-build.sh` construye el backend con `backend/build.sh`, que corre Maven en un contenedor (solo hace falta Docker; el script necesita un checkout de git).

## Correr el sandbox

**Dónde clonar.** El watchdog corre bajo launchd, y macOS (TCC) no deja que un proceso de launchd
lea `~/Desktop`, `~/Documents` ni `~/Downloads`. El sandbox se corre desde un clon o worktree fuera
de esas carpetas (p. ej. `~/scuby-b1-run`), y el estado de Terraform vive en ese clon. Todos los
comandos de abajo, desde la raíz de ese clon.

Los scripts guardan sus archivos de trabajo (`sso-login`, `watchdog.log`, `watchdog.fired`) en
`${SCUBY_SANDBOX_DIR:-$HOME/.scuby-sandbox}`; los ejemplos de abajo lo llaman `SCRATCH`. Es una
carpeta bajo `$HOME` (no en Desktop, Documents ni Downloads) para que launchd pueda leerla. El
perfil `itslauyalejo-sso` y la región `us-east-1` están fijos, igual que en el provider de
Terraform: el sandbox vive en una sola cuenta, y el sweep comprueba recursos ajenos de esa cuenta.

```bash
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
SCRATCH="${SCUBY_SANDBOX_DIR:-$HOME/.scuby-sandbox}"
mkdir -p "$SCRATCH"
```

Los comandos largos (apply, deploy, smoke, destroy) corren en segundo plano con `nohup`, cada uno
con su `.log` y su `.exit`: si se interrumpe la espera de CloudFront, quedan recursos fuera del
estado de Terraform. Por ejemplo:

```bash
nohup bash infra/scripts/sandbox-deploy.sh > "$SCRATCH/deploy.log" 2>&1; echo $? > "$SCRATCH/deploy.exit"
```

Orden:

1. `aws sso login --profile itslauyalejo-sso && date -u +%s > "$SCRATCH/sso-login"`
   (`sso-remaining.sh` cuenta desde ese archivo; sin él imprime 0).
2. `infra/lambda/media/build.sh` (y `infra/scripts/sandbox-build.sh` para las imágenes)
3. **Arrancar el watchdog antes del apply.** Mínimo **150 min** de SSO restantes antes del apply
   (`bash infra/scripts/sso-remaining.sh`); el deadline queda 45 min antes de que expire la sesión:

   ```bash
   left=$(bash infra/scripts/sso-remaining.sh); deadline=$(( $(date -u +%s) + (left - 45) * 60 ))
   launchctl remove co.scuby.watchdog 2>/dev/null || true
   launchctl submit -l co.scuby.watchdog -o "$SCRATCH/watchdog.log" -e "$SCRATCH/watchdog.log" -- /usr/bin/caffeinate -dims /bin/bash "$PWD/infra/scripts/sandbox-watchdog.sh" "$deadline"
   ```

   No se aplica sin watchdog vivo: `launchctl list | grep co.scuby.watchdog` debe mostrar un PID,
   y `$SCRATCH/watchdog.log` debe mostrar las rutas de `terraform` y `aws` (no `MISSING`).
4. `nohup terraform -chdir=infra/terraform/envs/sandbox apply -auto-approve -input=false > "$SCRATCH/apply.log" 2>&1; echo $? > "$SCRATCH/apply.exit"`
5. `bash infra/scripts/sandbox-deploy.sh`, en segundo plano como el ejemplo de arriba. Además de la
   contraseña de la base, el script crea (si falta) el parámetro SSM `/scuby/sandbox/auth/code-hash-key`
   y pasa al backend los ajustes que exige el perfil `staging` (origen, ID de Google de relleno,
   bucket y URL de imágenes; lista en [`staging-rollout.md`](../docs/eng/staging-rollout.md)). Mientras
   `auth/code-hash-key` no esté en `secret_names` de `envs/sandbox/main.tf`, el parámetro sobrevive a
   `sandbox-destroy.sh` y el sweep lo reporta: bórralo con `aws ssm delete-parameter`.
6. Mínimo **90 min** de SSO restantes (`sso-remaining.sh`); si no, saltar al destroy.
   Luego `bash infra/scripts/sandbox-smoke.sh`, en segundo plano.
7. **Siempre, al final:** `bash infra/scripts/sandbox-destroy.sh`, en segundo plano, aunque el
   apply, el deploy o el smoke hayan fallado. Justo después del destroy, el sweep puede listar la
   instancia terminada, sus volúmenes o reglas de security group ya borrados: la API de etiquetas
   tarda en enterarse. Esperar unos minutos y volver a correr `bash infra/scripts/sweep.sh`.

El watchdog quita su propio job de launchd cuando dispara. Si la corrida termina con normalidad,
se detiene con `launchctl remove co.scuby.watchdog`.

## Salvaguardas

- `infra/scripts/sso-remaining.sh`: imprime los minutos que le quedan a la sesión SSO (0 si no hay
  sesión). Se exige un mínimo antes de aplicar.
- `infra/scripts/sandbox-watchdog.sh <deadline>`: al llegar el deadline destruye el sandbox por su
  cuenta, salvo que el estado de Terraform esté vacío. Es la red de seguridad si la corrida se corta.

`infra/scripts/sweep.sh` comprueba, después de destruir, que no quede nada de Scuby (por etiqueta
`Project=scuby` y por prefijo de nombre `scuby…`, `/scuby/` o `/aws/lambda/scuby-`) y que los
recursos ajenos (la VPC por defecto y el bucket) sigan ahí. La API de etiquetas sigue listando por
una hora o más instancias terminadas y volúmenes o reglas de security group ya borrados: el sweep
los confirma contra la API de EC2 y los imprime como `ghost (tagging index lag, verified gone)`
sin contarlos como sobras; cualquier otro tipo de recurso o error cuenta como sobra. Imprime `sweep: clean` y sale con 0 si todo está bien; sale con 1 si queda
algo o si una comprobación falla, y con 2 si las credenciales no sirven.

## No tocar

La cuenta del sandbox tiene recursos que **no son de Scuby** y que nada de aquí puede crear,
modificar ni borrar: la **VPC por defecto** (`vpc-9d15b4e0`) y el bucket **`wc2026-tfstate-itslauyalejo`**.
Solo se borra lo que lleva `Project=scuby` o lo que creó este estado de Terraform.
