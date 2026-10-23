package co.scuby.platform.roles;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class RolesTest {

    @WorkerComponent static class SampleWorker {}
    @ApiComponent static class SampleApi {}

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(SampleWorker.class, SampleApi.class);

    @Test
    void bothRolesRunWhenNothingIsConfigured() {
        runner.run(ctx -> {
            assertThat(ctx).hasSingleBean(SampleWorker.class);
            assertThat(ctx).hasSingleBean(SampleApi.class);
        });
    }

    @Test
    void workerOffLeavesApiOn() {
        runner.withPropertyValues("scuby.roles.worker=false").run(ctx -> {
            assertThat(ctx).doesNotHaveBean(SampleWorker.class);
            assertThat(ctx).hasSingleBean(SampleApi.class);
        });
    }

    @Test
    void apiOffLeavesWorkerOn() {
        runner.withPropertyValues("scuby.roles.api=false").run(ctx -> {
            assertThat(ctx).doesNotHaveBean(SampleApi.class);
            assertThat(ctx).hasSingleBean(SampleWorker.class);
        });
    }
}
