package co.scuby.support;

import co.scuby.platform.cache.ClearableCache;
import org.jooq.DSLContext;
import org.jooq.ExecuteListenerProvider;
import org.jooq.impl.DefaultExecuteListenerProvider;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import javax.sql.DataSource;

/** Beans every @IntegrationTest gets. Later tasks add recording senders and test keys here. */
@TestConfiguration(proxyBeanMethods = false)
@org.springframework.context.annotation.Import(co.scuby.identity.IdentityTestBeans.class)
public class TestSupportConfiguration {

    @Bean
    @Primary
    MutableClock mutableClock() {
        return new MutableClock();
    }

    @Bean
    StatementRecorder statementRecorder() {
        return new StatementRecorder();
    }

    /** Boot's jOOQ auto-configuration adds every ExecuteListenerProvider bean to the DSLContext. */
    @Bean
    ExecuteListenerProvider statementRecorderProvider(StatementRecorder recorder) {
        return new DefaultExecuteListenerProvider(recorder);
    }

    @Bean
    ConnectionSampler connectionSampler(ObjectProvider<DataSource> dataSource) {
        return new ConnectionSampler(dataSource);
    }

    @Bean
    ApiClients apiClients(MockMvc mvc, StatementRecorder recorder, ConnectionSampler sampler) {
        return new ApiClients(mvc, recorder, sampler);
    }

    @Bean
    WebMvcConfigurer connectionSamplerRegistration(ConnectionSampler sampler) {
        return new WebMvcConfigurer() {
            @Override public void addInterceptors(InterceptorRegistry registry) { registry.addInterceptor(sampler); }
        };
    }

    @Bean
    Accounts accounts(DSLContext db, java.time.Clock clock) {
        return new Accounts(db, clock);
    }

    @Bean
    CaseFixtures caseFixtures(DSLContext db) {
        return new CaseFixtures(db);
    }

    @Bean
    TestDb testDb(DSLContext db, ObjectProvider<ClearableCache> caches, MutableClock clock, StatementRecorder recorder,
                  ConnectionSampler sampler,
                  ObjectProvider<RecordingEmailSender> emails, ObjectProvider<RecordingSmsSender> sms) {
        return new TestDb(db, caches, clock, recorder, sampler, emails, sms);
    }
}
