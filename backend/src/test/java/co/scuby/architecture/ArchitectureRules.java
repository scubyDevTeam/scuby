package co.scuby.architecture;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.roles.WorkerComponent;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.AccessTarget;
import com.tngtech.archunit.lang.ArchRule;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

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
     * Any read of the clock or of randomness, whatever the overload and whether called or taken as a method
     * reference (`Instant::now`): every `now(..)` on a java.time type, Clock.system*, System.currentTimeMillis/nanoTime,
     * UUID.randomUUID, Math.random, ThreadLocalRandom.current, SecureRandom.getInstance*; and the constructors
     * `new SecureRandom(..)`, `new Random()`, `new SplittableRandom()` and `new Date()` (seeded / explicit-instant forms are deterministic and allowed).
     */
    static final DescribedPredicate<AccessTarget> CLOCK_OR_RANDOMNESS = new DescribedPredicate<>("reads the clock or randomness") {
        @Override public boolean test(AccessTarget target) {
            String owner = target.getOwner().getName();
            String name = target.getName();
            if (target instanceof AccessTarget.ConstructorCallTarget ctor) {
                int params = ctor.getRawParameterTypes().size();
                return owner.equals("java.security.SecureRandom")
                        || (params == 0 && (owner.equals("java.util.Random") || owner.equals("java.util.SplittableRandom")
                        || owner.equals("java.util.Date")));
            }
            return (owner.startsWith("java.time.") && name.equals("now"))
                    || (owner.equals("java.time.Clock") && (name.startsWith("system") || name.startsWith("tick")))
                    || (owner.equals("java.lang.System") && (name.equals("currentTimeMillis") || name.equals("nanoTime")))
                    || (owner.equals("java.util.UUID") && name.equals("randomUUID"))
                    || (owner.equals("java.lang.Math") && name.equals("random"))
                    || (owner.equals("java.util.concurrent.ThreadLocalRandom") && name.equals("current"))
                    || (owner.equals("java.security.SecureRandom") && name.startsWith("getInstance"));
        }
    };

    /**
     * 1a. Derivations are pure: no Spring, jOOQ, generated tables, I/O, network, NIO or JDBC; no Spring beans.
     * <p>
     * Limit: the check is on the derivation's own direct dependencies. A pure-looking derivation can still reach
     * impure code through a non-derivation helper in the same package; transitive checks are impractical because
     * JDK internals reach java.io. Reviewers must check the helpers a derivation calls.
     */
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
                .should().accessTargetWhere(JavaAccess.Predicates.target(CLOCK_OR_RANDOMNESS))
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

    /** Annotations that make a method a worker entry point (a scheduler tick, a queue consumer). */
    static final List<String> WORKER_ENTRY_POINTS = List.of(
            "org.springframework.scheduling.annotation.Scheduled",
            "io.awspring.cloud.sqs.annotation.SqsListener");

    /** 2b. Every web controller declares the api role: a bare @RestController would run under any role setting. */
    ArchRule restControllersAreApiComponents() {
        return classes().that().areAnnotatedWith(org.springframework.web.bind.annotation.RestController.class)
                .should().beAnnotatedWith(ApiComponent.class).allowEmptyShould(true)
                .because("a controller without @ApiComponent ignores scuby.roles.api and can depend on workers freely");
    }

    /** 2c. Every scheduled or queue-consuming method lives in a @WorkerComponent: otherwise it runs on every api instance too. */
    ArchRule workerEntryPointsLiveInWorkerComponents() {
        return workerEntryPointsLiveInWorkerComponents(WORKER_ENTRY_POINTS);
    }

    ArchRule workerEntryPointsLiveInWorkerComponents(List<String> annotations) {
        DescribedPredicate<com.tngtech.archunit.core.domain.JavaMethod> entryPoint = new DescribedPredicate<>("annotated as a worker entry point") {
            @Override public boolean test(com.tngtech.archunit.core.domain.JavaMethod m) {
                return annotations.stream().anyMatch(a -> m.isAnnotatedWith(a));
            }
        };
        return com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods().that(entryPoint)
                .should().beDeclaredInClassesThat().areAnnotatedWith(WorkerComponent.class).allowEmptyShould(true)
                .because("a @Scheduled/@SqsListener method outside a @WorkerComponent runs on every api instance as well as the worker");
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

    /**
     * Limit: all verticals are peers. When a second vertical arrives and implements `cases`'s CaseKind, this rule
     * must give `cases` its own tier (verticals may depend on `cases`) instead of forbidding it.
     */
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

    /**
     * 5. The Postgres driver is confined to one domain-free class (platform.db.UniqueViolation, which reads SQLSTATE and the
     * constraint name, the only locale-proof way to tell a unique violation apart): nothing else imports org.postgresql.
     */
    ArchRule onlyUniqueViolationKnowsThePostgresDriver() {
        return onlyKnowsThePostgresDriver(root + ".platform.db.UniqueViolation");
    }

    ArchRule onlyKnowsThePostgresDriver(String allowedClass) {
        return noClasses().that().doNotHaveFullyQualifiedName(allowedClass)
                .should().dependOnClassesThat(resideInAnyPackage("org.postgresql.."))
                .allowEmptyShould(true)
                .because("driver types leak the database into the domain; UniqueViolation is the one place that reads them");
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
