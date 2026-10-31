package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * The development bucket (local and test profiles only): stands in for the presigned S3 PUT and the
 * image CDN. Like S3 with x-amz-checksum-sha256, it refuses bytes that do not match the hash.
 */
@ApiComponent
@RestController
@Profile({"local", "test"})
class DevMediaController {

    private final LocalMediaStore store;

    DevMediaController(LocalMediaStore store) {
        this.store = store;
    }

    @PutMapping("/dev-media/{sha256:[0-9a-f]{64}}.jpg")
    ResponseEntity<Void> put(@PathVariable String sha256, @RequestBody byte[] bytes) {
        if (!Hashing.sha256Hex(bytes).equals(sha256)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "bytes do not match the hash", Map.of("(body)", "sha256 mismatch"), Map.of());
        }
        store.store(sha256, bytes);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/dev-media/{sha256:[0-9a-f]{64}}.jpg")
    ResponseEntity<byte[]> get(@PathVariable String sha256) {
        return store.read(sha256)
                    .map(b -> ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).body(b))
                    .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
