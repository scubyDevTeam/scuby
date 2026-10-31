package co.scuby.platform.web;

import co.scuby.TestcontainersConfiguration;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, ApiErrorHandlerTest.Probe.class})
class ApiErrorHandlerTest {

    record Body(@NotBlank String petName) {}

    @TestConfiguration
    @RestController
    static class Probe {
        @Autowired org.jooq.DSLContext db;

        @GetMapping("/probe/conflict")
        void conflict() {
            throw new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "pet already has an active case",
                    Map.of(), Map.of("case_code", "7K3PQ"));
        }

        @GetMapping("/probe/boom")
        void boom() {
            throw new IllegalStateException("unexpected");
        }

        @GetMapping("/probe/forbidden")
        void forbidden() {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        @GetMapping("/probe/empty-message")
        void emptyMessage() {
            throw new ApiException(ErrorCode.NOT_FOUND, "");
        }

        /** A violation as the Postgres driver reports it, detail included (what a naive handler would log). */
        @GetMapping("/probe/db-detail")
        void dbDetail() {
            throw new org.springframework.dao.DataIntegrityViolationException("could not execute statement",
                    new java.sql.SQLException("ERROR: new row violates check constraint \"sighting_client_id_check\"\n"
                            + "  Detail: Failing row contains (+573156677889, note)", "23514"));
        }

        /** A real CHECK violation through the real driver: its own message must carry no row values. */
        @GetMapping("/probe/db-real")
        void dbReal() {
            try {
                insertBadSighting();
            } catch (org.springframework.dao.DataAccessException e) {
                // Rethrown as plain text so the handler logs the driver's own message verbatim.
                throw new IllegalStateException(e.getMessage() + " | " + (e.getCause() == null ? "" : e.getCause().getMessage()));
            }
        }

        private void insertBadSighting() {
            db.execute("insert into scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, contact_phone, client_id) "
                    + "values (gen_random_uuid(), 'ZZZZZ', 1, 1, now(), now(), repeat('a', 64), ?, ?)", "+573156677889", "short");
        }

        @PostMapping("/probe/validate")
        void validate(@Valid @RequestBody Body body) {}
    }

    @Autowired MockMvc mvc;

    private ch.qos.logback.classic.Logger logger;
    private final ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
            new ch.qos.logback.core.read.ListAppender<>();

    @org.junit.jupiter.api.BeforeEach
    void capture() {
        appender.list.clear();
        appender.start();
        logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(ApiErrorHandler.class);
        logger.addAppender(appender);
    }

    @org.junit.jupiter.api.AfterEach
    void release() {
        logger.detachAppender(appender);
        appender.stop();
    }

    /** Message, formatted line and every throwable message/stack line of everything the handler logged. */
    private String everythingLogged() {
        StringBuilder all = new StringBuilder();
        for (var event : appender.list) {
            all.append(event.getFormattedMessage()).append('\n');
            for (var t = event.getThrowableProxy(); t != null; t = t.getCause()) all.append(t.getMessage()).append('\n');
        }
        return all.toString();
    }

    @Test
    void aDatabaseViolationAnswersServerErrorAndNeverLogsTheRowDetail() throws Exception {
        mvc.perform(get("/probe/db-detail")).andExpect(status().isInternalServerError())
           .andExpect(jsonPath("$.error.code").value("server_error"));
        assertThat(appender.list).isNotEmpty();
        assertThat(everythingLogged()).doesNotContain("573156677889").doesNotContain("Failing row").contains("23514");
    }

    @Test
    void theDriverItselfDoesNotPutRowValuesInItsMessage() throws Exception {
        mvc.perform(get("/probe/db-real")).andExpect(status().isInternalServerError());
        assertThat(everythingLogged()).doesNotContain("573156677889").doesNotContain("Failing row")
                .contains("sighting_client_id_check");
    }

    @Test
    void apiExceptionKeepsCodeStatusAndDetails() throws Exception {
        mvc.perform(get("/probe/conflict"))
           .andExpect(status().isConflict())
           .andExpect(jsonPath("$.error.code").value("active_case_exists"))
           .andExpect(jsonPath("$.error.details.case_code").value("7K3PQ"))
           .andExpect(jsonPath("$.error.fields").doesNotExist());
    }

    @Test
    void beanValidationIsValidationFailedWithFields() throws Exception {
        mvc.perform(post("/probe/validate").contentType(MediaType.APPLICATION_JSON).content("{\"pet_name\":\"\"}"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"))
           .andExpect(jsonPath("$.error.fields.pet_name").exists());
    }

    @Test
    void unreadableBodyIsValidationFailed() throws Exception {
        mvc.perform(post("/probe/validate").contentType(MediaType.APPLICATION_JSON).content("{not json"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void unknownRouteIsNotFound() throws Exception {
        mvc.perform(get("/no/such/route"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.error.code").value("not_found"));
    }

    @Test
    void wrongMethodIsValidationFailedInTheEnvelope() throws Exception {
        mvc.perform(post("/probe/conflict"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void anythingElseIsServerErrorWithoutLeakingTheMessage() throws Exception {
        mvc.perform(get("/probe/boom"))
           .andExpect(status().isInternalServerError())
           .andExpect(jsonPath("$.error.code").value("server_error"))
           .andExpect(jsonPath("$.error.message").value("server_error"));
    }

    @Test
    void emptyMessageIsStillSerialized() throws Exception {
        mvc.perform(get("/probe/empty-message"))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.error.message").value(""));
    }

    @Test
    void springForbiddenMapsToForbiddenCode() throws Exception {
        mvc.perform(get("/probe/forbidden"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.error.code").value("forbidden"));
    }
}
