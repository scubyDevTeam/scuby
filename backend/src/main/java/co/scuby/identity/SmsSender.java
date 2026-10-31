package co.scuby.identity;

/** The SMS channel for OTP codes. Real provider: open item O23. */
interface SmsSender {
    void sendCode(String e164, String code);
}
