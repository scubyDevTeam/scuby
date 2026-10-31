package co.scuby.uploads;

import org.jspecify.annotations.Nullable;

/** The contract's Upload: `upload` is null when the photo is already stored. */
record UploadView(String url, @Nullable UploadTarget upload) {}
