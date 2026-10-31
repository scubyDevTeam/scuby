package co.scuby.platform.time;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Cron-style housekeeping (@Scheduled on @WorkerComponent beans). db-scheduler replaces it when cluster-safe jobs are needed. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class SchedulingConfiguration {}
