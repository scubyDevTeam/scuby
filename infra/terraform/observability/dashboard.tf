locals {
  svc       = "service.name = '${var.service_name}'"
  dash_env  = "deployment.environment IN ({{env}})"
  alert_env = "deployment.environment IN (${join(", ", [for e in var.alert_environments : "'${e}'"])})"
}

resource "newrelic_one_dashboard" "backend" {
  name        = "Scuby — Backend"
  permissions = "public_read_write" # every user of the account (both engineers); not public on the internet

  variable {
    name                 = "env"
    title                = "Environment"
    type                 = "enum"
    replacement_strategy = "string"
    is_multi_selection   = true
    default_values       = ["staging", "prod"]
    item {
      title = "staging"
      value = "staging"
    }
    item {
      title = "prod"
      value = "prod"
    }
    item {
      title = "local"
      value = "local"
    }
  }

  page {
    name = "HTTP"
    widget_line {
      title  = "Requests per minute"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT rate(count(http.server.requests), 1 minute) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "Latency p50 / p95 (ms)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT percentile(http.server.requests, 50, 95) FROM Metric WHERE ${local.svc} AND ${local.dash_env} AND uri NOT LIKE '/actuator%' TIMESERIES" }
    }
    widget_line {
      title  = "Server errors (5xx) per minute"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT rate(filter(count(http.server.requests), WHERE status LIKE '5%'), 1 minute) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_table {
      title  = "By route and status"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT count(http.server.requests), percentile(http.server.requests, 95) FROM Metric WHERE ${local.svc} AND ${local.dash_env} FACET uri, status LIMIT 50" }
    }
  }

  page {
    name = "JVM and database"
    widget_line {
      title  = "Heap used by pool (MB)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT average(jvm.memory.used) / 1e6 FROM Metric WHERE ${local.svc} AND ${local.dash_env} AND area = 'heap' FACET id TIMESERIES" }
    }
    widget_line {
      title  = "GC pause (ms, max)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT max(jvm.gc.pause) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "Live threads"
      row    = 4
      column = 1
      width  = 6
      nrql_query { query = "SELECT latest(jvm.threads.live) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
    widget_line {
      title  = "DB connections (active / pending)"
      row    = 4
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(hikaricp.connections.active), latest(hikaricp.connections.pending) FROM Metric WHERE ${local.svc} AND ${local.dash_env} TIMESERIES" }
    }
  }

  page {
    name = "Logs and usage"
    widget_bar {
      title  = "WARN and ERROR by logger (24 h)"
      row    = 1
      column = 1
      width  = 6
      nrql_query { query = "SELECT count(*) FROM Log WHERE ${local.svc} AND ${local.dash_env} AND severity.text IN ('WARN', 'ERROR') FACET otel.library.name SINCE 1 day ago LIMIT 20" }
    }
    widget_billboard {
      title  = "Data ingested this month (GB of 100 free)"
      row    = 1
      column = 7
      width  = 6
      nrql_query { query = "SELECT latest(GigabytesIngested) FROM NrMTDConsumption WHERE productLine = 'DataPlatform' SINCE 1 day ago" }
    }
  }
}
