package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Instant;

/** An item of the contract's MyCases (web/src/contracts/owner.ts · myCaseWire). Every field present. */
record MyCaseView(String code, String vertical, String status, String title, String placeName, @Nullable String photoUrl,
                  Instant publishedAt, int openClaimCount, @Nullable Instant pendingCheckinAt) {}
