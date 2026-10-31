package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class SightingConcurrencyTest {

    @Autowired SightingService service;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    @BeforeEach
    void setUp() {
        testDb.reset();
        cases.luna(accounts.person("carolina@correo.co"));
    }

    @Test
    void tenParallelReportsFromOneDeviceInsertExactlyFive() throws Exception {
        Caller device = new Caller(null, "7".repeat(64), "8".repeat(64));
        SightingRequest request = new SightingRequest(new PointInput(6.2455, -75.5905),
                OffsetDateTime.ofInstant(MutableClock.START, ZoneOffset.UTC), null, null, null, null);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(10);
        List<Future<Boolean>> results = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            results.add(pool.submit(() -> {
                start.await();
                try {
                    service.report("7K3PQ", request, device);
                    return true;
                } catch (ApiException e) {
                    assertThat(e.code()).isEqualTo(ErrorCode.RATE_LIMITED);
                    return false;
                }
            }));
        }
        start.countDown();
        int created = 0;
        for (Future<Boolean> r : results) if (r.get(60, TimeUnit.SECONDS)) created++;
        pool.shutdown();
        assertThat(created).isEqualTo(5);
    }

    /** Distinct devices share an IP: only the IP lock serialises them, and the IP limit (20 on one case) must hold. */
    @Test
    void twentyFiveParallelReportsFromDistinctDevicesOnOneIpInsertExactlyTwenty() throws Exception {
        SightingRequest request = new SightingRequest(new PointInput(6.2455, -75.5905),
                OffsetDateTime.ofInstant(MutableClock.START, ZoneOffset.UTC), null, null, null, null);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(25);
        List<Future<Boolean>> results = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            Caller device = new Caller(null, "%064d".formatted(i), "9".repeat(64));
            results.add(pool.submit(() -> {
                start.await();
                try {
                    service.report("7K3PQ", request, device);
                    return true;
                } catch (ApiException e) {
                    assertThat(e.code()).isEqualTo(ErrorCode.RATE_LIMITED);
                    return false;
                }
            }));
        }
        start.countDown();
        int created = 0;
        for (Future<Boolean> r : results) if (r.get(60, TimeUnit.SECONDS)) created++;
        pool.shutdown();
        assertThat(created).isEqualTo(20);
    }
}
