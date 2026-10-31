package archfixtures.roles;

import co.scuby.platform.roles.WorkerComponent;

@WorkerComponent
public class FixtureWorkerListener {
    @FixtureListener
    public void onMessage(String message) {}
}
