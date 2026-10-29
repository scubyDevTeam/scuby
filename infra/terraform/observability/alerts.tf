resource "newrelic_alert_policy" "backend" {
  name                = "scuby-backend"
  incident_preference = "PER_CONDITION"
}

# A count, not a rate: at launch volume one 500 out of two requests would be a 50% "error rate".
resource "newrelic_nrql_alert_condition" "server_errors" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "More than 5 server errors in 5 minutes"
  type                         = "static"
  aggregation_window           = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT filter(count(http.server.requests), WHERE status LIKE '5%') FROM Metric WHERE ${local.svc} AND ${local.alert_env} FACET deployment.environment"
  }
  critical {
    operator              = "above"
    threshold             = 5
    threshold_duration    = 300
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "latency_p95" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "p95 latency above 1 s"
  type                         = "static"
  aggregation_window           = 300
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT percentile(http.server.requests, 95) FROM Metric WHERE ${local.svc} AND ${local.alert_env} AND uri NOT LIKE '/actuator%' FACET deployment.environment"
  }
  critical {
    operator              = "above"
    threshold             = 1000 # milliseconds
    threshold_duration    = 600
    threshold_occurrences = "all"
  }
}

resource "newrelic_nrql_alert_condition" "no_data" {
  policy_id                      = newrelic_alert_policy.backend.id
  name                           = "Backend sends no data"
  enabled                        = var.no_data_alert_enabled
  type                           = "static"
  aggregation_window             = 300
  violation_time_limit_seconds   = 86400
  expiration_duration            = 900
  open_violation_on_expiration   = true
  close_violations_on_expiration = false
  nrql {
    query = "SELECT count(*) FROM Metric WHERE ${local.svc} AND ${local.alert_env} FACET deployment.environment"
  }
  critical {
    operator              = "below"
    threshold             = 1
    threshold_duration    = 900
    threshold_occurrences = "all"
  }
}

# NrMTDConsumption arrives about hourly, so windows close on a timer (20 min after the hourly point),
# not on the next event. max() equals latest() here: the month-to-date value only grows within a month.
resource "newrelic_nrql_alert_condition" "monthly_ingest_50" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "New Relic ingest this month above 50 GB"
  type                         = "static"
  aggregation_method           = "event_timer"
  aggregation_timer            = 1200
  aggregation_window           = 3600
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT max(GigabytesIngested) FROM NrMTDConsumption WHERE productLine = 'DataPlatform'"
  }
  critical {
    operator              = "above"
    threshold             = 50
    threshold_duration    = 3600
    threshold_occurrences = "at_least_once"
  }
}

resource "newrelic_nrql_alert_condition" "monthly_ingest_80" {
  policy_id                    = newrelic_alert_policy.backend.id
  name                         = "New Relic ingest this month above 80 GB"
  type                         = "static"
  aggregation_method           = "event_timer"
  aggregation_timer            = 1200
  aggregation_window           = 3600
  violation_time_limit_seconds = 86400
  nrql {
    query = "SELECT max(GigabytesIngested) FROM NrMTDConsumption WHERE productLine = 'DataPlatform'"
  }
  critical {
    operator              = "above"
    threshold             = 80
    threshold_duration    = 3600
    threshold_occurrences = "at_least_once"
  }
}

moved {
  from = newrelic_nrql_alert_condition.monthly_ingest
  to   = newrelic_nrql_alert_condition.monthly_ingest_80
}

resource "newrelic_notification_destination" "email" {
  name = "scuby email"
  type = "EMAIL"
  property {
    key   = "email"
    value = var.alert_email
  }
}

resource "newrelic_notification_channel" "email" {
  name           = "scuby email"
  type           = "EMAIL"
  destination_id = newrelic_notification_destination.email.id
  product        = "IINT"
  property {
    key   = "subject"
    value = "Scuby: {{issueTitle}}"
  }
}

resource "newrelic_workflow" "backend" {
  name                  = "scuby-backend to email"
  muting_rules_handling = "NOTIFY_ALL_ISSUES"
  issues_filter {
    name = "scuby-backend policy"
    type = "FILTER"
    predicate {
      attribute = "labels.policyIds"
      operator  = "EXACTLY_MATCHES"
      values    = [newrelic_alert_policy.backend.id]
    }
  }
  destination {
    channel_id = newrelic_notification_channel.email.id
  }
}
