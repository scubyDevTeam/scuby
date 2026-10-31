package co.scuby.identity;

import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Runs before Spring Security so even a 401/403 answer sets the device cookie. */
@Configuration(proxyBeanMethods = false)
class DeviceCookieConfiguration {

    @Bean
    FilterRegistrationBean<DeviceCookieFilter> deviceCookieFilter(CookieProperties cookies) {
        var registration = new FilterRegistrationBean<>(new DeviceCookieFilter(cookies));
        registration.setOrder(SecurityFilterProperties.DEFAULT_FILTER_ORDER - 10);
        return registration;
    }
}
