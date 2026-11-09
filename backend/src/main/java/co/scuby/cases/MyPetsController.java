package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.util.List;

/** listMyPets: no transaction, one autocommit read. In cases because it reads lost_case (L1 design §5). */
@ApiComponent
@RestController
class MyPetsController {

    private final MyPetsQueries queries;
    private final Clock clock;

    MyPetsController(MyPetsQueries queries, Clock clock) {
        this.queries = queries;
        this.clock = clock;
    }

    @GetMapping("/me/pets")
    List<MyPetView> mine(Account account) {
        return MyPetsDerivation.derive(queries.fetch(account.personId(), clock.instant()));
    }
}
