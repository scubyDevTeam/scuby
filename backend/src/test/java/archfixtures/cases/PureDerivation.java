package archfixtures.cases;

import java.time.Instant;

public class PureDerivation {
    public static boolean derive(Instant seenAt, Instant now) { return seenAt.isAfter(now); }
}
