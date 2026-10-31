package archfixtures.cases;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;

/** Remaining loopholes: Clock.system(zone), SecureRandom, UUID.randomUUID, Math.random. */
public class OtherSneakyDerivation {
    public static Object derive() {
        return new Object[] {
                Clock.system(ZoneOffset.UTC), new SecureRandom(), UUID.randomUUID(), Math.random()
        };
    }
}
