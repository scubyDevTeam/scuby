package co.scuby.uploads;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static co.scuby.db.generated.Tables.UPLOAD;

@Service
class UploadSlots {

    private final DSLContext db;
    private final Clock clock;
    private final MediaStore store;
    private final MediaProperties properties;

    UploadSlots(DSLContext db, Clock clock, MediaStore store, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.store = store;
        this.properties = properties;
    }

    /**
     * Not transactional on purpose: the count and the upsert are single autocommit statements, and
     * {@code isStored} may be an S3 HeadObject, which must never run while a connection is held
     * (design · Identity, connection hygiene). The count-then-insert race is accepted: concurrent
     * requests from one caller can exceed the cap by at most the number in flight, and a slot only
     * costs a row (no bytes, no S3 call beyond a presign, which is local computation).
     */
    public UploadView slot(UploadRequest request, Caller caller) {
        if (request.purpose().needsSession() && !caller.signedIn()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "this purpose needs a session",
                    Map.of("purpose", "needs a signed-in session"), Map.of());
        }
        Instant now = clock.instant();
        int recent = recentSlotsQuery(caller.ownerKey(), now.minus(Duration.ofMinutes(10))).fetchOne().value1();
        if (recent >= properties.maxSlotsPer10Min()) throw new ApiException(ErrorCode.RATE_LIMITED, "too many upload slots");

        db.insertInto(UPLOAD)
          .set(UPLOAD.OWNER_KEY, caller.ownerKey())
          .set(UPLOAD.SHA256, request.sha256())
          .set(UPLOAD.PURPOSE, request.purpose().name())
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .onConflict(UPLOAD.OWNER_KEY, UPLOAD.SHA256, UPLOAD.PURPOSE).doUpdate()
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .execute();

        String url = store.publicUrl(request.sha256());
        UploadTarget target = store.isStored(request.sha256())
                ? null
                : store.presign(request.sha256(), request.bytes(), now.plus(properties.slotTtl()));
        return new UploadView(url, target);
    }

    Select<Record1<Integer>> recentSlotsQuery(String ownerKey, Instant since) {
        return db.select(DSL.count()).from(UPLOAD)
                 .where(UPLOAD.OWNER_KEY.eq(ownerKey))
                 .and(UPLOAD.CREATED_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }
}
