package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Stands in for SmsSender in tests (registered @Primary by IdentityTestBeans). */
public class RecordingSmsSender {

    public record Sent(String phone, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    public void record(String phone, String code) { sent.add(new Sent(phone, code)); }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String phone) {
        return sent.reversed().stream().filter(s -> s.phone().equals(phone)).findFirst()
                   .orElseThrow(() -> new AssertionError("no SMS sent to " + phone)).code();
    }

    public void clear() { sent.clear(); }
}
