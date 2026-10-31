package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Stands in for EmailSender in tests (registered @Primary by TestSupportConfiguration). */
public class RecordingEmailSender {

    public record Sent(String email, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    private volatile Consumer<Sent> hook = s -> {};

    /** Runs inside every send, on the sending thread (cleared by clear()): lets a test observe the sender's context. */
    public void onSend(Consumer<Sent> hook) { this.hook = hook; }

    public void record(String email, String code) {
        Sent s = new Sent(email, code);
        hook.accept(s);
        sent.add(s);
    }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String email) {
        return sent.reversed().stream().filter(s -> s.email().equals(email)).findFirst()
                   .orElseThrow(() -> new AssertionError("no code sent to " + email)).code();
    }

    public void clear() {
        sent.clear();
        hook = s -> {};
    }
}
