package co.scuby.identity;

/** The account a sign-in resolved and the session it opened in the same transaction (the cookie is issued after commit). */
record SignedIn(Person person, NewSession session) {}
