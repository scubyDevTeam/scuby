package co.scuby.uploads;

import org.junit.jupiter.api.Test;
import org.springframework.boot.validation.autoconfigure.ValidationAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/** A missing media value fails start-up naming the key, instead of an NPE later or a silent 0 that rate-limits everyone. */
class MediaPropertiesValidationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(org.springframework.boot.autoconfigure.AutoConfigurations.of(ValidationAutoConfiguration.class))
            .withUserConfiguration(Enabled.class);

    @EnableConfigurationProperties(MediaProperties.class)
    static class Enabled {}

    private static final String[] LOCAL = {
            "scuby.media.store=local", "scuby.media.public-base-url=http://localhost/dev-media",
            "scuby.media.local-dir=target/x", "scuby.media.slot-ttl=5m", "scuby.media.max-slots-per10-min=20", "scuby.media.max-slots-per-ip10-min=60",
            "scuby.media.attach-window=24h"};
    private static final String[] S3 = {
            "scuby.media.store=s3", "scuby.media.public-base-url=https://img.scuby.test",
            "scuby.media.bucket=b", "scuby.media.region=sa-east-1", "scuby.media.slot-ttl=5m",
            "scuby.media.max-slots-per10-min=20", "scuby.media.max-slots-per-ip10-min=60", "scuby.media.attach-window=24h"};

    private static String[] without(String[] all, String key) {
        return java.util.Arrays.stream(all).filter(p -> !p.startsWith("scuby.media." + key + "=")).toArray(String[]::new);
    }

    private String failureOf(String... props) {
        var holder = new String[1];
        runner.withPropertyValues(props).run(ctx -> {
            assertThat(ctx).hasFailed();
            StringBuilder sb = new StringBuilder();
            for (Throwable t = ctx.getStartupFailure(); t != null; t = t.getCause()) sb.append(t.getMessage()).append('\n');
            holder[0] = sb.toString();
        });
        return holder[0];
    }

    @Test
    void completeLocalAndS3ConfigurationsBind() {
        runner.withPropertyValues(LOCAL).run(ctx -> assertThat(ctx).hasNotFailed());
        runner.withPropertyValues(S3).run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void aMissingSlotLimitFailsInsteadOfBindingToZero() {
        assertThat(failureOf(without(LOCAL, "max-slots-per10-min"))).contains("max-slots-per10-min");
        assertThat(failureOf(without(S3, "max-slots-per10-min"))).contains("max-slots-per10-min");
        assertThat(failureOf(without(LOCAL, "max-slots-per-ip10-min"))).contains("max-slots-per-ip10-min");
    }

    @Test
    void aMissingPublicBaseUrlFails() {
        assertThat(failureOf(without(LOCAL, "public-base-url"))).contains("public-base-url");
        assertThat(failureOf(without(S3, "public-base-url"))).contains("public-base-url");
    }

    @Test
    void aMissingLocalDirFailsForTheLocalStoreOnly() {
        assertThat(failureOf(without(LOCAL, "local-dir"))).contains("local-dir");
        runner.withPropertyValues(S3).run(ctx -> assertThat(ctx).hasNotFailed());
    }

    @Test
    void aMissingBucketOrRegionFailsForTheS3Store() {
        assertThat(failureOf(without(S3, "bucket"))).contains("bucket");
        assertThat(failureOf(without(S3, "region"))).contains("region");
        assertThat(failureOf(concat(without(S3, "bucket"), "scuby.media.bucket= "))).contains("bucket");
    }

    @Test
    void anUnknownStoreFails() {
        assertThat(failureOf(concat(without(LOCAL, "store"), "scuby.media.store=gcs"))).contains("store");
    }

    @Test
    void missingTimingValuesFail() {
        assertThat(failureOf(without(LOCAL, "slot-ttl"))).contains("slot-ttl");
        assertThat(failureOf(without(LOCAL, "attach-window"))).contains("attach-window");
    }

    private static String[] concat(String[] a, String extra) {
        String[] r = java.util.Arrays.copyOf(a, a.length + 1);
        r[a.length] = extra;
        return r;
    }
}
