# Legal — Colombia

> Researched 2026-08-01. Posture decision: **light** — intermediary ToS + privacy policy, no company yet.

## The short version

There is **no national licensing regime for adoption intermediation** in Colombia. The law's obligations fall on the humans and organizations holding animals — owners, shelters, foundations — not on platforms that connect them. Acting as a third-party bulletin board keeps us outside the regulated zone. What binds us from day one is **data protection**, not animal law.

## Relevant law

| Norm | What it does | Touches us? |
|---|---|---|
| [Ley 1774 de 2016](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=68135) | Animals are *sentient beings*; abuse is a crime; shelters/foundations must guarantee the five welfare freedoms; protection entities may put an animal up for adoption if a custodian abandons expenses 15+ days | Obligations on orgs and owners, not platforms. Foundations we onboard carry these duties |
| [Ley 84 de 1989](https://www.funcionpublica.gov.co/eva//gestornormativo/norma.php?i=8242) | National animal protection statute — duties of owners | No |
| [Ley 746 de 2002](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=5515) | Dog ownership in urban settings | No |
| Ley 1801 de 2016 ([Police Code](https://copropiedades.com.co/tenencia-de-mascotas-en-el-nuevo-codigo-de-policia/)) | Responsible-ownership rules, dangerous-breed muzzles, fines | No — applies to owners |
| **Ley 1581 de 2012 (habeas data)** | Personal-data protection | **Yes.** We hold names, phones, and geo-locations (a lost-pet pin is a home address by proxy) |

Context: [regional overview](http://www.scielo.org.co/scielo.php?script=sci_arttext&pid=S0122-02682020000200112) · [guía de tenencia responsable](https://www.ringo.com.co/actualidad-perruna/guia-de-leyes-y-tenencia-responsable-en-colombia). Municipal rules exist but target shelters and owners, not intermediaries.

## What we must ship at launch

1. **Terms of Service defining us as an intermediary**:
   - Adoptions are agreements between the adopter and the publisher — a person in v1, a foundation later — we facilitate contact, nothing more. We never approve an adopter or adjudicate ownership.
   - No money is handled or shown: no donations, no fees ([00 · #26](00-product-map.md)). Help is in kind and arranged between people; a foster home does not move responsibility for the animal.
   - Verification badges mean "we reviewed a document," **not** "we guarantee this person or organization."
2. **Ley 1581 compliance**: privacy policy, consent at signup, data-treatment policy (política de tratamiento de datos), user rights channel (consulta/reclamo).
3. **One lawyer review** of the ToS + privacy policy (~1–2M COP). The only legal spend at launch.

## Deferred (with triggers)

| Item | Trigger to revisit |
|---|---|
| Register an SAS | Money flows through us, contracts are signed with us, or revenue starts |
| Adoption-contract template offered to foundations as a value-add | Post-launch, if foundations ask — drafted once by a lawyer; pulls us closer to the transaction, so deliberately not v1 |
| Payment-processor compliance (Wompi/MercadoPago etc.) | Only if we ever abandon the never-touch-money principle — a major decision, not a drift |
