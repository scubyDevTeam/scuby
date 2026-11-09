package co.scuby.support;

import co.scuby.platform.crypto.Hashing;
import org.springframework.http.HttpMethod;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/** A photo this browser's caller uploaded for a purpose, through the real slot and the development bucket. */
public final class Photos {

    private Photos() {}

    /** Takes a slot for {@code purpose} as {@code api}'s caller, stores the bytes (processed at once), returns the photo's URL. */
    public static String uploaded(ApiClient api, String purpose, String seed) {
        byte[] bytes = seed.getBytes(StandardCharsets.UTF_8);
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse slot = api.post("/uploads", """
                {"purpose":"%s","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(purpose, sha, bytes.length));
        assertThat(slot.status()).as("upload slot: %s", slot.body()).isEqualTo(201);
        if (!slot.isNull("/upload")) api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        return slot.str("/url");
    }
}
