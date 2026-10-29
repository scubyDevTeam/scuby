package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Stands in for EmailSender in tests (registered @Primary by TestSupportConfiguration). */
public class RecordingEmailSender {

    public record Sent(String email, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    public void record(String email, String code) { sent.add(new Sent(email, code)); }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String email) {
        return sent.reversed().stream().filter(s -> s.email().equals(email)).findFirst()
                   .orElseThrow(() -> new AssertionError("no code sent to " + email)).code();
    }

    public void clear() { sent.clear(); }
}
