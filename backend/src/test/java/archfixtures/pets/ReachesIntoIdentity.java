package archfixtures.pets;

import archfixtures.identity.Exposed;

/** A foundation depending on another foundation. */
public class ReachesIntoIdentity {
    public static String call() { return Exposed.value(); }
}
