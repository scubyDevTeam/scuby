package co.scuby.uploads;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jooq.Record2;
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
        var recent = recentSlotsQuery(caller.ownerKey(), caller.ipHash(), now.minus(Duration.ofMinutes(10))).fetchOne();
        if (recent.value1() >= properties.maxSlotsPer10Min() || recent.value2() >= properties.maxSlotsPerIp10Min()) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many upload slots");
        }

        db.insertInto(UPLOAD)
          .set(UPLOAD.OWNER_KEY, caller.ownerKey())
          .set(UPLOAD.SHA256, request.sha256())
          .set(UPLOAD.PURPOSE, request.purpose().name())
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .set(UPLOAD.IP_HASH, caller.ipHash())
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .onConflict(UPLOAD.OWNER_KEY, UPLOAD.SHA256, UPLOAD.PURPOSE).doUpdate()
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .set(UPLOAD.IP_HASH, caller.ipHash())
          .execute();

        String url = store.publicUrl(request.sha256());
        UploadTarget target = store.isStored(request.sha256())
                ? null
                : store.presign(request.sha256(), request.bytes(), now.plus(properties.slotTtl()));
        return new UploadView(url, target);
    }

    /**
     * One statement, two counts over the last window: this caller's slots (the primary key's owner_key prefix) and this
     * IP's slots across all callers (upload_by_ip_recent_idx). The OR is served by a bitmap union of the two indexes.
     */
    Select<Record2<Integer, Integer>> recentSlotsQuery(String ownerKey, String ipHash, Instant since) {
        return db.select(DSL.count().filterWhere(UPLOAD.OWNER_KEY.eq(ownerKey)),
                         DSL.count().filterWhere(UPLOAD.IP_HASH.eq(ipHash)))
                 .from(UPLOAD)
                 .where(UPLOAD.OWNER_KEY.eq(ownerKey).or(UPLOAD.IP_HASH.eq(ipHash)))
                 .and(UPLOAD.CREATED_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }
}
