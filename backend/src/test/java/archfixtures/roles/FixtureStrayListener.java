package archfixtures.roles;

import org.springframework.stereotype.Component;

/** Breaks the rule: a queue consumer in a plain component. */
@Component
public class FixtureStrayListener {
    @FixtureListener
    public void onMessage(String message) {}
}
