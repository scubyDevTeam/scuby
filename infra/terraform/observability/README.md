# infra/terraform/observability — dashboard y alertas de New Relic

Terraform (proveedor `newrelic`) para la cuenta 8675334 (US). Dónde vive el estado y qué
ambientes alertan: [`docs/eng/infra.md`](../../../docs/eng/infra.md) · Observability as code.

## Qué administra (10 recursos)

- **Dashboard «Scuby — Backend»**, visible para todos los usuarios de la cuenta: https://one.newrelic.com/redirect/entity/ODY3NTMzNHxWSVp8REFTSEJPQVJEfGRhOjEzNDEzNzgw.
  Tiene una variable `env` (por defecto staging y prod; `local` se puede seleccionar). En los logs,
  el nivel es `severity.text` y el logger `otel.library.name`; las latencias van en ms.
- **Política** `scuby-backend` con cinco condiciones:
  - `server_errors`: más de 5 respuestas 5xx en 5 minutos, por ambiente.
  - `latency_p95`: p95 mayor a 1000 ms durante 10 minutos, sin los health checks de `/actuator`, por ambiente.
  - `no_data`: el backend no manda datos. Apagada hasta que staging corra continuamente.
  - `monthly_ingest_50` y `monthly_ingest_80`: ingesta del mes por encima de 50 y de 80 GB. Son dos
    condiciones críticas separadas porque un umbral de advertencia no abre incidente en New Relic y
    nunca enviaría correo.
- **Destino, canal y workflow** de correo hacia scubydev@gmail.com.

Una vez la ingesta pasa de 50 GB (o de 80), esa condición vuelve a enviar correo cerca de una vez al
día hasta fin de mes: New Relic cierra los incidentes a las 24 h y se reabren.

## Aplicar

```bash
bash infra/terraform/observability/apply.sh            # fmt, init, validate, plan y apply
bash infra/terraform/observability/apply.sh -var no_data_alert_enabled=true   # cuando staging corra continuamente
```

La User API key (`NRAK-…`) sale del Keychain (ítem `scuby-newrelic-user-api-key`) al entorno del
proceso; nunca se escribe en un archivo. Chequeo sin red ni llave real:

```bash
cd infra/terraform/observability && NEW_RELIC_API_KEY=dummy terraform validate
```

## Si se pierde el estado local

El estado (`terraform.tfstate`) está fuera de git. Si se pierde, un `apply` crearía duplicados.
Opciones: `terraform import` de cada recurso por su ID o GUID (dashboard por GUID; política,
condiciones, destino, canal y workflow por ID, que se ven en la UI de New Relic), o borrar los
duplicados en la UI después de aplicar.
