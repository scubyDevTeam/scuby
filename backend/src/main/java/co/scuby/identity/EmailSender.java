package co.scuby.identity;

/** The email channel for sign-in codes. Real provider: open item O23 (leaning SES). */
interface EmailSender {
    void sendSignInCode(String email, String code);
}
