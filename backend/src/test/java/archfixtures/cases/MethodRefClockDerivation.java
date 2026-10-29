package archfixtures.cases;

import java.time.Instant;
import java.util.function.Supplier;

/** The only clock read is a method reference, never a call. */
public class MethodRefClockDerivation {
    public static Supplier<Instant> derive() { return Instant::now; }
}
