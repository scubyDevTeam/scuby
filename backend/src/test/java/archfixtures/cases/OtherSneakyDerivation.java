package archfixtures.cases;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.function.Supplier;

/** Remaining loopholes: Clock.system(zone), SecureRandom, UUID.randomUUID, Math.random, a method reference to Instant.now. */
public class OtherSneakyDerivation {
    public static Object derive() {
        Supplier<Instant> ref = Instant::now;
        return new Object[] {
                Clock.system(ZoneOffset.UTC), new SecureRandom(), UUID.randomUUID(), Math.random(), ref
        };
    }
}
