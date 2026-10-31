package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class SightingController {

    record Created(String id) {}

    private final SightingService service;

    SightingController(SightingService service) {
        this.service = service;
    }

    /** 201 {id}, also for a replay (the contract lists only 201). */
    @PostMapping("/cases/{code}/sightings")
    @ResponseStatus(HttpStatus.CREATED)
    Created report(@PathVariable String code, Caller caller, @Valid @RequestBody SightingRequest body) {
        return new Created(service.report(code, body, caller).toString());
    }
}
