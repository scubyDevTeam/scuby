package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.UUID;

/** One of the caller's pets as GET /me/pets reads it (MyPetsQueries): the pet, the caller's active case, the latest reopenable. */
record MyPetRow(UUID id, @Nullable String name, String species, @Nullable String size, List<String> colors,
                @Nullable String marks, List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String latestReopenableCode) {}
