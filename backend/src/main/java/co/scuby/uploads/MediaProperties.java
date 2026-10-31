package co.scuby.uploads;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * scuby.media.*: store = local | s3; publicBaseUrl = where photo URLs point (local: the API's
 * /dev-media; staging/prod: the image CDN); localDir for the local store; bucket/region for S3.
 */
@ConfigurationProperties("scuby.media")
record MediaProperties(String store, String publicBaseUrl, String localDir, String bucket, String region,
                       Duration slotTtl, int maxSlotsPer10Min, Duration attachWindow) {}
