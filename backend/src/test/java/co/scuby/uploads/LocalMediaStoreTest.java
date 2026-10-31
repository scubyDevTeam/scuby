package co.scuby.uploads;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LocalMediaStoreTest {

    @Test
    void refusesAnythingButALowercaseSha256() throws Exception {
        var dir = Files.createTempDirectory("scuby-local-media-test");
        var store = new LocalMediaStore(new MediaProperties("local", "http://localhost/dev-media", dir.toString(), null, null,
                Duration.ofMinutes(5), 20, Duration.ofHours(24)));
        assertThatThrownBy(() -> store.isStored("../../etc/passwd")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> store.store("../x", new byte[1])).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> store.read("A".repeat(64))).isInstanceOf(IllegalArgumentException.class);
    }
}
