package co.scuby.platform.modules;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The declared public surface of a feature: a class used from another feature carries this
 * annotation (classes nested in it count). Everything else stays package-private. Enforced by
 * ArchitectureTest (docs/eng/backend.md · Code structure).
 */
@Documented
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ModuleApi {}
