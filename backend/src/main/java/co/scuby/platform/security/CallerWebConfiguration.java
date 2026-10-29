package co.scuby.platform.security;

import co.scuby.platform.web.ClientAddress;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration(proxyBeanMethods = false)
class CallerWebConfiguration implements WebMvcConfigurer {

    private final ClientAddress address;

    CallerWebConfiguration(ClientAddress address) {
        this.address = address;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CallerArgumentResolver(address));
    }
}
