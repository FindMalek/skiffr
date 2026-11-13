# OpenObserve setup for skiffr

Everything here is json that can be loaded into any OpenObserve (tested on v1.1.2, org `default`). The walkthrough is in `apps/docs/content/docs/observability-tour.mdx`.

| path | what |
| --- | --- |
| `dashboards/*.json` | dashboard bodies (version 8), imported into the dashboard folder `skiffr`. Log panels use SQL on the stream `skiffr`, metric panels use PromQL |
| `savedviews/*.json` | saved views for the Logs page. `data` is the search page state the UI saves, so the filter is in `data.data.query` |
| `stream-settings.json` | additive settings for the logs stream: full text search key, index fields, bloom filter, distinct fields. Nothing is removed |
| `destinations/skiffr_unset.json` | placeholder webhook (`example.com`) so the alerts can exist. Replace it, see below |
| `alerts/*.json` | `skiffr_5xx_burst`, `skiffr_db_down`, `skiffr_scheduler_stale`. Created switched off |
| `import.sh` | loads all of the above |

## import

```sh
export OPENOBSERVE_URL=https://o2.example.net
export OPENOBSERVE_AUTH='Basic <base64 of email:password>'
sh ops/openobserve/import.sh
```

Needs `curl` and `jq`. Optional: `OPENOBSERVE_ORG` (default `default`), `OPENOBSERVE_STREAM` (default `skiffr`), `OPENOBSERVE_FOLDER` (default `skiffr`).

Run it after the api has sent logs and metrics at least once. The stream settings and the alerts need those streams to exist. If they do not, the script reports it, still creates everything else and exits 1: run it again later.

- Any failed call stops the run (http status 300 or more counts as failed, so a redirect or a wrong password does not look like success). The exception is the stream settings and the alerts, see above.
- Saved views get `OPENOBSERVE_ORG` as their `organizationIdentifier`. An `http://` url prints a warning, the auth would travel in the clear.
- Safe to run again. Dashboards, views and alerts are found by name and updated in place. Nothing is deleted.
- Alerts that exist keep their `enabled` flag and destinations. The placeholder destination is created only when missing.
- The auth value is handed to curl on stdin, never printed, never put on a command line.
- The files hold no secrets. The only url is the placeholder webhook.

## changing things

Edit a dashboard in the UI, then Dashboard settings, export json, and replace the file. Keep the title: it is the key the import matches on. Saved views: change `data.data.query` for the filter and `data.data.stream.selectedFields` for the columns.

## alerts need a destination

OpenObserve refuses an alert with no destination, and email destinations need `ZO_SMTP_*` on the server. `skiffr_unset` is a webhook to `https://example.com/skiffr-alert-placeholder`, which is not a real receiver. Create a real destination (Alerts, Destinations), point each alert at it, switch the alert on.

## fields the panels depend on

Logs: `body`, `severity`, `http_method`, `http_route`, `http_status_code`, `http_status_class`, `duration_ms`, `request_id`, `service_name`.
Metrics: `skiffr_http_requests`, `skiffr_http_duration_ms_{bucket,sum,count}`, `skiffr_db_up`, `skiffr_scheduler_{runs,duration_ms_*,items,last_success_seconds}`, `skiffr_sync_failures`, `skiffr_rate_limit_rejected`, `skiffr_ai_{calls,tokens}`.
If an attribute is renamed in `packages/observability`, change the queries here in the same pull request.
