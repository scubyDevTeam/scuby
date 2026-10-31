package archfixtures.cases;

import org.springframework.util.StringUtils;

public class SpringUsingDerivation {
    public static boolean derive(String s) { return StringUtils.hasText(s); }
}
