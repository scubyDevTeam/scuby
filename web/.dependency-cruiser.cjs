// The layer rule from docs/eng/frontend.md · Architecture. Dependencies point inward, always.
const layer = (name) => `^src/${name}/`
const OUTER = [
  'routes',
  'features',
  'api-client',
  'contracts',
  'domain',
  'platform',
  'ui',
  'i18n',
  'mocks',
]
const others = (...allowed) => OUTER.filter((l) => !allowed.includes(l)).map((l) => layer(l))

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-imports-nothing',
      comment: 'Rule 1: domain is plain TypeScript over plain data — no packages, no other layer.',
      severity: 'error',
      from: { path: layer('domain') },
      to: { pathNot: layer('domain') },
    },
    {
      name: 'contracts-only-zod',
      severity: 'error',
      from: { path: layer('contracts') },
      to: { pathNot: [layer('contracts'), 'node_modules/zod'] },
    },
    {
      name: 'api-client-inward-only',
      severity: 'error',
      from: { path: layer('api-client') },
      to: { path: others('api-client', 'contracts') },
    },
    {
      name: 'platform-is-a-leaf',
      severity: 'error',
      from: { path: layer('platform') },
      to: { path: others('platform') },
    },
    {
      name: 'ui-is-a-leaf',
      comment:
        'ui gets everything through props — it knows no rule, no API and no brand. Its own few words (Cerrar, opcional) come from i18n.',
      severity: 'error',
      from: { path: layer('ui') },
      to: { path: [...others('ui', 'i18n'), '^src/(env|brand)\\.ts$'] },
    },
    {
      name: 'i18n-is-a-leaf',
      comment:
        'The language files and t(). Every layer that renders reads from it; it reads nothing.',
      severity: 'error',
      from: { path: layer('i18n') },
      to: { path: [...others('i18n'), '^src/(env|brand)\\.ts$'] },
    },
    {
      name: 'features-not-routes',
      severity: 'error',
      from: { path: layer('features') },
      to: { path: [layer('routes'), layer('mocks')] },
    },
    {
      name: 'mocks-stay-out-of-the-app',
      comment: 'Only the entry point starts MSW.',
      severity: 'error',
      from: { path: '^src/', pathNot: [layer('mocks'), '^src/main\\.tsx$'] },
      to: { path: layer('mocks') },
    },
    {
      name: 'map-library-only-in-ui-map',
      comment: 'Rule 5: MapLibre lives behind src/ui/Map and a lazy boundary.',
      severity: 'error',
      from: { pathNot: '^src/ui/Map/' },
      to: { path: 'node_modules/(maplibre-gl|pmtiles)' },
    },
    {
      name: 'env-has-one-reader',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '^src/(brand|main)\\.tsx?$|^src/(api-client|platform|features|routes|mocks)/',
      },
      to: { path: '^src/env\\.ts$' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.test\\.tsx?$|routeTree\\.gen\\.ts$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
  },
}
