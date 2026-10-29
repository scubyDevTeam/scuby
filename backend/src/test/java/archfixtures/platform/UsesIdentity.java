package archfixtures.platform;

import archfixtures.identity.Exposed;

public class UsesIdentity {
    public static String call() { return Exposed.value(); }
}
