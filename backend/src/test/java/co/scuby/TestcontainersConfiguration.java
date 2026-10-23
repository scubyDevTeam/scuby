package co.scuby;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Path;

/**
 * One PostGIS container per test JVM, built from the project image (infra/docker/postgres).
 * Spring's context cache shares it across every test class that imports this configuration.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    private static final Path DOCKERFILE = Path.of("..", "infra", "docker", "postgres", "Dockerfile");

    private static final PostgreSQLContainer POSTGRES = start();

    private static PostgreSQLContainer start() {
        String image = new ImageFromDockerfile("scuby/postgres", false)
                .withDockerfile(DOCKERFILE)
                .get();
        PostgreSQLContainer container =
                new PostgreSQLContainer(DockerImageName.parse(image).asCompatibleSubstituteFor("postgres"));
        container.start(); // stopped by Ryuk when the JVM exits
        return container;
    }

    // destroyMethod "" keeps a closing Spring context from stopping the container other contexts still use.
    @Bean(destroyMethod = "")
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return POSTGRES;
    }
}
