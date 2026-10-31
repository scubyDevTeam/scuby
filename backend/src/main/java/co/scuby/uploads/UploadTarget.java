package co.scuby.uploads;

import java.time.Instant;
import java.util.Map;

/** The contract's `upload` object: where and how to PUT the bytes. */
record UploadTarget(String method, String url, Map<String, String> headers, Instant expiresAt) {}
