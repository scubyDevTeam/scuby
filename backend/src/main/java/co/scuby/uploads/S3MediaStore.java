package co.scuby.uploads;

import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Staging and production (docs/eng/infra.md · Media): a presigned PUT into incoming/, signed with the
 * photo's SHA-256 so S3 refuses other bytes; the ingest Lambda writes media/{sha}.jpg, which is
 * what "stored" means. No image work in the JVM.
 */
final class S3MediaStore implements MediaStore {

    private static final Logger log = LoggerFactory.getLogger(S3MediaStore.class);

    private final MediaProperties properties;
    private final S3Presigner presigner;
    private final S3Client s3;
    private final Pattern own;
    private final AtomicBoolean forbiddenLogged = new AtomicBoolean();

    S3MediaStore(MediaProperties properties, AwsCredentialsProvider credentials) {
        this(properties, S3Presigner.builder().region(Region.of(properties.region())).credentialsProvider(credentials).build(),
             S3Client.builder().region(Region.of(properties.region())).credentialsProvider(credentials)
                     .httpClient(UrlConnectionHttpClient.create()).build());
    }

    private S3MediaStore(MediaProperties properties, S3Presigner presigner, S3Client s3) {
        this.properties = properties;
        this.presigner = presigner;
        this.s3 = s3;
        String base = properties.publicBaseUrl().replaceAll("/+$", "");
        this.own = Pattern.compile("^" + Pattern.quote(base) + "/([0-9a-f]{64})\\.jpg$");
    }

    /** Tests only: the same store with another S3 client (a stub that throws a chosen status). */
    S3MediaStore withClient(S3Client client) {
        return new S3MediaStore(properties, presigner, client);
    }

    @Override
    public String publicUrl(String sha256) {
        return properties.publicBaseUrl().replaceAll("/+$", "") + "/" + sha256 + ".jpg";
    }

    @Override
    public Optional<String> sha256Of(String url) {
        Matcher m = own.matcher(url);
        return m.matches() ? Optional.of(m.group(1)) : Optional.empty();
    }

    @Override
    public boolean isStored(String sha256) {
        String key = "media/" + sha256 + ".jpg";
        try {
            s3.headObject(b -> b.bucket(properties.bucket()).key(key));
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) return false;
            if (e.statusCode() == 403 && forbiddenLogged.compareAndSet(false, true)) {
                log.error("HeadObject s3://{}/{} answered 403. A missing key answers 403 (not 404) when the role lacks "
                        + "s3:ListBucket on the bucket (prefix media/) — check the instance role (backend.md · Uploads).",
                        properties.bucket(), key);
            }
            throw e;
        }
    }

    @Override
    public UploadTarget presign(String sha256, long bytes, Instant expiresAt) {
        String checksum = Base64.getEncoder().encodeToString(HexFormat.of().parseHex(sha256));
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(properties.bucket())
                .key("incoming/" + sha256 + ".jpg")
                .contentType("image/jpeg")
                .contentLength(bytes)
                .checksumSHA256(checksum)
                .build();
        PresignedPutObjectRequest signed = presigner.presignPutObject(r -> r
                .signatureDuration(properties.slotTtl())
                .putObjectRequest(put));
        Map<String, String> headers = new LinkedHashMap<>();
        signed.signedHeaders().forEach((name, values) -> {
            String key = name.toLowerCase(Locale.ROOT);
            if (!key.equals("host")) headers.put(key, String.join(",", values));
        });
        return new UploadTarget("PUT", signed.url().toString(), headers, expiresAt);
    }
}
