package co.scuby.platform.crypto;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class HashingTest {

    @Test
    void sha256IsLowercaseHex() {
        assertThat(Hashing.sha256Hex("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    void hmacDependsOnTheKey() {
        assertThat(Hashing.hmacSha256Hex("k1", "203.0.113.10")).hasSize(64)
                .isNotEqualTo(Hashing.hmacSha256Hex("k2", "203.0.113.10"));
    }

    @Test
    void tokensAreUrlSafeAndUnique() {
        String a = Hashing.randomToken(32);
        assertThat(a).matches("^[A-Za-z0-9_-]{43}$").isNotEqualTo(Hashing.randomToken(32));
    }

    @Test
    void digitsKeepLeadingZeros() {
        for (int i = 0; i < 200; i++) assertThat(Hashing.randomDigits(6)).matches("^\\d{6}$");
    }
}
