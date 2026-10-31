package co.scuby.platform.web;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;

import java.util.List;
import java.util.Locale;

/** Accept-Language → the language of server-composed text (docs/eng/api.md · Language): es (default) or en. */
@Configuration(proxyBeanMethods = false)
public class LocaleConfiguration {

    @Bean
    LocaleResolver localeResolver() {
        AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();
        resolver.setSupportedLocales(List.of(Locale.forLanguageTag("es"), Locale.forLanguageTag("en")));
        resolver.setDefaultLocale(Locale.forLanguageTag("es"));
        return resolver;
    }
}
