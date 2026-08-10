// Side-effect import: satisfy the API config's boot guard for unit tests that
// transitively import env-dependent modules (psql-runner → ssh-manager →
// config/env). Setting INTERNAL_TOKEN keeps DEPLOY_MODE at its default, so no
// mode-dependent behavior changes — unlike overriding DEPLOY_MODE globally.
// Must be imported BEFORE any module that loads config/env.
process.env.INTERNAL_TOKEN ||= "test-internal-token-0000000000000000000000000000";
