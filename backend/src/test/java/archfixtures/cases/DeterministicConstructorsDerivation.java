package archfixtures.cases;

import java.util.Date;
import java.util.Random;
import java.util.SplittableRandom;

/** Seeded generators and an explicit-instant Date are deterministic, so they stay allowed. */
public class DeterministicConstructorsDerivation {
    public static Object derive() { return new Object[] {new Random(42L), new SplittableRandom(7L), new Date(0L)}; }
}
