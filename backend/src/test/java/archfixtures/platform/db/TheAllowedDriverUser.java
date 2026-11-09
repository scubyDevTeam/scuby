package archfixtures.platform.db;

import org.postgresql.util.PSQLException;

/** The one class the confinement rule allows to know the driver. */
public class TheAllowedDriverUser {
    boolean isIt(Throwable t) { return t instanceof PSQLException; }
}
