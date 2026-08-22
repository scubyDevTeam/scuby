# Media — The Image Pipeline

> Cross-vertical. Every photo in the product — pet, sighting, claim proof, help evidence — goes
> through one pipeline. This doc defines what it must do; the stack decision (build vs. service)
> is an open item, and everything here holds either way.

## The organizing insight

Images are the heaviest thing the product moves, on prepaid data plans and low-end phones. They
feed three consumers with different needs — cards, previews and posters, matching — and they carry
the one privacy leak nobody thinks about: **a phone photo has the GPS coordinates of where it was
taken in its EXIF.** A picture of the dog on the sofa is the owner's home to the meter, worse than
any map pin we floored at 200 m. So the pipeline has two jobs that never trade off against each
other: make images small, and make them safe.

---

## 1. Upload

**Client first, server always.** The device does the heavy lifting because it has the bandwidth
problem; the server repeats the safety steps because not every client is ours.

### On the device
| Step | Rule |
|---|---|
| Downscale | Canvas re-encode to **≤ 1600 px long edge**, JPEG quality ~0.82. A 12 MP photo (4–6 MB) becomes ~300 KB. On a prepaid plan this is the difference between a sighting being sent and abandoned |
| EXIF | Dropped as a side effect of canvas re-encoding — no GPS, no device model, no timestamp leaves the phone |
| HEIC | iPhone default; decoded on the device before re-encode. If the browser can't, the server converts |
| Orientation | Applied from EXIF *before* stripping it, so portraits don't arrive sideways |
| Feedback | Progress per photo; a failed upload keeps the local preview and retries — the form never loses a photo the user already picked |

### On the server
| Step | Rule |
|---|---|
| EXIF | Stripped again, unconditionally |
| Validate | Real image (magic bytes, not extension); reject > 10 MB pre-resize; reject dimensions > 8000 px |
| Re-encode | Master stored as JPEG ≤ 1600 px, sRGB — one canonical format regardless of what arrived |
| Limits | Per pet 6 · per sighting 3 · per claim proof 5 · per help evidence 5 |
| Auth | **Short-lived signed upload URLs**, scoped to the row being created (case, sighting, claim). Never a public bucket write. Anonymous uploads (sightings, claims) inherit the rate limits of the row they belong to — an upload without a row is rejected |

### Malicious content
No automated NSFW/abuse scanning in v1 — volume doesn't justify it. The report button and the
moderation queue are the safety net; a removed row's images go with it.

---

## 2. Storage

**One master per photo.** The downscaled upload is the only stored original; nothing larger ever
exists on our side. Key by content hash, so a re-upload of the same photo is a no-op and the URL is
immutable by construction.

```
media/{content_hash}.jpg              the master
```

The row (`pet.photos[]`, `sighting.photos[]`, …) references the hash. Deleting a row's photos is
deleting references; the blob goes when its last reference does.

---

## 3. Variants, on demand

**Don't pre-generate sizes.** A transform layer in front of storage produces variants from the
master on first request and caches them at the CDN edge. Adding a new size later is a URL change,
not a migration.

| Variant | Spec | Consumer |
|---|---|---|
| `thumb` | 240 px long edge | Feed rows, lists, interest lists |
| `card` | 800 px long edge | Case page, cards, evidence |
| `full` | 1600 px (the master) | Lightbox; **the poster canvas source** ([10](10-sharing.md)) |
| `og` | 1200×630, cover-cropped | Composited by the `og:image` renderer ([10](10-sharing.md)) |
| `match` | 512×512, cover-cropped, sRGB | **Matching** ([O7](06-open-items.md)) — the pipeline produces the normalized input so the algorithm doc doesn't have to |

- Format negotiated by the CDN: **AVIF → WebP → JPEG** by `Accept`.
- URLs: `/img/{content_hash}/{variant}` — content-hashed, `Cache-Control: immutable`, one year.
- The poster's framer crop (`{zoom, panX, panY}`) stays on the device; the server never sees a
  cropped variant. The `og` crop is automatic (center, face-unaware — good enough; a smart crop is
  a later upgrade).

---

## 4. Serving and visibility

| Image belongs to | Visibility |
|---|---|
| Pet, case, sighting (attached) | **Public** — the card is public; the photo is the card |
| Orphan sighting | Internal — served only to the matching pipeline and to the owner on a candidate screen |
| Claim proof (`ownership_claim.proof`) | The custodian of that case, and the claimant. Never public |
| Help evidence | Public with the request — it's what the trust tier is about |

Public reads go through the CDN with no auth. Restricted ones are signed URLs, short TTL, issued
by the page that's allowed to show them. Nothing internal is ever one guessable hash away.

---

## 5. Retention

Photos are the bulk of what the purge rules in the flow docs actually free. Each rule deletes its
photos with its row:

| Rule | Photos deleted |
|---|---|
| Orphan sighting at `orphan_expires_at` (30 d) — [07](07-found-workflow_draft_1.md) | The sighting's |
| Unclaimed pet purged at expired + 30 d — [01 rule 7](01-actors-and-entities.md) | The pet's, and its found case's |
| Claim `stale` + purge window | Proof photos |
| Help request `removed` | Evidence, after the moderation record keeps a hash reference for 90 d |
| Account deletion (Ley 1581 right) | Everything referenced only by that person's rows |

Deletion is reference removal; a blob with zero references is garbage-collected within 24 h. Edge
caches expire with the immutable TTL — which is why restricted images are never served through
the public CDN path.

---

## 6. Events

None. Upload, transform, and serve are infrastructure; what a product metric needs (photos per
sighting, cases without photos) is a query over rows.

---

## Open items

- **Stack**: build vs. service for the transform layer (imgproxy / Cloudflare Images / Supabase
  transforms / Thumbor). Same decision covers the `og:image` renderer in [10](10-sharing.md).
  Everything above is identical either way — decided with the infra/architecture pass.
- **Smart crop** for `og` and `thumb` (subject-aware) — when center crops visibly cut off animals
  in the feed. Cheap with a service, a project without one.
