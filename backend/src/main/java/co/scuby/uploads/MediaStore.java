package co.scuby.uploads;

import java.time.Instant;
import java.util.Optional;

/** Where photo bytes live: a development directory (local, test) or S3 + the ingest Lambda (staging, prod). */
interface MediaStore {

    /** The photo's public URL — derived from the hash, so a re-upload is the same URL. */
    String publicUrl(String sha256);

    /** The hash back from a URL this store issued; empty for anything else. */
    Optional<String> sha256Of(String url);

    /** True when the processed bytes exist (local: the PUT arrived; S3: the ingest Lambda wrote media/{sha}.jpg). */
    boolean isStored(String sha256);

    UploadTarget presign(String sha256, long bytes, Instant expiresAt);
}
