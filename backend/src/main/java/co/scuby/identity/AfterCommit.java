package co.scuby.identity;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Runs an action once the surrounding transaction has committed (at once when none is open). Used to send
 * codes: a provider call inside the transaction would hold row/advisory locks and a pooled connection for
 * the length of an HTTP call, and a rollback after it would leave a texted code that was never stored.
 * If the action throws, the exception reaches the caller of the transaction (a send failure stays a
 * server_error) and the stored code is simply left unused.
 */
final class AfterCommit {

    private AfterCommit() {}

    static void run(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            action.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { action.run(); }
        });
    }
}
