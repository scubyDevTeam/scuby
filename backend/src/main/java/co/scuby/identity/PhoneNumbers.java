package co.scuby.identity;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import com.google.i18n.phonenumbers.NumberParseException;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.Phonenumber.PhoneNumber;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.regex.Pattern;

/** Server re-check of a mobile number before any send or store (docs/eng/auth.md · OTP mechanics). */
@ModuleApi
@Component
public class PhoneNumbers {

    private static final Pattern E164 = Pattern.compile("^\\+[1-9]\\d{6,14}$");
    private static final String REASON = "not a supported mobile number";

    private final PhoneNumberUtil util = PhoneNumberUtil.getInstance();
    private final SupportedCountries countries;

    PhoneNumbers(SupportedCountries countries) {
        this.countries = countries;
    }

    /** The number in E.164, or validation_failed on {@code field}. */
    public String requireMobile(String e164, String field) {
        if (e164 == null || !E164.matcher(e164).matches()) throw invalid(field);
        SupportedCountries.Country country = countries.forE164(e164).orElseThrow(() -> invalid(field));
        PhoneNumber number;
        try {
            number = util.parse(e164, null);
        } catch (NumberParseException e) {
            throw invalid(field);
        }
        if (!util.isValidNumber(number)) throw invalid(field);
        if (!Pattern.matches(country.mobilePattern(), util.getNationalSignificantNumber(number))) throw invalid(field);
        return util.format(number, PhoneNumberUtil.PhoneNumberFormat.E164);
    }

    private static ApiException invalid(String field) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, REASON, Map.of(field, REASON), Map.of());
    }
}
