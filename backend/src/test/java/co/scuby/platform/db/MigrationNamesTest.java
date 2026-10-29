package co.scuby.platform.db;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration versions are timestamps (V&lt;yyyyMMdd&gt;_&lt;HHmm&gt;__what.sql) so branches that add migrations in
 * parallel never pick the same number; the two original files, V1 and V2, predate the rule. A branch that merges
 * after another has already deployed a later timestamp is still applied, because Flyway runs with
 * out-of-order enabled (migrations must therefore be independent of one another).
 */
class MigrationNamesTest {

    static final Pattern NAME = Pattern.compile("(V1|V2|V\\d{8}_\\d{4})__[a-z0-9_]+\\.sql");

    @Test
    void everyMigrationFollowsTheNamingConvention() throws Exception {
        Resource[] files = new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/*");
        assertThat(files).isNotEmpty();
        List<String> bad = java.util.Arrays.stream(files).map(Resource::getFilename)
                .filter(n -> !NAME.matcher(n).matches()).toList();
        assertThat(bad).as("migration files not named V<yyyyMMdd>_<HHmm>__lower_snake_case.sql").isEmpty();
    }

    @Test
    void theConventionRejectsNumberedAndMisspelledNames() {
        for (String bad : new String[] {"V3__x.sql", "V20261029__x.sql", "V20261029_1030_x.sql", "V20261029_1030__X.sql",
                "v20261029_1030__x.sql", "V20261029_1030__x.SQL", "V20261029_1030__a-b.sql", "R__repeatable.sql"}) {
            assertThat(NAME.matcher(bad).matches()).as(bad).isFalse();
        }
        assertThat(NAME.matcher("V20261029_1030__email_codes.sql").matches()).isTrue();
    }

    @Test
    void flywayAppliesAMigrationThatSortsBelowOnesAlreadyApplied() {
        var yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        assertThat(yaml.getObject().getProperty("spring.flyway.out-of-order"))
                .as("spring.flyway.out-of-order in application.yml").isEqualTo("true");
    }
}
