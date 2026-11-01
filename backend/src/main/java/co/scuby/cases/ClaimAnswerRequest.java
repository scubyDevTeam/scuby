package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/** AnswerClaimRequest (web/src/contracts/owner.ts). A string, not an enum: a wrong value is a body error after the claim lookup. */
record ClaimAnswerRequest(@JsonProperty(required = true) @Nullable String status) {}
