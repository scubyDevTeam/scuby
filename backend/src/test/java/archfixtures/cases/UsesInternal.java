package archfixtures.cases;

import archfixtures.identity.Internal;

public class UsesInternal {
    public static String call() { return Internal.value(); }
}
