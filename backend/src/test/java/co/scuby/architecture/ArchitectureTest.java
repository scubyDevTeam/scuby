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
    void derivationsDependOnNothingImpure(JavaClasses classes) { RULES.derivationsDependOnNothingImpure().check(classes); }

    @ArchTest
    void derivationsReadNoClockOrRandomness(JavaClasses classes) { RULES.derivationsReadNoClockOrRandomness().check(classes); }

    @ArchTest
    void workersDoNotUseApi(JavaClasses classes) { RULES.workersDoNotUseApi().check(classes); }

    @ArchTest
    void apiDoesNotUseWorkers(JavaClasses classes) { RULES.apiDoesNotUseWorkers().check(classes); }

    @ArchTest
    void restControllersAreApiComponents(JavaClasses classes) { RULES.restControllersAreApiComponents().check(classes); }

    @ArchTest
    void workerEntryPointsLiveInWorkerComponents(JavaClasses classes) { RULES.workerEntryPointsLiveInWorkerComponents().check(classes); }

    @ArchTest
    void platformDependsOnNoFeature(JavaClasses classes) { RULES.platformDependsOnNoFeature().check(classes); }

    @ArchTest
    void foundationsAreIsolated(JavaClasses classes) {
        // one check per foundation; the rule's own description names the package on failure
        RULES.foundations().forEach(f -> RULES.foundationIsolated(f).check(classes));
    }

    @ArchTest
    void verticalsAreIsolated(JavaClasses classes) {
        RULES.verticals().forEach(v -> RULES.verticalIsolated(v).check(classes));
    }

    @ArchTest
    void onlyKnownTopLevelPackages(JavaClasses classes) { RULES.onlyKnownTopLevelPackages().check(classes); }

    @ArchTest
    void crossFeatureUseIsDeclared(JavaClasses classes) {
        RULES.all().forEach(f -> RULES.moduleApi(f).check(classes));
    }
}
