package archfixtures.cases;

import java.util.SplittableRandom;

public class UnseededSplittableRandomDerivation {
    public static SplittableRandom derive() { return new SplittableRandom(); }
}
