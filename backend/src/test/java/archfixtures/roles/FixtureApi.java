package archfixtures.roles;

import co.scuby.platform.roles.ApiComponent;

@ApiComponent
public class FixtureApi {
    public String hello() { return "api"; }
    public String trigger(FixtureWorker worker) { return worker.run(this); }
}
