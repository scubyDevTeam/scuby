package co.scuby.support;

import co.scuby.contract.ContractValidator;
import org.springframework.test.web.servlet.MockMvc;

public final class ApiClients {

    private static final ContractValidator CONTRACT = ContractValidator.load();

    private final MockMvc mvc;
    private final StatementRecorder recorder;
    private final ConnectionSampler sampler;

    ApiClients(MockMvc mvc, StatementRecorder recorder, ConnectionSampler sampler) {
        this.mvc = mvc;
        this.recorder = recorder;
        this.sampler = sampler;
    }

    /** A fresh browser: no cookies. */
    public ApiClient newBrowser() {
        return new ApiClient(mvc, CONTRACT, recorder, sampler);
    }
}
