package co.scuby.identity;

import co.scuby.identity.ProfileUpdateRequest.NotificationPrefsInput;
import co.scuby.platform.web.Patch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /me/profile field rules (docs/eng/auth.md · Profile; spec §4.12). Human review: the link rule is this table. */
class ProfileTextDerivationTest {

    static ProfileUpdateRequest only(String field, Patch<?> value) {
        @SuppressWarnings("unchecked") Patch<String> s = (Patch<String>) value;
        return new ProfileUpdateRequest(
                field.equals("display_name") ? s : Patch.absent(),
                field.equals("city") ? s : Patch.absent(),
                field.equals("bio") ? s : Patch.absent(),
                field.equals("notification_prefs") ? (Patch<NotificationPrefsInput>) (Patch<?>) value : Patch.absent(),
                field.equals("photo_url") ? s : Patch.absent());
    }

    @ParameterizedTest(name = "«{0}» → link {1}")
    @CsvSource({
            "'Visita https://scuby.co',                      true",
            "'http://x.co',                                  true",
            "'WWW.ejemplo',                                  true",
            "'escríbeme a wa.me/573001112233',               true",
            "'Tel:3001112233',                               true",
            "'MAILTO:ana@x',                                 true",
            "'mi web: ana.com',                              true",
            "'ana@gmail.com',                                true",
            "'bit.ly/x',                                     true",
            "'miweb.com',                                    true",
            "'Instagram: foo.co',                            true",
            "'WWW.x.org',                                    true",
            "'https://x',                                    true",
            "'wa.me/57300',                                  true",
            "'tel:+573001234567',                            true",
            "'MIWEB.COM',                                    false",
            "'Medellín.Me encanta',                          false",
            "'Tel: 300 123 4567',                            false",
            "'mi tienda: foo.shop',                          true",
            "'Av.Poblado',                                   false",
            "'EE.UU.',                                       false",
            "'caminar.Vivo',                                 false",
            "'p.ej.',                                        false",
            "'1.er',                                         false",
            "'3.5',                                          false",
            "'Hola.Soy',                                     false",
            "'Me gusta caminar. Vivo en Bogotá',             false",
            "'foo.company',                                  false",
            "'Hola. Soy rescatista',                         false",
            "'Pesa 3.5 kg',                                  false",
            "'hotel: Casa Blanca',                           false",
            "'Rescatista de gatos en Envigado.',             false",
            "'e.g. gatos',                                   false",
            "'',                                             false",
    })
    void theBioRefusesExplicitLinkFormsAndKnownTldTokensOnly(String text, boolean link) {
        assertThat(ProfileTextDerivation.hasLink(text)).isEqualTo(link);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(delimiter = '|', value = {
            "wa.me/57300|true", "  www.x.org |true", "mi.com|true", "tel:+57300|true",
            "Ana M.|false", "Medellín.Me encanta|false", "Tel: 300 123|false", "EE.UU.|false"})
    void theDisplayNameHasNoLinksEither(String name, boolean refused) {
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of(name))))
                .isEqualTo(refused ? Map.of("display_name", "no links") : Map.of());
    }

    @Test
    void theNameIsTrimmedAndMustNotBeEmpty() {
        assertThat(ProfileTextDerivation.trimmedName("  Ana María Gómez \t")).isEqualTo("Ana María Gómez");
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of("   ")))).isEqualTo(Map.of("display_name", "must not be empty"));
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of(null)))).isEqualTo(Map.of("display_name", "required"));
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of(" " + "🐶".repeat(80) + " ")))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of("a".repeat(81)))))
                .isEqualTo(Map.of("display_name", "at most 80 characters"));
    }

    @Test
    void cityAndBioLengthsCountCharactersAndNullClears() {
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of("🐶".repeat(80))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of("a".repeat(81))))).isEqualTo(Map.of("city", "at most 80 characters"));
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of(null)))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("a".repeat(280))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("a".repeat(281))))).isEqualTo(Map.of("bio", "at most 280 characters"));
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("Mi web: ana.com")))).isEqualTo(Map.of("bio", "no links"));
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of(null)))).isEmpty();
    }

    @Test
    void notificationPrefsComeAsAllFour() {
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(new NotificationPrefsInput(true, false, true, false))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(null)))).isEqualTo(Map.of("notification_prefs", "required"));
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(new NotificationPrefsInput(null, true, true, null)))))
                .isEqualTo(Map.of("notification_prefs.lost", "required", "notification_prefs.help", "required"));
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(new NotificationPrefsInput(true, null, null, true)))))
                .isEqualTo(Map.of("notification_prefs.found", "required", "notification_prefs.adoption", "required"));
    }

    @Test
    void aPhotoUrlIsNotEmptyAndNullReturnsToTheInitials() {
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of(" ")))).isEqualTo(Map.of("photo_url", "must not be empty"));
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of(null)))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of("http://localhost/dev-media/a.jpg")))).isEmpty();
    }

    @Test
    void anEmptyBodyHasNoProblems() {
        assertThat(ProfileTextDerivation.problems(new ProfileUpdateRequest(Patch.absent(), Patch.absent(), Patch.absent(),
                Patch.absent(), Patch.absent()))).isEmpty();
        assertThat(ProfileTextDerivation.NAME_MAX).isEqualTo(80);
        assertThat(ProfileTextDerivation.BIO_MAX).isEqualTo(280);
        assertThat(ProfileTextDerivation.CITY_MAX).isEqualTo(80);
    }
}
