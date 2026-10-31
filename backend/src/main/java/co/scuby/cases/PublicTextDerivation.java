package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/** Text the server composes for display, in the request's language (es default, en). Pure. */
final class PublicTextDerivation {

    private PublicTextDerivation() {}

    private static final Map<String, String> SPECIES_ES = Map.of("dog", "perro", "cat", "gato", "other", "animal");
    private static final Map<String, String> SPECIES_EN = Map.of("dog", "dog", "cat", "cat", "other", "animal");
    private static final Map<String, String> SIZE_ES = Map.of("small", "pequeño", "medium", "mediano", "large", "grande");
    private static final Map<String, String> SIZE_EN = Map.of("small", "small", "medium", "medium", "large", "large");
    private static final Map<String, String> COLOR_ES = Map.of("black", "negro", "white", "blanco", "brown", "café",
            "tan", "canela", "gray", "gris", "yellow", "amarillo", "orange", "naranja");
    private static final Map<String, String> COLOR_EN = Map.of("black", "black", "white", "white", "brown", "brown",
            "tan", "tan", "gray", "gray", "yellow", "yellow", "orange", "orange");

    static boolean english(Locale locale) {
        return "en".equals(locale.getLanguage());
    }

    /** «Carolina Mejía» → «Carolina M.»: the public face of a publisher (as the client mock). */
    static String publicName(String displayName) {
        String[] parts = displayName.strip().split("\\s+");
        if (parts.length < 2) return parts[0];
        return parts[0] + " " + Character.toUpperCase(parts[1].charAt(0)) + ".";
    }

    static String placeName(@Nullable String stored, Locale locale) {
        if (stored != null) return stored;
        return english(locale) ? "Area marked on the map" : "Zona marcada en el mapa";
    }

    /** «Perro · Mediano · Negro y canela». */
    static String summary(String species, @Nullable String size, List<String> colors, Locale locale) {
        boolean en = english(locale);
        String and = en ? " and " : " y ";
        List<String> named = colors.stream().map(c -> (en ? COLOR_EN : COLOR_ES).get(c)).toList();
        String colorText = named.isEmpty() ? null
                : named.size() == 1 ? named.getFirst()
                : String.join(", ", named.subList(0, named.size() - 1)) + and + named.getLast();
        return java.util.stream.Stream.of((en ? SPECIES_EN : SPECIES_ES).get(species),
                        size == null ? null : (en ? SIZE_EN : SIZE_ES).get(size), colorText)
                .filter(java.util.Objects::nonNull)
                .map(p -> Character.toUpperCase(p.charAt(0)) + p.substring(1))
                .collect(Collectors.joining(" · "));
    }

    static String whatsappUrl(String e164) {
        return "https://wa.me/" + e164.substring(1);
    }
}
