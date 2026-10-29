package archfixtures.roles;

import org.springframework.web.bind.annotation.RestController;

/** Breaks the rule: a controller with no role. */
@RestController
public class FixtureBareController {}
