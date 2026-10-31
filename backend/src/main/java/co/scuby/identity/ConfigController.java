package co.scuby.identity;

import co.scuby.platform.roles.ApiComponent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class ConfigController {

    private final SupportedCountries countries;

    ConfigController(SupportedCountries countries) {
        this.countries = countries;
    }

    @GetMapping("/config")
    ConfigView config() {
        return ConfigView.of(countries.all());
    }
}
