package co.scuby.platform.web;

import co.scuby.TestcontainersConfiguration;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, ApiErrorHandlerTest.Probe.class})
class ApiErrorHandlerTest {

    record Body(@NotBlank String name) {}

    @TestConfiguration
    @RestController
    static class Probe {
        @GetMapping("/probe/conflict")
        void conflict() {
            throw new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "pet already has an active case",
                    Map.of(), Map.of("case_code", "7K3PQ"));
        }

        @GetMapping("/probe/boom")
        void boom() {
            throw new IllegalStateException("unexpected");
        }

        @PostMapping("/probe/validate")
        void validate(@Valid @RequestBody Body body) {}
    }

    @Autowired MockMvc mvc;

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
        mvc.perform(post("/probe/validate").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
           .andExpect(status().isUnprocessableEntity())
           .andExpect(jsonPath("$.error.code").value("validation_failed"))
           .andExpect(jsonPath("$.error.fields.name").exists());
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
}
