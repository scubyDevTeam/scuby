package co.scuby.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Stands in for SmsSender in tests (registered @Primary by IdentityTestBeans). */
public class RecordingSmsSender {

    public record Sent(String phone, String code) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();

    private volatile Consumer<Sent> hook = s -> {};

    /** Runs inside every send, on the sending thread (cleared by clear()): lets a test observe the sender's context. */
    public void onSend(Consumer<Sent> hook) { this.hook = hook; }

    public void record(String phone, String code) {
        Sent s = new Sent(phone, code);
        hook.accept(s);
        sent.add(s);
    }

    public List<Sent> sent() { return List.copyOf(sent); }

    public String lastCodeFor(String phone) {
        return sent.reversed().stream().filter(s -> s.phone().equals(phone)).findFirst()
                   .orElseThrow(() -> new AssertionError("no SMS sent to " + phone)).code();
    }

    public void clear() {
        sent.clear();
        hook = s -> {};
    }
}
