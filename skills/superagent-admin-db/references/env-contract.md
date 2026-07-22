# Env Contract

The skill expects credentials in a user-local file:

```text
~/.config/superagent/admin-db.env
```

The file is not committed and is not installed by the plugin. QA users create it
from the README instructions and populate values supplied by the SuperAgent
team.

## File Format

Use simple dotenv lines only:

```env
SUPERAGENT_DEFAULT_ENV=dev

SUPERAGENT_BACKEND_URL_DEV=https://back-dev.superagent.estate/api
SUPERAGENT_BACKEND_API_KEY_DEV=
SUPERAGENT_ADMIN_BEARER_TOKEN_DEV=

SUPERAGENT_DATABASE_URL_DEV=
SUPERAGENT_DB_URL_DEV=
SUPERAGENT_DB_USERNAME_DEV=
SUPERAGENT_DB_PASSWORD_DEV=

SUPERAGENT_BACKEND_URL_STAGING=
SUPERAGENT_BACKEND_API_KEY_STAGING=
SUPERAGENT_ADMIN_BEARER_TOKEN_STAGING=
SUPERAGENT_DATABASE_URL_STAGING=
SUPERAGENT_DB_URL_STAGING=
SUPERAGENT_DB_USERNAME_STAGING=
SUPERAGENT_DB_PASSWORD_STAGING=

SUPERAGENT_BACKEND_URL_PROD=
SUPERAGENT_BACKEND_API_KEY_PROD=
SUPERAGENT_ADMIN_BEARER_TOKEN_PROD=
SUPERAGENT_DATABASE_URL_PROD=
SUPERAGENT_DB_URL_PROD=
SUPERAGENT_DB_USERNAME_PROD=
SUPERAGENT_DB_PASSWORD_PROD=
```

`SUPERAGENT_DATABASE_URL_<ENV>` is preferred when it is a `postgresql://` URL.
If the team provides Spring-style JDBC values, use `SUPERAGENT_DB_URL_<ENV>` as
`jdbc:postgresql://...` plus username/password variables.

DEV and staging may point at the same physical Postgres database and select
different SuperAgent schemas through the URL query parameter:

```text
?currentSchema=superagent_dev_schema
?currentSchema=superagent_staging_schema
```

The bundled DB helper removes `currentSchema` from the connection URL and
applies it inside the read-only transaction with `SET LOCAL search_path`. This
avoids relying on Postgres startup options that some managed servers reject.

Managed Postgres hosts normally require SSL. The helper respects `sslmode=` in
the URL and otherwise defaults `PGSSLMODE=require` for non-local hosts.

`SUPERAGENT_ADMIN_BEARER_TOKEN_<ENV>` is optional. Admin voice-session endpoints
may require a Clerk/JWT bearer token in addition to `X-API-KEY`; trace endpoints
may work with the backend API key alone depending on environment policy.

## Safety

- Do not place credentials in `AGENTS.md`, skill files, README examples, Jira,
  chat, or reports.
- Do not run `source ~/.config/superagent/admin-db.env`; use the bundled scripts
  or parse lines as inert text.
- Print only booleans such as `api_key_present=True` and hostnames such as
  `back-dev.superagent.estate`.
- Lock the file down with `chmod 600 ~/.config/superagent/admin-db.env`.
