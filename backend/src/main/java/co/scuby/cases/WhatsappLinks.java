package co.scuby.cases;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** A wa.me link with a prefilled text. Not a derivation: it encodes with java.net (the rule of what to send is ClaimDerivation's). */
final class WhatsappLinks {

    private WhatsappLinks() {}

    /** https://wa.me/&lt;digits&gt;?text=&lt;UTF-8, percent-encoded; spaces as %20&gt;. */
    static String withText(String e164, String text) {
        return PublicTextDerivation.whatsappUrl(e164) + "?text=" + URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
