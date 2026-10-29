package archfixtures.roles;

import co.scuby.platform.roles.WorkerComponent;
import org.springframework.scheduling.annotation.Scheduled;

@WorkerComponent
public class FixtureWorkerScheduled {
    @Scheduled(fixedDelay = 1000)
    public void tick() {}
}
