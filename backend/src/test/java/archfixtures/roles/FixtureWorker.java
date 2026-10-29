package archfixtures.roles;

import co.scuby.platform.roles.WorkerComponent;

@WorkerComponent
public class FixtureWorker {
    public String run(FixtureApi api) { return api.hello(); }
}
