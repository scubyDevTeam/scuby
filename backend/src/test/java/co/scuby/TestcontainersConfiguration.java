package co.scuby;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Path;
import java.util.Map;

/**
 * Connects every Spring test context that imports it to one PostGIS container per test JVM,
 * built from the project image (infra/docker/postgres/Dockerfile).
 *
 * <p>The container is deliberately not a Spring bean: Spring closes any {@code Startable} bean
 * with its context, which would stop the container under every other cached context. It lives in
 * a static field, is started lazily on first use and is removed by Ryuk when the JVM exits.
 * Contexts only receive its JDBC coordinates through a {@link DynamicPropertyRegistrar}.
 *
 * <p>The Dockerfile path is relative, so tests must run with {@code backend/} as the working
 * directory (the Maven default).
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    private static final Path DOCKERFILE = Path.of("..", "infra", "docker", "postgres", "Dockerfile");

    private static PostgreSQLContainer container;
    private static IllegalStateException failure;

    /** Starts the shared container on first call; later calls return it, or rethrow the first failure. */
    private static synchronized PostgreSQLContainer postgres() {
        if (failure != null) {
            throw failure;
        }
        if (container == null) {
            try {
                String image = new ImageFromDockerfile("scuby/postgres", false)
                        .withDockerfile(DOCKERFILE)
                        .get();
                PostgreSQLContainer started = new PostgreSQLContainer(
                        DockerImageName.parse(image).asCompatibleSubstituteFor("postgres"));
                started.start();
                container = started;
            } catch (Throwable t) {
                failure = new IllegalStateException(
                        "PostGIS test container failed to start (is Docker running? "
                                + "infra/docker/postgres/Dockerfile builds? tests run from backend/?)", t);
                throw failure;
            }
        }
        return container;
    }

    @Bean
    DynamicPropertyRegistrar postgresProperties() {
        return registry -> {
            registry.add("spring.datasource.url", () -> postgres().getJdbcUrl());
            registry.add("spring.datasource.username", () -> postgres().getUsername());
            registry.add("spring.datasource.password", () -> postgres().getPassword());
        };
    }

    /** The shared container's coordinates, for tests that start the app without Spring's test framework. */
    public static Map<String, String> jdbcProperties() {
        return Map.of(
                "spring.datasource.url", postgres().getJdbcUrl(),
                "spring.datasource.username", postgres().getUsername(),
                "spring.datasource.password", postgres().getPassword());
    }
}
