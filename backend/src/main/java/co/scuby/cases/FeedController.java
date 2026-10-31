package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

@ApiComponent
@RestController
class FeedController {

    private final FeedReads reads;

    FeedController(FeedReads reads) {
        this.reads = reads;
    }

    @GetMapping("/feed")
    FeedView feed(@Valid FeedQuery query, Locale locale) {
        return reads.feed(query, locale);
    }
}
