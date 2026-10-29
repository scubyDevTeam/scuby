package co.scuby.support;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.OptionalInt;

/**
 * Samples the pool's active connections after every filter ran and before the controller: a connection
 * still held then means a filter (or something around it) kept a transaction open across the request.
 * Sampling after the request proves nothing — every connection is back by then.
 */
public final class ConnectionSampler implements HandlerInterceptor {

    private final ObjectProvider<DataSource> dataSource;
    private volatile Integer activeAtHandlerStart;

    ConnectionSampler(ObjectProvider<DataSource> dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws SQLException {
        activeAtHandlerStart = dataSource.getObject().unwrap(HikariDataSource.class).getHikariPoolMXBean().getActiveConnections();
        return true;
    }

    /** Empty when no handler ran in the latest request (a filter answered it): never the previous call's value. ApiClient resets the sampler before every request. */
    public OptionalInt activeWhenTheHandlerStarted() {
        Integer v = activeAtHandlerStart;
        return v == null ? OptionalInt.empty() : OptionalInt.of(v);
    }

    public void reset() { activeAtHandlerStart = null; }
}
