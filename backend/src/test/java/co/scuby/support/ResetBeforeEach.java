package co.scuby.support;

import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.springframework.test.context.junit.jupiter.SpringExtension;

/** Registered by @IntegrationTest: every test starts from TestDb.reset(), so a class cannot forget it. */
final class ResetBeforeEach implements BeforeEachCallback {

    @Override
    public void beforeEach(ExtensionContext context) {
        SpringExtension.getApplicationContext(context).getBean(TestDb.class).reset();
    }
}
