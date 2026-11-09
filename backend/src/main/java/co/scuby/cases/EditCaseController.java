package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * editCase, for found, adoption and help cases (L1 design §4.2). None of those verticals has a table yet and a lost code
 * uses editLost, so every code is not_found, without a query. The body is not bound (no schema to read it against). The
 * route exists so the contract is complete; the verticals' CaseKind implementations replace it.
 */
@ApiComponent
@RestController
class EditCaseController {

    @PatchMapping("/cases/{code}")
    void edit(@PathVariable String code, Account account) {
        throw CaseErrors.notFound();
    }
}
