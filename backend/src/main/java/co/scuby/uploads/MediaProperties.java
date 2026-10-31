package co.scuby.uploads;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * scuby.media.*: store = local | s3; publicBaseUrl = where photo URLs point (local: the API's
 * /dev-media; staging/prod: the image CDN); localDir for the local store; bucket/region for S3.
 * Validated at start-up: a missing value fails naming the key (a missing int would bind to 0 and
 * rate-limit every caller).
 */
@Validated
@ConfigurationProperties("scuby.media")
record MediaProperties(String store,
                       @NotBlank(message = "scuby.media.public-base-url must be set") String publicBaseUrl,
                       String localDir, String bucket, String region,
                       @NotNull(message = "scuby.media.slot-ttl must be set") Duration slotTtl,
                       @Min(value = 1, message = "scuby.media.max-slots-per10-min must be set and at least 1") int maxSlotsPer10Min,
                       @Min(value = 1, message = "scuby.media.max-slots-per-ip10-min must be set and at least 1") int maxSlotsPerIp10Min,
                       @NotNull(message = "scuby.media.attach-window must be set") Duration attachWindow) {

    boolean isS3() { return "s3".equals(store); }

    @AssertTrue(message = "scuby.media.store must be local or s3")
    boolean isStoreKnown() { return store == null || "local".equals(store) || "s3".equals(store); }

    @AssertTrue(message = "scuby.media.local-dir must be set when scuby.media.store=local")
    boolean isLocalDirSetWhenLocal() { return isS3() || !(localDir == null || localDir.isBlank()); }

    @AssertTrue(message = "scuby.media.bucket must be set when scuby.media.store=s3")
    boolean isBucketSetWhenS3() { return !isS3() || !(bucket == null || bucket.isBlank()); }

    @AssertTrue(message = "scuby.media.region must be set when scuby.media.store=s3")
    boolean isRegionSetWhenS3() { return !isS3() || !(region == null || region.isBlank()); }
}
