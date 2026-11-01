package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;

/** An item of the contract's Pets (web/src/contracts/owner.ts · petWire). Every field present. */
record MyPetView(String id, String name, String species, @Nullable String size, List<String> colors, @Nullable String marks,
                 List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String reopenableCaseCode) {}
