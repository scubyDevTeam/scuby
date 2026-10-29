package co.scuby.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;

/** Guardrails 1–4 on the production code (test classes excluded). */
@AnalyzeClasses(packages = "co.scuby", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    private static final ArchitectureRules RULES = new ArchitectureRules("co.scuby");

    @ArchTest
    void derivationsArePure(JavaClasses classes) {
        RULES.derivationsDependOnNothingImpure().check(classes);
        RULES.derivationsReadNoClockOrRandomness().check(classes);
    }

    @ArchTest
    void rolesStayApart(JavaClasses classes) {
        RULES.workersDoNotUseApi().check(classes);
        RULES.apiDoesNotUseWorkers().check(classes);
    }

    @ArchTest
    void dependenciesFormTheDag(JavaClasses classes) {
        RULES.platformDependsOnNoFeature().check(classes);
        RULES.foundations().forEach(f -> RULES.foundationIsolated(f).check(classes));
        RULES.verticals().forEach(v -> RULES.verticalIsolated(v).check(classes));
        RULES.onlyKnownTopLevelPackages().check(classes);
    }

    @ArchTest
    void crossFeatureUseIsDeclared(JavaClasses classes) {
        RULES.all().forEach(f -> RULES.moduleApi(f).check(classes));
    }
}
