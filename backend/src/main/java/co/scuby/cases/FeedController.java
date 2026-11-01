package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

// The response differs per viewer (possible_find is owner-only): any HTTP cache or CDN in front of /feed must vary on the session.
@ApiComponent
@RestController
class FeedController {

    private final FeedReads reads;

    FeedController(FeedReads reads) {
        this.reads = reads;
    }

    @GetMapping("/feed")
    FeedView feed(@Valid FeedQuery query, Caller caller, Locale locale) {
        return reads.feed(query, caller, locale);
    }
}
