package co.scuby.uploads;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class S3MediaStoreTest {

    static final String SHA = "b".repeat(64);

    private final S3MediaStore store = new S3MediaStore(
            new MediaProperties("s3", "https://img.scuby.example", "", "scuby-media-staging", "us-east-1",
                    Duration.ofMinutes(5), 20, Duration.ofHours(24)),
            StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIDEXAMPLE", "secret")));

    @Test
    void presignsAPutIntoIncomingSignedWithTheHash() {
        Instant now = Instant.parse("2026-10-14T17:00:00Z");
        UploadTarget t = store.presign(SHA, 3000, now.plus(Duration.ofMinutes(5)));
        assertThat(t.method()).isEqualTo("PUT");
        // Assert on the parsed URL, not the host: in us-east-1 the SDK presigns against the global
        // host (bucket.s3.amazonaws.com), elsewhere against bucket.s3.<region>.amazonaws.com.
        URI uri = URI.create(t.url());
        assertThat(uri.getScheme()).isEqualTo("https");
        assertThat(uri.getHost()).startsWith("scuby-media-staging.s3.").endsWith(".amazonaws.com");
        assertThat(uri.getPath()).isEqualTo("/incoming/" + SHA + ".jpg");
        assertThat(uri.getRawQuery()).contains("X-Amz-Expires=300").contains("X-Amz-SignedHeaders=");
        String signedHeaders = URLDecoder.decode(
                uri.getRawQuery().replaceAll(".*X-Amz-SignedHeaders=([^&]*).*", "$1"), StandardCharsets.UTF_8);
        assertThat(signedHeaders.split(";")).contains("x-amz-checksum-sha256", "content-length", "content-type");
        String checksum = Base64.getEncoder().encodeToString(HexFormat.of().parseHex(SHA));
        assertThat(t.headers()).containsEntry("x-amz-checksum-sha256", checksum)
                               .containsEntry("content-type", "image/jpeg")
                               // signed, so the browser's recomputed Content-Length must equal the slot's bytes
                               .containsEntry("content-length", "3000")
                               .doesNotContainKey("host");
    }

    /**
     * Without s3:ListBucket, S3 answers HeadObject on a missing key with 403, not 404. The handoff
     * grants ListBucket (prefix media/), so 403 means a misconfigured role: it stays an error (500),
     * logged with the bucket, key and the ListBucket hint — never silently "not stored".
     */
    @Test
    void aMissingObjectIsNotStoredAndAForbiddenHeadIsAnError() {
        S3Client missing = stubHead(s3Error(404, "Not Found"));
        S3Client forbidden = stubHead(s3Error(403, "Forbidden"));
        S3Client noSuchKey = stubHead(NoSuchKeyException.builder().statusCode(404).message("NoSuchKey").build());
        assertThat(store.withClient(missing).isStored(SHA)).isFalse();
        assertThat(store.withClient(noSuchKey).isStored(SHA)).isFalse();
        assertThatThrownBy(() -> store.withClient(forbidden).isStored(SHA)).isInstanceOf(S3Exception.class);
    }

    /** A 5xx is an outage, never "not stored": it must propagate (500) so a photo is not refused as missing. */
    @Test
    void aServerErrorOnHeadPropagates() {
        for (int status : new int[]{500, 503}) {
            S3Client down = stubHead(s3Error(status, "Service Unavailable"));
            assertThatThrownBy(() -> store.withClient(down).isStored(SHA))
                    .isInstanceOfSatisfying(S3Exception.class, e -> assertThat(e.statusCode()).isEqualTo(status));
        }
    }

    @Test
    void theStoreRejectsAnythingButLowercaseSha256() {
        for (String bad : new String[]{"B".repeat(64), "b".repeat(63), "../" + "b".repeat(61), "", null}) {
            assertThatThrownBy(() -> store.isStored(bad)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> store.presign(bad, 10, Instant.now())).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void closeClosesTheClients() {
        java.util.concurrent.atomic.AtomicBoolean closed = new java.util.concurrent.atomic.AtomicBoolean();
        S3Client client = (S3Client) java.lang.reflect.Proxy.newProxyInstance(S3Client.class.getClassLoader(), new Class<?>[]{S3Client.class},
                (proxy, method, args) -> { if (method.getName().equals("close")) closed.set(true); return null; });
        store.withClient(client).close();
        assertThat(closed).isTrue();
    }

    private static S3Exception s3Error(int status, String message) {
        return (S3Exception) S3Exception.builder().statusCode(status).message(message).build();
    }

    /** An S3Client whose headObject always throws {@code e} (a JDK proxy: no network, no mocking library). */
    private static S3Client stubHead(S3Exception e) {
        return (S3Client) java.lang.reflect.Proxy.newProxyInstance(S3Client.class.getClassLoader(), new Class<?>[]{S3Client.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("headObject")) throw e;
                    if (method.getName().equals("close")) return null;
                    throw new UnsupportedOperationException(method.getName());
                });
    }

    @Test
    void urlsDeriveFromTheHashAndRoundTrip() {
        assertThat(store.publicUrl(SHA)).isEqualTo("https://img.scuby.example/" + SHA + ".jpg");
        assertThat(store.sha256Of(store.publicUrl(SHA))).contains(SHA);
        assertThat(store.sha256Of("https://elsewhere.example/" + SHA + ".jpg")).isEmpty();
    }
}
