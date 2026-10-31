package archfixtures.cases;

import archfixtures.identity.Exposed;

public class UsesExposed {
    public static String call() { return Exposed.value() + new Exposed.Nested("x").v(); }
}
