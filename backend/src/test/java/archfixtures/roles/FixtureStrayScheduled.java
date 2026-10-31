package archfixtures.roles;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Breaks the rule: a scheduler tick in a plain component. */
@Component
public class FixtureStrayScheduled {
    @Scheduled(fixedDelay = 1000)
    public void tick() {}
}
