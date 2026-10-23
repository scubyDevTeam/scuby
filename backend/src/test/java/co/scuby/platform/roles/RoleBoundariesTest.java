package co.scuby.platform.roles;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "co.scuby")
class RoleBoundariesTest {

    @ArchTest
    static final ArchRule workerDoesNotUseApi = noClasses()
            .that().resideInAPackage("co.scuby..worker..")
            .should().dependOnClassesThat().resideInAPackage("co.scuby..api..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule apiDoesNotUseWorker = noClasses()
            .that().resideInAPackage("co.scuby..api..")
            .should().dependOnClassesThat().resideInAPackage("co.scuby..worker..")
            .allowEmptyShould(true);
}
