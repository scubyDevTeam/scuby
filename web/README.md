# web/ — el cliente de Scuby

Cliente web (y PWA) de Scuby, la plataforma para mascotas perdidas, encontradas, en adopción y con
pedidos de ayuda. Es el **alcance 1** del front; la app para tiendas (Capacitor) viene después.

## Contexto del proyecto

- **Qué es.** Un tablón de avisos gratuito que conecta a quien necesita ayuda con una mascota con
  las personas cercanas que pueden dársela. Arranca por traer mascotas perdidas a casa. Colombia
  primero, nunca solo Colombia (los datos por país van en configuración).
- **Cuatro verticales.** Perdido, Encontrado, Adopción y Ayuda. Cada una tiene su flujo, su
  máquina de estados y su seguimiento (check-ins) documentados.
- **Principios que se notan en el código.** Sin dinero en la plataforma (la ayuda es en especie);
  ayudar no exige cuenta (avistamientos y «La tengo» son anónimos), publicar sí; el teléfono se
  verifica al publicar; la ubicación pública nunca es exacta; solo quien publicó cierra su caso.
- **Equipo y ritmo.** Dos ingenieros, 10–15 h/semana: cada decisión respeta ese presupuesto.
- **El backend aún no existe.** El cliente se desarrolló contra un backend emulado en el navegador
  (MSW). El contrato de la API vive en el propio cliente y de él sale `docs/eng/openapi.json`, que
  es lo que el backend real debe implementar.

## Dónde está la verdad

| | |
|---|---|
| `../docs/product/` | Producto: mapa y **registro de decisiones** (`00`), las cuatro verticales (`04–07`), notificaciones, reportes, compartir (`08–10`) |
| `../docs/eng/` | Ingeniería: `frontend.md` (arquitectura), `frontend-plan.md` (plan), `api.md` (contrato), `auth.md`, `comms.md`, `costs.md` |
| `../docs/open-items.md` | Decisiones abiertas y diferidas. Lo diferido **no** se construye |
| `design/` | Referencia visual (`reference/` versionada; `screens/` local, ver su README) |

Si el código y la documentación se contradicen, gana la documentación.

## Cómo correrlo

Requiere Node 24 (`.nvm` / `.nvmrc`) y pnpm.

```bash
pnpm install
pnpm dev          # con VITE_API_MOCK=true (por defecto) MSW responde la API; el código de acceso es 123456
```

| Comando | Qué hace |
|---|---|
| `pnpm check` | Todo lo que corre el CI: lint, tipos, pruebas, regla de capas, marca, textos, tags e2e, build, e2e y Lighthouse |
| `pnpm test` / `pnpm test:watch` | Pruebas unitarias (Vitest + Testing Library) |
| `pnpm e2e` | Flujos felices con Playwright (`--grep @chat` para uno; `--grep @CHAT-001` para una prueba) |
| `pnpm openapi` | Regenera `../docs/eng/openapi.json` tras cambiar el contrato |
| `pnpm format` | Biome, arreglando lo que pueda |

Las variables de entorno están todas en `.env` con valores de mentira; un valor vacío o que empieza
por `mock-` significa «no configurado» y esa función queda apagada. Solo `src/env.ts` las lee.

## Estructura

Arquitectura limpia: las dependencias apuntan hacia adentro. La regla está en
`.dependency-cruiser.cjs` y `pnpm depcruise` falla si se rompe.

```
src/
├── domain/        Reglas puras (máquinas de estado, validaciones, reglas de publicación). No importa nada.
│   ├── lost/ found/ adoption/ help/   una carpeta por vertical, con sus pruebas
│   ├── chat/                          qué es un mensaje y cómo se lee un hilo
│   └── shared/                        geo, tiempo, teléfono, imagen, alertas, perfil
├── contracts/     LA API: cada endpoint (endpoints/*.ts), esquemas del cable (zod/mini) y los tipos de la app.
├── api-client/    Pasarela al backend: fetch tipado, errores, consultas (TanStack Query) y la cola de «Lo vi».
├── platform/      Pasarelas al dispositivo: compartir, ubicación, cámara/imagen, push, almacenamiento, red.
├── ui/            Primitivas visuales (Button, Field, Sheet, Map/…). No saben de reglas, API ni marca.
├── i18n/          Un JSON por idioma (locales/es.json, en.json), t(), el proveedor y los namespaces diferidos.
├── features/      Casos de uso y sus pantallas, una carpeta por área:
│   adoption/ found/ help/ lost/   cada vertical (página, formularios, panel de quien publicó)
│   case/ feed/ mine/ inbox/        el caso compartido, el inicio, «Mis casos», la Bandeja
│   chat/ edit/ links/              chat dentro de la app, editar avisos, enlaces de un toque del correo
│   publish/ poster/ reporting/ auth/ legal/
├── routes/        Composición: URL → feature (TanStack Router, rutas por archivo bajo {-$locale}/).
├── mocks/         El backend emulado: tablas, fixtures, serialización por espectador, handlers y escenarios.
└── service-worker/  Caché del shell y Web Push.
api/               Función serverless que sirve la vista previa de enlaces compartidos (`/c/:code`).
e2e/               Playwright: pages/ (page objects), tags.ts (flujos y claves) y un spec por flujo.
scripts/           Chequeos (marca, textos, tags e2e) y build de la función de compartir.
```

| Capa | Puede importar |
|---|---|
| `domain` | nada |
| `contracts` | zod |
| `api-client` | `contracts` |
| `ui` | react, `i18n` |
| `features` | todo lo anterior |
| `routes` | todo |
| `mocks` | `contracts` |

## Cómo se construye una funcionalidad

1. **Regla** en `domain/` (con prueba que cita la sección del doc).
2. **Contrato**: el endpoint en `contracts/endpoints/` y sus esquemas; luego `pnpm openapi`.
3. **Backend emulado**: handler en `mocks/api/` con `route(api.x, …)` (valida petición y respuesta
   contra el contrato) y un escenario en `mocks/backend.test.ts` — esa es la especificación que el
   backend real debe reproducir.
4. **Cliente**: `api-client/` llama con `call(api.x, …)`, nunca con rutas escritas a mano.
5. **Pantalla** en `features/` (con estados de carga, vacío y error), cableada en `routes/`.
6. **Textos** como claves en `es.json` y `en.json` (nunca escritos en una pantalla; `pnpm check:copy` lo vigila).
7. **Pruebas**: unitarias junto al código y **un flujo feliz e2e** con page object y tag propio.

## Convenciones que conviene saber

- **Todo texto sale de `locales/<idioma>.json`**, con claves en inglés `snake_case`. El idioma es el
  primer segmento opcional de la URL (`/en/c/7K3PQ`; el español no lleva).
- **El nombre del producto es configuración** (`src/brand.ts`), nunca se escribe a mano.
- **Palabras diferidas.** Lo que solo usa un formulario o una pantalla va en un namespace diferido
  (`src/i18n/namespaces.ts`) y se descarga con ella; la primera carga de un caso lleva solo lo suyo.
- **Sin flags en el cliente**: si un flag cambia una pantalla, lo dice la respuesta de la API.
- **El cliente aconseja, el servidor decide.** `domain` dice qué ofrecer; nunca hace cumplir.
- **Commits** con prefijo `feat:`, `test:`, `doc:` o `ci:`, un tipo de cambio por commit.
- **Cursor de mano** en toda acción, y logo de la marca en la cabecera y la pestaña.

Más detalle de arquitectura, riesgos y presupuestos: `../docs/eng/frontend.md`. Guía corta para
agentes y colaboradores: `CLAUDE.md`.
