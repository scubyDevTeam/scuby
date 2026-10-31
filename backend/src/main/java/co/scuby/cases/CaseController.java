package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

@ApiComponent
@RestController
class CaseController {

    private final CaseReads reads;

    CaseController(CaseReads reads) {
        this.reads = reads;
    }

    @GetMapping("/cases/{code}")
    LostCaseView get(@PathVariable String code, Caller caller, Locale locale) {
        return reads.view(code, caller, locale);
    }
}
