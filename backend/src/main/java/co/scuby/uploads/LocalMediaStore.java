package co.scuby.uploads;

import co.scuby.platform.cache.ClearableCache;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Local and test only: bytes in a directory, "processed" the moment they arrive (as the client mock). */
final class LocalMediaStore implements MediaStore, ClearableCache {

    private final String base;
    private final Path dir;
    private final Pattern own;

    LocalMediaStore(MediaProperties properties) {
        this.base = properties.publicBaseUrl().replaceAll("/+$", "");
        this.dir = Path.of(properties.localDir());
        this.own = Pattern.compile("^" + Pattern.quote(base) + "/([0-9a-f]{64})\\.jpg$");
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override public String publicUrl(String sha256) { return base + "/" + sha256 + ".jpg"; }

    @Override
    public Optional<String> sha256Of(String url) {
        Matcher m = own.matcher(url);
        return m.matches() ? Optional.of(m.group(1)) : Optional.empty();
    }

    @Override public boolean isStored(String sha256) { return Files.exists(file(sha256)); }

    @Override
    public UploadTarget presign(String sha256, long bytes, Instant expiresAt) {
        return new UploadTarget("PUT", publicUrl(sha256), Map.of("content-type", "image/jpeg"), expiresAt);
    }

    void store(String sha256, byte[] bytes) {
        try {
            Files.write(file(sha256), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    Optional<byte[]> read(String sha256) {
        try {
            return isStored(sha256) ? Optional.of(Files.readAllBytes(file(sha256))) : Optional.empty();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Tests only (TestDb.reset): forget every stored photo. */
    @Override
    public void clear() {
        try (var files = Files.list(dir)) {
            files.forEach(f -> f.toFile().delete());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path file(String sha256) {
        return dir.resolve(sha256 + ".jpg");
    }
}
