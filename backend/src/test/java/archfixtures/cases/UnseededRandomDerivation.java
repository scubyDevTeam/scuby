package archfixtures.cases;

import java.util.Random;

public class UnseededRandomDerivation {
    public static Random derive() { return new Random(); }
}
