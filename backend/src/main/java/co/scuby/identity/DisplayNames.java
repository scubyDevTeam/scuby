package co.scuby.identity;

import java.util.Arrays;
import java.util.stream.Collectors;

/** «juan.perez@correo.co» → «Juan Perez» until the person names themselves (as the client mock: web/src/mocks/rules.ts). */
final class DisplayNames {

    private DisplayNames() {}

    static String fromEmail(String email) {
        String local = email.substring(0, Math.max(email.indexOf('@'), 0));
        String name = Arrays.stream(local.split("[._-]+"))
                            .filter(p -> !p.isEmpty())
                            .map(p -> Character.toUpperCase(p.charAt(0)) + p.substring(1))
                            .collect(Collectors.joining(" "));
        String result = name.isBlank() ? local : name;
        return result.length() > 80 ? result.substring(0, 80) : result;
    }
}
