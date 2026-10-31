package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PhotoAttachmentsTest {

    @Autowired PhotoAttachments attachments;
    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired MutableClock clock;
    @Autowired co.scuby.support.Accounts accounts;

    @Autowired org.springframework.transaction.support.TransactionTemplate tx;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    /** Takes a slot as this browser, optionally sends the bytes; returns the photo URL and the browser's Caller. */
    private Map.Entry<String, Caller> upload(String purpose, boolean sendBytes) {
        byte[] bytes = UploadsTest.photo();
        String sha = Hashing.sha256Hex(bytes);
        var slot = api.post("/uploads", UploadsTest.slotBody(purpose, sha, bytes.length));
        if (sendBytes) api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        Caller caller = new Caller(null, Hashing.sha256Hex(api.cookie("device").orElseThrow()), "i".repeat(64));
        return Map.entry(slot.str("/url"), caller);
    }

    private String reasonOf(ApiException e) {
        return String.valueOf(e.getBody().getProperties().get("fields"));
    }

    @Test
    void aProcessedPhotoThisCallerUploadedForThisPurposeIsAccepted() {
        var up = upload("sighting", true);
        assertThatCode(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .doesNotThrowAnyException();
    }

    @Test
    void anotherCallersPhotoIsRefused() {
        var up = upload("sighting", true);
        Caller stranger = new Caller(null, "e".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, stranger, "photo_urls"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(reasonOf(e)).contains("photo_urls"));
    }

    @Test
    void anotherPurposeIsRefused() {
        var up = upload("sighting", true);
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.claim, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void unprocessedBytesAreRefused() {
        var up = upload("sighting", false);
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aSlotOlderThanTheAttachWindowIsRefused() {
        var up = upload("sighting", true);
        clock.advance(Duration.ofHours(24).plusSeconds(1));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aForeignUrlIsRefusedAndAnEmptyListPasses() {
        Caller c = new Caller(UUID.randomUUID(), "d".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of("https://evil.example/x.jpg"), UploadPurpose.sighting, c, "photo_urls"))
                .isInstanceOf(ApiException.class);
        assertThatCode(() -> attachments.requireAttachable(List.of(), UploadPurpose.sighting, c, "photo_urls")).doesNotThrowAnyException();
    }

    @Test
    void refusesToRunInsideATransaction() {
        var up = upload("sighting", true);
        assertThatThrownBy(() -> tx.executeWithoutResult(s ->
                attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls")))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }

    /** The Caller of a browser, with the person it is signed in as (null: anonymous). */
    private Caller callerOf(ApiClient browser, UUID person) {
        return new Caller(person, Hashing.sha256Hex(browser.cookie("device").orElseThrow()), "i".repeat(64));
    }

    @Test
    void aSignedInCallersPetSlotAttaches() {
        UUID ana = accounts.signIn(api, "ana@correo.co");
        var up = upload("pet", true);
        Caller signedIn = callerOf(api, ana);
        assertThat(signedIn.ownerKey()).startsWith("p:");
        assertThatCode(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.pet, signedIn, "photo_urls"))
                .doesNotThrowAnyException();
    }

    @Test
    void anotherAccountsSlotIsRefusedEvenOnTheSameDevice() {
        UUID ana = accounts.signIn(api, "ana@correo.co");
        var up = upload("pet", true);
        UUID luis = accounts.person("luis@correo.co");
        Caller otherAccount = new Caller(luis, "f".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.pet, otherAccount, "photo_urls"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(reasonOf(e)).contains("photo_urls"));
        assertThat(ana).isNotEqualTo(luis);
    }

    /** Brief behaviour: a slot taken as a device before sign-in still counts on that device after sign-in. */
    @Test
    void aDeviceSlotTakenBeforeSignInStillAttachesAfterSignIn() {
        var up = upload("sighting", true);
        UUID ana = accounts.signIn(api, "ana@correo.co");
        Caller afterSignIn = callerOf(api, ana);
        assertThatCode(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, afterSignIn, "photo_urls"))
                .doesNotThrowAnyException();
    }
}
