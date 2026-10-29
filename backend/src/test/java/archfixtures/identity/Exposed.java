package archfixtures.identity;

import co.scuby.platform.modules.ModuleApi;

@ModuleApi
public class Exposed {
    public static String value() { return "exposed"; }
    public record Nested(String v) {}
}
