package co.scuby.identity;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;

/** The log senders (local, test, staging) keep the code in the log but never a full address or number. */
class LogSendersTest {

    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private Logger emailLogger;
    private Logger smsLogger;

    @BeforeEach
    void capture() {
        appender.start();
        emailLogger = (Logger) LoggerFactory.getLogger(LogEmailSender.class);
        smsLogger = (Logger) LoggerFactory.getLogger(LogSmsSender.class);
        for (Logger l : new Logger[] {emailLogger, smsLogger}) {
            l.setLevel(Level.INFO);
            l.addAppender(appender);
        }
    }

    @AfterEach
    void release() {
        emailLogger.detachAppender(appender);
        smsLogger.detachAppender(appender);
        appender.stop();
    }

    @Test
    void theEmailSenderLogsTheCodeButMasksTheAddress() {
        new LogEmailSender().sendSignInCode("ana.gomez@correo.co", "123456");
        String line = appender.list.getFirst().getFormattedMessage();
        assertThat(line).contains("123456").contains("a***@correo.co").doesNotContain("ana.gomez");
    }

    @Test
    void theSmsSenderLogsTheCodeButOnlyTheLastFourDigits() {
        new LogSmsSender().sendCode("+573007152284", "654321");
        String line = appender.list.getFirst().getFormattedMessage();
        assertThat(line).contains("654321").contains("***2284").doesNotContain("3007152284").doesNotContain("+57");
    }

    @Test
    void anOddRecipientNeverLeaksWhole() {
        assertThat(LogEmailSender.mask("nonsense")).isEqualTo("***");
        assertThat(LogSmsSender.mask("123")).isEqualTo("***123");
    }
}
