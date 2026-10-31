package co.scuby.platform.security;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;

import java.util.UUID;

/** A signed-in person. No roles yet: who may act on what is each endpoint's own check. */
public final class SignedInAuthentication extends AbstractAuthenticationToken {

    private final UUID personId;

    public SignedInAuthentication(UUID personId) {
        super(AuthorityUtils.NO_AUTHORITIES);
        this.personId = personId;
        setAuthenticated(true);
    }

    public UUID personId() {
        return personId;
    }

    @Override public Object getCredentials() { return ""; }

    @Override public Object getPrincipal() { return personId; }
}
