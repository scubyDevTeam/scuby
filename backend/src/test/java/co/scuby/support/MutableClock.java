package co.scuby.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** The app's clock in tests. Starts at the client mock's frozen instant (2026-10-14 12:00 -05:00). */
public final class MutableClock extends Clock {

    public static final Instant START = Instant.parse("2026-10-14T17:00:00Z");

    private volatile Instant now = START;

    @Override public ZoneId getZone() { return ZoneOffset.UTC; }

    @Override public Clock withZone(ZoneId zone) { return this; }

    @Override public Instant instant() { return now; }

    public void set(Instant instant) { now = instant; }

    public void advance(Duration duration) { now = now.plus(duration); }

    public void reset() { now = START; }
}
