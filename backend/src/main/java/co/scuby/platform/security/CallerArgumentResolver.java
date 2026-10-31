package co.scuby.platform.security;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.util.UUID;

final class CallerArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        Class<?> type = parameter.getParameterType();
        return type == Caller.class || type == Account.class;
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav,
                                  NativeWebRequest webRequest, WebDataBinderFactory binders) {
        UUID person = SecurityContextHolder.getContext().getAuthentication() instanceof SignedInAuthentication s
                ? s.personId() : null;
        if (parameter.getParameterType() == Account.class) {
            if (person == null) throw new ApiException(ErrorCode.UNAUTHORIZED, "sign in first");
            return new Account(person);
        }
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        Object device = request.getAttribute(Caller.DEVICE_HASH_ATTRIBUTE);
        if (!(device instanceof String hash)) {
            throw new IllegalStateException("the device-cookie filter did not run for " + request.getRequestURI());
        }
        return new Caller(person, hash);
    }
}
