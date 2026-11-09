package co.scuby.cases;

import java.util.List;

/** The caller's pet rows (already ordered by the query) → Pets. Pure. A reopenable code only when no case is active. */
final class MyPetsDerivation {

    private MyPetsDerivation() {}

    static List<MyPetView> derive(List<MyPetRow> rows) {
        return rows.stream().map(r -> new MyPetView(r.id().toString(), r.name() == null ? "" : r.name(), r.species(), r.size(),
                r.colors(), r.marks(), r.photoUrls(), r.activeCaseCode(),
                r.activeCaseCode() == null ? r.latestReopenableCode() : null)).toList();
    }
}
