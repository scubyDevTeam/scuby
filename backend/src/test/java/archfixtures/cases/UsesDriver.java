package archfixtures.cases;

import org.postgresql.util.PSQLException;

/** Breaks the driver confinement: a feature class that knows the Postgres driver. */
public class UsesDriver {
    boolean isIt(Throwable t) { return t instanceof PSQLException; }
}
