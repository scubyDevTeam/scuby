package co.scuby.support;

/** The client mock's `kira` publish body (web/src/mocks/backend.test.ts). */
public final class PublishBodies {

    private PublishBodies() {}

    public static String kira(String phone, String otpCode) {
        return kira(phone, otpCode, "[]", "2026-10-14T08:00:00-05:00", 300);
    }

    public static String kira(String phone, String otpCode, String photoUrlsJson, String lastSeenAt, double radius) {
        return """
                {"pet_id":null,
                 "pet":{"name":"Kira","species":"dog","size":"medium","colors":["brown"],"marks":null,"chip_number":null,"photo_urls":%s},
                 "last_seen_point":{"lat":6.2447,"lng":-75.5916},"last_seen_radius_m":%s,"last_seen_at":"%s",
                 "phone":%s,"phone_has_whatsapp":true,
                 "contact_prefs":{"expose_whatsapp":true,"expose_email":false,"in_app_only":false},
                 "otp_code":%s}""".formatted(photoUrlsJson, radius, lastSeenAt, json(phone), json(otpCode));
    }

    public static String withPetId(String petId, String phone) {
        return kira(phone, null).replace("\"pet_id\":null", "\"pet_id\":\"" + petId + "\"");
    }

    private static String json(String s) {
        return s == null ? "null" : "\"" + s + "\"";
    }
}
