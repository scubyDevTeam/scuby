package archfixtures.cases;

import java.security.SecureRandom;

public class SeededSecureRandomDerivation {
    public static SecureRandom derive() { return new SecureRandom(new byte[] {1}); }
}
