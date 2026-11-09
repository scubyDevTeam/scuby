package co.scuby.cases;

import org.jspecify.annotations.Nullable;

/** The contract's Claim: the claim's id and, under the public-contact rule, the owner's WhatsApp link with the prefilled text. */
record ClaimCreatedView(String id, @Nullable String whatsappUrl) {}
