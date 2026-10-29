package archfixtures.cases;

import java.util.UUID;
import java.util.function.Supplier;

/** The only randomness read is a method reference, never a call. */
public class MethodRefRandomDerivation {
    public static Supplier<UUID> derive() { return UUID::randomUUID; }
}
