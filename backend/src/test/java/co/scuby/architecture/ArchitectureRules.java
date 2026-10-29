package co.scuby.architecture;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.roles.WorkerComponent;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.lang.ArchRule;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.SplittableRandom;

import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.core.domain.properties.CanBeAnnotated.Predicates.metaAnnotatedWith;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

/** The design's guardrails 1–4 (docs/eng/backend.md · Code structure), parameterised by root package and feature lists so a self-test can aim them at fixtures. */
final class ArchitectureRules {

    static final List<String> FOUNDATIONS = List.of("identity", "uploads", "pets");
    static final List<String> VERTICALS = List.of("cases");

    private final String root;
    private final List<String> foundations;
    private final List<String> verticals;

    ArchitectureRules(String root) {
        this(root, FOUNDATIONS, VERTICALS);
    }

    ArchitectureRules(String root, List<String> foundations, List<String> verticals) {
        this.root = root;
        this.foundations = List.copyOf(foundations);
        this.verticals = List.copyOf(verticals);
    }

    static final DescribedPredicate<JavaClass> DERIVATION = new DescribedPredicate<>("a *Derivation class or one nested in it") {
        @Override public boolean test(JavaClass c) { return c.getName().matches(".*Derivation(\\$.*)?"); }
    };

    static final DescribedPredicate<JavaClass> MODULE_API = new DescribedPredicate<>("@ModuleApi or nested in a @ModuleApi class") {
        @Override public boolean test(JavaClass c) {
            for (Optional<JavaClass> k = Optional.of(c); k.isPresent(); k = k.get().getEnclosingClass()) {
                if (k.get().isAnnotatedWith(ModuleApi.class)) return true;
            }
            return false;
        }
    };

    /**
     * Any read of the clock or of randomness, whatever the overload: every `now(..)` on a java.time type
     * (also `Instant.now(clock)`), Clock.system*, System.currentTimeMillis/nanoTime, UUID.randomUUID,
     * Math.random, ThreadLocalRandom.current.
     */
    static final DescribedPredicate<JavaMethodCall> CLOCK_OR_RANDOMNESS = new DescribedPredicate<>("reads the clock or randomness") {
        @Override public boolean test(JavaMethodCall call) {
            String owner = call.getTargetOwner().getName();
            String name = call.getName();
            return (owner.startsWith("java.time.") && name.equals("now"))
                    || (owner.equals("java.time.Clock") && (name.startsWith("system") || name.startsWith("tick")))
                    || (owner.equals("java.lang.System") && (name.equals("currentTimeMillis") || name.equals("nanoTime")))
                    || (owner.equals("java.util.UUID") && name.equals("randomUUID"))
                    || (owner.equals("java.lang.Math") && name.equals("random"))
                    || (owner.equals("java.util.concurrent.ThreadLocalRandom") && name.equals("current"))
                    || (owner.equals("java.security.SecureRandom") && name.startsWith("getInstance"));
        }
    };

    /** 1a. Derivations are pure: no Spring, jOOQ, generated tables, I/O, network, NIO or JDBC; no Spring beans. */
    ArchRule derivationsDependOnNothingImpure() {
        return noClasses().that(DERIVATION).should().dependOnClassesThat(
                        resideInAnyPackage("org.springframework..", "org.jooq..", root + ".db.generated..",
                                "java.io..", "java.net..", "java.nio..", "java.sql..")
                                .or(metaAnnotatedWith(Component.class)))
                .allowEmptyShould(true)
                .because("a derivation takes facts, the viewer and the time as parameters and returns a view");
    }

    /** 1b. Derivations never read the clock or randomness themselves. */
    ArchRule derivationsReadNoClockOrRandomness() {
        return noClasses().that(DERIVATION)
                .should().callMethodWhere(CLOCK_OR_RANDOMNESS)
                .orShould().callConstructor(SecureRandom.class)
                .orShould().callConstructor(Random.class)
                .orShould().callConstructor(SplittableRandom.class)
                .allowEmptyShould(true)
                .because("time and randomness are parameters, so derivations are table-testable");
    }

    /** 2. Roles by annotation (replaces the package-based rule). */
    ArchRule workersDoNotUseApi() {
        return noClasses().that().areAnnotatedWith(WorkerComponent.class)
                .should().dependOnClassesThat().areAnnotatedWith(ApiComponent.class).allowEmptyShould(true);
    }

    ArchRule apiDoesNotUseWorkers() {
        return noClasses().that().areAnnotatedWith(ApiComponent.class)
                .should().dependOnClassesThat().areAnnotatedWith(WorkerComponent.class).allowEmptyShould(true);
    }

    /** 3. The DAG: platform → nothing of ours; foundations → platform only; verticals → foundations + platform, never each other. */
    ArchRule platformDependsOnNoFeature() {
        return noClasses().that().resideInAPackage(root + ".platform..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(all()))
                .allowEmptyShould(true);
    }

    ArchRule foundationIsolated(String foundation) {
        List<String> others = new ArrayList<>(all());
        others.remove(foundation);
        return noClasses().that().resideInAPackage(root + "." + foundation + "..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(others))
                .allowEmptyShould(true)
                .because("foundations depend only on platform (and the generated tables)");
    }

    ArchRule verticalIsolated(String vertical) {
        List<String> others = new ArrayList<>(verticals);
        others.remove(vertical);
        return noClasses().that().resideInAPackage(root + "." + vertical + "..")
                .should().dependOnClassesThat().resideInAnyPackage(packages(others))
                .allowEmptyShould(true)
                .because("verticals never depend on each other");
    }

    /** Every class lives in platform, the generated tables, a listed feature, or is the application class. */
    ArchRule onlyKnownTopLevelPackages() {
        List<String> known = new ArrayList<>(List.of("platform", "db.generated"));
        known.addAll(all());
        return classes().that().resideInAPackage(root + "..").and().doNotHaveFullyQualifiedName(root + ".ScubyApplication")
                .should().resideInAnyPackage(packages(known))
                .because("a new feature package is added to ArchitectureRules.FOUNDATIONS or VERTICALS");
    }

    /** 4. Declared surface: a feature's class used from outside the feature carries @ModuleApi. */
    ArchRule moduleApi(String feature) {
        return classes().that().resideInAPackage(root + "." + feature + "..").and(DescribedPredicate.not(MODULE_API))
                .should().onlyHaveDependentClassesThat().resideInAPackage(root + "." + feature + "..")
                .allowEmptyShould(true)
                .because("cross-feature use is declared with @ModuleApi");
    }

    List<String> foundations() { return foundations; }

    List<String> verticals() { return verticals; }

    List<String> all() {
        List<String> all = new ArrayList<>(foundations);
        all.addAll(verticals);
        return all;
    }

    private String[] packages(List<String> features) {
        return features.stream().map(f -> root + "." + f + "..").toArray(String[]::new);
    }
}
