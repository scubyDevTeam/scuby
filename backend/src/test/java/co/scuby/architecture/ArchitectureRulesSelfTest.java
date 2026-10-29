package co.scuby.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Each rule must fail on a fixture that breaks it — a rule that never fails guards nothing. */
class ArchitectureRulesSelfTest {

    private static final JavaClasses FIXTURES = new ClassFileImporter().importPackages("archfixtures");
    /** Fixtures have one foundation and two verticals, so vertical → vertical can be broken on purpose. */
    private static final ArchitectureRules RULES =
            new ArchitectureRules("archfixtures", List.of("identity"), List.of("cases", "help"));

    @Test
    void aDerivationReadingTheClockFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class).hasMessageContaining("ClockReadingDerivation")
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
    void aDerivationUsingClockSystemSecureRandomUuidMathRandomOrAMethodReferenceFails() {
        assertThatThrownBy(() -> RULES.derivationsReadNoClockOrRandomness().check(FIXTURES))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("OtherSneakyDerivation")
                .hasMessageContaining("java.time.Clock.system(java.time.ZoneId)")
                .hasMessageContaining("java.util.UUID.randomUUID()")
                .hasMessageContaining("java.lang.Math.random()")
                .hasMessageContaining("java.security.SecureRandom.<init>()")
                .hasMessageContaining("java.time.Instant.now()");
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
                .hasMessageContaining("Internal")
                .message().doesNotContain("Exposed");
    }
}
