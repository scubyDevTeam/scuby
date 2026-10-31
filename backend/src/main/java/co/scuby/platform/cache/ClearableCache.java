package co.scuby.platform.cache;

/** An in-process cache. Tests clear every one between cases; nothing in production calls clear(). */
public interface ClearableCache {
    void clear();
}
