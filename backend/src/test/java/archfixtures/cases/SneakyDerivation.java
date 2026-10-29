package archfixtures.cases;

import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

public class SneakyDerivation {
    public static long derive(Clock clock) {
        return System.currentTimeMillis() + Instant.now(clock).toEpochMilli() + ThreadLocalRandom.current().nextInt();
    }
}
