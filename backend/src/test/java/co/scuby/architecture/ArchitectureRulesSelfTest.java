package co.scuby.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Each rule must fail on a fixture that breaks it — a rule that never fails guards nothing. */
class ArchitectureRulesSelfTest {

    private static final JavaClasses FIXTURES = new ClassFileImporter().importPackages("archfixtures");
    /** Fixtures have two foundations and two verticals, so vertical → vertical can be broken on purpose. */
    private static final ArchitectureRules RULES =
            new ArchitectureRules("archfixtures", List.of("identity", "pets"), List.of("cases", "help"));

    @Test
    void aDerivationReadingTheClockFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("archfixtures.cases.ClockReadingDerivation")
                .message().doesNotContain("PureDerivation");
    }

    @Test
    void aDerivationReadingTimeOrRandomnessThroughAnyOverloadFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("java.lang.System.currentTimeMillis()")
                .hasMessageContaining("java.time.Instant.now(java.time.Clock)")
                .hasMessageContaining("java.util.concurrent.ThreadLocalRandom.current()");
    }

    @Test
    void aDerivationUsingClockSystemSecureRandomUuidMathRandomFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("OtherSneakyDerivation")
                .hasMessageContaining("java.time.Clock.system(java.time.ZoneId)")
                .hasMessageContaining("java.util.UUID.randomUUID()")
                .hasMessageContaining("java.lang.Math.random()")
                .hasMessageContaining("java.security.SecureRandom.<init>()");
    }

    private static void assertClockRuleFlags(String fixture) {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("archfixtures.cases." + fixture);
    }

    @Test
    void aMethodReferenceToTheClockFails() { assertClockRuleFlags("MethodRefClockDerivation"); }

    @Test
    void aMethodReferenceToRandomnessFails() { assertClockRuleFlags("MethodRefRandomDerivation"); }

    @Test
    void newDateWithoutAnInstantFails() { assertClockRuleFlags("DateConstructorDerivation"); }

    @Test
    void anySecureRandomConstructorFails() { assertClockRuleFlags("SeededSecureRandomDerivation"); }

    @Test
    void anUnseededRandomFails() { assertClockRuleFlags("UnseededRandomDerivation"); }

    @Test
    void anUnseededSplittableRandomFails() { assertClockRuleFlags("UnseededSplittableRandomDerivation"); }

    @Test
    void seededGeneratorsAndExplicitInstantDatesPass() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .message().doesNotContain("DeterministicConstructorsDerivation");
    }

    @Test
    void aFoundationReachingIntoAnotherFoundationFails() {
        assertThatThrownBy(() -> RULES.foundationIsolated("pets").check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("archfixtures.pets.ReachesIntoIdentity");
    }

    @Test
    void aDerivationUsingSpringFails() {
        assertThatThrownBy(() -> RULES.derivationsDependOnNothingImpure().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("SpringUsingDerivation")
                .message().doesNotContain("PureDerivation");
    }

    @Test
    void aDerivationUsingJooqOrABeanFails() {
        assertThatThrownBy(() -> RULES.derivationsDependOnNothingImpure().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("JooqUsingDerivation")
                .hasMessageContaining("BeanUsingDerivation");
    }

    @Test
    void aWorkerUsingAnApiComponentFails() {
        assertThatThrownBy(() -> RULES.workersDoNotUseApi().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureWorker");
    }

    @Test
    void aRestControllerWithoutTheApiRoleFails() {
        assertThatThrownBy(() -> RULES.restControllersAreApiComponents().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureBareController")
                .message().doesNotContain("FixtureApiController");
    }

    @Test
    void aScheduledMethodOutsideAWorkerComponentFails() {
        assertThatThrownBy(() -> RULES.workerEntryPointsLiveInWorkerComponents().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureStrayScheduled")
                .message().doesNotContain("FixtureWorkerScheduled");
    }

    @Test
    void aQueueListenerOutsideAWorkerComponentFailsToo() {
        assertThatThrownBy(() -> RULES.workerEntryPointsLiveInWorkerComponents(List.of("archfixtures.roles.FixtureListener")).check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureStrayListener")
                .message().doesNotContain("FixtureWorkerListener");
    }

    @Test
    void anApiComponentUsingAWorkerFails() {
        assertThatThrownBy(() -> RULES.apiDoesNotUseWorkers().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("FixtureApi");
    }

    @Test
    void platformReachingIntoAFeatureFails() {
        assertThatThrownBy(() -> RULES.platformDependsOnNoFeature().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("UsesIdentity");
    }

    @Test
    void aFoundationReachingIntoAVerticalFails() {
        assertThatThrownBy(() -> RULES.foundationIsolated("identity").check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("ReachesIntoCases");
    }

    @Test
    void aVerticalReachingIntoAnotherFails() {
        assertThatThrownBy(() -> RULES.verticalIsolated("help").check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("UsesCases");
    }

    @Test
    void anUnknownTopLevelPackageFails() {
        assertThatThrownBy(() -> RULES.onlyKnownTopLevelPackages().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("archfixtures.stray.Thing");
    }

    @Test
    void anUndeclaredCrossFeatureUseFailsAndADeclaredOnePasses() {
        assertThatThrownBy(() -> RULES.moduleApi("identity").check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("archfixtures.identity.Internal")
                .message().doesNotContain("Exposed");
    }

    @Test
    void aClassOutsideTheAllowedOneUsingThePostgresDriverFailsAndTheAllowedOnePasses() {
        assertThatThrownBy(() -> RULES.onlyKnowsThePostgresDriver("archfixtures.platform.db.TheAllowedDriverUser").check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("archfixtures.cases.UsesDriver")
                .message().doesNotContain("TheAllowedDriverUser.isIt");
    }
}
