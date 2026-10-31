# Place names spike — reverse geocoding for Colombian points

> 2026-10-30 (measured 2026-10-31). Input to turning on the `reverse_geocoding` flag ([feature-flags.md · Registry](../../eng/feature-flags.md)).
> The backend stores one place name per case at publish (`PlaceNamer`); previews and posters show
> the barrio ([10-sharing.md](../../product/10-sharing.md)). No provider is wired yet.

## Question
Which source names the barrio of a point best, at what cost and with what licence/attribution duty?

## Method
15 fixed points across Colombia, one request each per public service (15 requests per service, at least 1.1 s apart, User-Agent `scuby-place-names-spike/2026-10-30 (+https://github.com/scubyDevTeam/scuby)`, no retries). Python standard library only.
- Nominatim: `GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=es`.
- OSM polygons: Overpass `is_in(lat,lng)` filtered to named `boundary=administrative|place` areas.
- Official layer: Medellín cadastral barrio/vereda polygons loaded into a throwaway PostGIS container and queried with `ST_Covers` (nearest polygon reported when none covers the point). Only Medellín was attempted; no Bogotá layer was searched for or downloaded.
- Amazon Location: price only; no AWS call of any kind was made.

"Expected" is filled only where the official Medellín layer settles it; elsewhere it is blank because no official map was checked.

## Points and answers
Nominatim shows `address.neighbourhood` (barrio) / `address.suburb` (comuna or localidad) / city or town.

| # | Point | Expected | Nominatim | OSM polygons (Overpass) | Official layer (PostGIS) | Amazon Location |
|---|---|---|---|---|---|---|
| 1 | Laureles (Medellín) 6.2447,-75.5916 | Bolivariana (comuna Laureles) | Bolivariana / Comuna 11 - Laureles-Estadio | not measured — all 15 requests failed (TLS handshake) | Bolivariana (LAURELES) | not measured — no AWS calls in this spike (machine credentials may belong to another account) |
| 2 | Belén edge 6.2310,-75.5990 | La Palma (comuna Belén) | La Palma / Comuna 16 - Belén | not measured — same | La Palma (BELEN) | same |
| 3 | El Poblado, Lleras 6.2087,-75.5677 | El Poblado | El Poblado / Comuna 14 - El Poblado | not measured — same | El Poblado (EL POBLADO) | same |
| 4 | Envigado center 6.1716,-75.5862 | | San Mateo / town Envigado | not measured — same | — (Envigado is outside Medellín; nearest Medellín polygon 1528 m, irrelevant) | same |
| 5 | Bello center 6.3373,-75.5579 | | Centro / Bello | not measured — same | — (outside Medellín; nearest 2768 m) | same |
| 6 | Chapinero (Bogotá) 4.6486,-74.0628 | | Chapinero (barrio) / Localidad Chapinero | not measured — same | not measured — no Bogotá layer obtained | same |
| 7 | Usaquén (Bogotá) 4.6946,-74.0307 | | Usaquén / Localidad Usaquén | not measured — same | not measured — no Bogotá layer obtained | same |
| 8 | Kennedy (Bogotá) 4.6283,-74.1532 | | Ciudad Kennedy Norte / Localidad Kennedy | not measured — same | not measured — no Bogotá layer obtained | same |
| 9 | San Antonio (Cali) 3.4475,-76.5390 | | San Antonio / Comuna 3 | not measured — same | not measured — no Cali layer obtained | same |
| 10 | El Prado (Barranquilla) 10.9990,-74.8040 | | Barrio América / Localidad Norte - Centro Histórico (not "El Prado") | not measured — same | not measured — no Barranquilla layer obtained | same |
| 11 | Getsemaní (Cartagena) 10.4221,-75.5465 | | Getsemaní (neighbourhood and suburb) | not measured — same | not measured — no Cartagena layer obtained | same |
| 12 | Jardín (Antioquia) 5.5986,-75.8197 | | — (town Jardín only) | not measured — same | not measured — not attempted | same |
| 13 | Villa de Leyva 5.6333,-73.5254 | | — (town Villa de Leyva only) | not measured — same | not measured — not attempted | same |
| 14 | Rural near Guarne 6.2800,-75.4400 | vereda, not barrio | — (town Guarne only; no vereda) | not measured — same | — (outside Medellín; nearest 5128 m) | same |
| 15 | Highway Medellín–Santa Fe 6.4500,-75.7500 | nothing | Loma Hermosa (as `city_district`) / San Jerónimo | not measured — same | — (nearest 9567 m) | same |

## Per source

### Nominatim (public instance)
- **Coverage:** 15/15 requests succeeded. A `neighbourhood` came back for 11 of 15 points (1-11); the 4 non-urban points returned only the municipality, except point 15 which returned a sub-municipal name (Loma Hermosa, as `city_district`). **Verified:** points 1-3 agree with the official Medellín layer exactly (3 of 15, one city). **Not verified against any official map:** points 4, 5, 8, 9, 11 returned a plausible barrio. **Returns the localidad, not a finer unit:** points 6 and 7 (Bogotá), where `neighbourhood` equals the localidad name ("Chapinero", "Usaquén"). **Different from expected:** point 10 returned "Barrio América" for a point labelled El Prado; no official Barranquilla layer was checked, so which is right is unknown. No barrio: points 12-14 (municipality only) and 15 (misleading sub-municipal name only).
- **Where the barrio lives:** `address.neighbourhood` in every city tested; the comuna/localidad is in `suburb` (Medellín, Bogotá) or `city_district` (Cali, Barranquilla). In Bogotá, `neighbourhood` for Chapinero and Usaquén is the same string as the localidad, so it can be a barrio or a locality name; do not assume it is a finer unit. Cartagena fills both `neighbourhood` and `suburb` with Getsemaní. `city` is sometimes a synthetic label ("Perímetro Urbano Medellín", "Bogotá ciudad", "Cali ciudad"), so a municipality name should come from `town`/`city`/`county` with cleaning.
- **Failure modes:** no vereda for rural points (point 14 returns only the municipality); a nearby sub-municipal name on a highway (point 15) that would be misleading if shown as a barrio; "wrong side of boundary" not measured beyond point 2, which matched the official layer.
- **Latency:** 463–829 ms per request (all 15). These figures were printed by the spike script and not saved with the raw JSON, so no artifact backs them; treat them as indicative.
- **Cost:** the public instance is free, so cost is $0 at 1,000 and at 10,000 publishes/month. It has no SLA. Usage policy (https://operations.osmfoundation.org/policies/nominatim/, read 2026-10-31) requires:
  - an absolute maximum of 1 request per second, and a valid identifying User-Agent or Referer;
  - results "must be cached on your side" — met by the design: the name is computed once at publish and stored on the case;
  - clear attribution suitable for the medium;
  - the ability to switch the service off "at our request at any time" — met by the `reverse_geocoding` flag, which falls back to the generic label;
  - end-user-triggered use is acceptable "provided that your number of users is moderate"; commercial applications are warned to keep in mind that access might be withdrawn; periodic requests count as bulk and are "strongly discouraged", and systematic queries such as reverse queries in a grid are forbidden.
  - **Volume against the limit:** one call per published case (plus a small number for location edits, which recompute the name). 10,000 publishes/month is about 330/day, one request every 4-5 minutes on average, orders of magnitude below 1 request/second.
  - **One shared throttle:** the limit is per client, so the backend must route every call through one process-wide throttle (one request in flight, at most 1/s) across all instances.
  - **No backfill burst:** turning the flag on must not trigger reverse lookups for existing cases in a burst. Any backfill must run single-threaded at no more than 1 request/second and must never sweep a grid of points.
  The policy does not require self-hosting; it reserves the right to withdraw access, so relying on it for a launch feature is a dependency risk, not a violation.
- **Licence / attribution:** results are OSM data, ODbL; "© OpenStreetMap contributors" attribution required wherever the name is displayed. Storing results is allowed under the ODbL, subject to attribution and share-alike on derived databases. Attribution has to land on the `og:image` and poster layouts owned by [10-sharing.md](../../product/10-sharing.md); whether a single place name needs the line on the image itself, or only on the page, is not decided here.
- **Operational cost:** an HTTP call at publish time, a dependency on a third-party service with no SLA, a mandatory User-Agent. Nothing to refresh. The call takes 0.5-0.8 s on the `POST /lost-cases` path, so it needs a short timeout, and a timeout or failure must fall back to the generic label so publish is never blocked (alternative: compute the name after commit).

### OSM polygons via Overpass
- **Not measured — all 15 requests failed with `SSL: SSLV3_ALERT_HANDSHAKE_FAILURE`** from the local Python (`python3 -I`, standard-library `urllib`) to `overpass-api.de`, in 362–464 ms each, before any HTTP exchange. Per the spike's no-retry rule the requests were recorded as failures and not repeated with another client. The failure appears specific to this host and TLS stack, since the same client reached nominatim.openstreetmap.org. Re-running with a different TLS stack (or another Overpass mirror) is a cheap follow-up.
- Because Nominatim's `suburb`/`neighbourhood` fields derive from the same OSM boundaries, point-by-point polygon answers are expected to look similar for points 1-11, but this is an inference, not a measurement.
- **Licence:** ODbL, attribution "© OpenStreetMap contributors". **Operational cost (if loaded into PostGIS):** a planet/Colombia extract to import and refresh, a polygon table, and no per-call cost or rate limit.

### Official city barrio layers
- **Medellín: obtained.** Dataset "Límite Barrio Vereda" (cadastral barrios and veredas, with comuna name and urban/rural flag `indicador_ur`), published by the Alcaldía de Medellín through its GeoMedellín ArcGIS REST service: `https://www.medellin.gov.co/servidormapas/rest/services/vivienda_ciudad_terri/VA_Plantilla/MapServer/14` (349 polygons, WGS84). Downloaded 2026-10-31 as Esri JSON through `/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=json` and loaded into PostGIS (`ST_BuildArea` over the returned rings). A same-named layer at `.../ServiciosCatastro/ConsultaOperadorCatastral/MapServer/3` returns the attributes but no geometry (null), so use the first URL. Not found: the open-data hub dataset page (`geomedellin-m-medellin.opendata.arcgis.com/...` returned 404; a third-party mirror lists "last update 5 April 2023"). **Licence: not determined** — the Alcaldía states GeoMedellín downloads are free for personal, research or business use, but no licence text or attribution requirement was found; confirm before storing or redistributing.
- **Coverage:** points 1-3 (the three inside Medellín's urban perimeter) are named correctly and agree with Nominatim. Points 4 and 5 are in Envigado and Bello, outside the layer: no polygon covers them (nearest 1.5 km and 2.8 km). Rural point 14 and highway point 15 are outside the layer too. Within Medellín the layer also names veredas in the rural corregimientos (e.g. "Suburbano Potrera Miserenga", comuna PALMITAS); no test point fell in one. One layer per city is therefore needed: each of the metro municipalities, Bogotá, Cali, and so on is a separate publisher, format and licence. No official layer may be stored or redistributed until its licence is confirmed with the Alcaldía; that check blocks adding it as a provider.
- **Bogotá, Cali, Barranquilla, Cartagena, Jardín, Villa de Leyva: not measured — dataset not obtained.** Only the Medellín portal was searched; no other portal was attempted in the time boxed for this spike.
- **Latency/cost:** a local PostGIS point-in-polygon query is milliseconds and has no per-call cost. **Operational cost:** each city's dataset to find, convert, load, re-download when it changes, and a licence to read per city.

### Amazon Location Service
- **Not measured — no AWS calls in this spike (machine credentials may belong to another account).** If the team wants it measured later, do it by hand with `AWS_PROFILE` set to the project's own profile, after `aws sts get-caller-identity` shows the project's account.
- **Price:** the exact "Stored" price per 1,000 ReverseGeocode requests could not be read. The public pricing page (`https://aws.amazon.com/location/pricing/`, read 2026-10-31) defers the rates to the Places pricing page and shows no dollar figure for geocoding in the text retrieved. The Places pricing developer guide (`https://docs.aws.amazon.com/location/latest/developerguide/places-pricing.html`, read 2026-10-31) confirms four buckets (Label, Core, Advanced, Stored) and that results may only be stored indefinitely with `intendedUse = Stored`, billed at the Stored price, which is the cap for any Places call. Core results cannot be stored permanently. The figure used here is the [thin-slice design](2026-10-29-backend-thin-slice-design.md)'s (Place names row) **≈ $4 per 1,000 stored results, not re-checked**. The free tier on the pricing page is 20,000 Core requests per month for the first 3 months of a new account (it applies to Core, not Stored).
- **Cost at that figure:** 1,000 publishes/month ≈ $4; 10,000 publishes/month ≈ $40. For scale, [costs.md](../../eng/costs.md) puts the whole 10,000-users scenario at about $50-100/month, so $40 would be most of that budget.
- **Licence:** Amazon's terms for storing results are the `intendedUse = Stored` requirement above; no OSM attribution duty comes with AWS-sourced names, but the data is provider-licensed.
- **Operational cost:** an API call with AWS credentials at publish, a pricing tier choice the code must get right (using the cheaper Core tier and persisting the name would violate the terms).

## Recommendation
Wire Nominatim first behind the `reverse_geocoding` flag, through a thin `PlaceNamer` seam so the source can be replaced. **Confidence is moderate:** it rests on one source, with 3 of 15 points verified against an official layer (all in Medellín); 7 more are plausible but unverified (points 4, 5, 8, 9, 11, plus 6 and 7 which return the localidad), 1 differs from expected (point 10), and 4 have no barrio (12-15). Overpass was not measured, no official layer outside Medellín was checked, and Amazon's price was not re-checked. That is enough for "wire first behind a flag", not for claiming barrio accuracy.

Field rule (applied to the 15 rows above; "municipality" = `town`, else `city`, else `county`, after dropping synthetic labels such as "Perímetro Urbano X" and "X ciudad"):

| Case | Result |
|---|---|
| `address.neighbourhood` present and not equal (case-insensitive) to the municipality | That `neighbourhood` is the name. `suburb`, `city_district` and `town` are never used as the name and do not gate it. |
| `neighbourhood` missing, or equal to the municipality | Generic label «Zona marcada en el mapa» (stored `null`), as the registry in [feature-flags.md](../../eng/feature-flags.md) defines it. |

Output per point: 1 Bolivariana, 2 La Palma, 3 El Poblado, 4 San Mateo, 5 Centro, 6 Chapinero (a localidad), 7 Usaquén (a localidad), 8 Ciudad Kennedy Norte, 9 San Antonio, 10 Barrio América (questionable), 11 Getsemaní, 12-14 generic label, 15 generic label (Loma Hermosa is ignored because it is a `city_district`). Point 5 keeps "Centro" even though it is ambiguous without the municipality; showing the municipality next to it is a layout question for [10-sharing.md](../../product/10-sharing.md), not part of this rule.

**Proposal that conflicts with the current registry (not part of the rule):** falling back to the municipality name instead of the generic label would change what posters show, and the registry currently says «Zona marcada en el mapa». It would need a product decision and an edit to the registry before use.

Limits: public-instance policy (1 request/second via one shared throttle, no SLA, no backfill burst, switch-off on request), ODbL attribution wherever shown, and unverified accuracy outside Medellín. For Medellín specifically, the official GeoMedellín layer is the more authoritative option (it matched Nominatim on all three urban points and names veredas), but it covers one city and its licence is unconfirmed, so treat it as a later per-city refinement, not the first provider. What would change the decision: public Nominatim becoming unreliable or disallowed at launch volume (then self-host Nominatim or use a paid host), a licence check clearing the official layers (then add them city by city for accuracy), the OSM polygon option measuring better once Overpass is re-run from a working TLS stack, or Amazon Location's Stored price (about $4 per 1,000 per the design, to be confirmed) being acceptable for a vendor-backed SLA. The team decides; record it in the decision log when made.

## Raw data
- Nominatim: 15 JSON answers fetched 2026-10-31 from `https://nominatim.openstreetmap.org/reverse` (parameters above).
- Overpass: 15 failed attempts to `https://overpass-api.de/api/interpreter` on 2026-10-31 (`SSL: SSLV3_ALERT_HANDSHAKE_FAILURE`); no data.
- Medellín: "Límite Barrio Vereda" polygons from `https://www.medellin.gov.co/servidormapas/rest/services/vivienda_ciudad_terri/VA_Plantilla/MapServer/14`, downloaded 2026-10-31; licence undetermined.
- Amazon Location: pages listed above, read 2026-10-31; no AWS call.
- Raw files are not committed.
