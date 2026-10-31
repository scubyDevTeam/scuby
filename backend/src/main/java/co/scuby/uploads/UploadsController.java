package co.scuby.uploads;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class UploadsController {

    private final UploadSlots slots;

    UploadsController(UploadSlots slots) {
        this.slots = slots;
    }

    @PostMapping("/uploads")
    @ResponseStatus(HttpStatus.CREATED)
    UploadView slot(Caller caller, @Valid @RequestBody UploadRequest body) {
        return slots.slot(body, caller);
    }
}
