package archfixtures.cases;

import org.jooq.impl.DSL;

public class JooqUsingDerivation {
    public static String derive(String s) { return DSL.inline(s).toString(); }
}
