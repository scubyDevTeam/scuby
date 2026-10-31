package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;

@ApiComponent
@RestController
class MyCasesController {

    private final MyCasesQueries queries;

    MyCasesController(MyCasesQueries queries) {
        this.queries = queries;
    }

    /** The contract's listMyCases: no transaction, one autocommit read. */
    @GetMapping("/me/cases")
    List<MyCaseView> mine(Account account, Locale locale) {
        return MyCasesDerivation.derive(queries.fetch(account.personId()), locale);
    }
}
