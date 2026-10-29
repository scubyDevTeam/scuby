package archfixtures.cases;

import archfixtures.roles.FixtureApi;

public class BeanUsingDerivation {
    public static String derive(FixtureApi api) { return api.hello(); }
}
