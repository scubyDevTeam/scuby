package co.scuby.platform.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;

/**
 * Start-up guards. `refuse`: settings that are fine anywhere but production fail start-up under `prod`.
 * `requireDeployed`: settings every deployed environment (anything but `local`/`test`; a deployed profile mixed with them still counts as deployed) must provide.
 */
public final class Prod {

    private static final Logger log = LoggerFactory.getLogger(Prod.class);

    private Prod() {}

    public static void refuse(Environment env, boolean unsafe, String what) {
        if (unsafe && env.matchesProfiles("prod")) {
            throw new IllegalStateException("Refusing to start under the prod profile: " + what);
        }
    }

    /** `what` names the property key: ProfileStartupTest matches the message on it. */
    public static void requireDeployed(Environment env, boolean provided, String what) {
        // `staging,local` must not unlock the local defaults: a deployed profile always wins.
        boolean relaxed = env.matchesProfiles("local | test") && !env.matchesProfiles("prod | staging");
        if (!provided && !relaxed) {
            throw new IllegalStateException("Refusing to start without " + what
                    + " (required outside the local and test profiles)");
        }
    }

    public static void warnDeployed(Environment env, boolean suspicious, String what) {
        if (suspicious && !env.matchesProfiles("local | test")) {
            log.warn("Start-up check: {}", what);
        }
    }
}
