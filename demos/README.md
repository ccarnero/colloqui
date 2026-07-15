# demos

This folder holds end-to-end **commercial showcase** builds — scenarios assembled to demonstrate
the platform's value to a prospect or customer (a believable business flow, real third-party
systems, a story worth presenting), as opposed to the other two example tiers:
[`integrations/`](../integrations/README.md), which holds minimal **feature reference** scripts
that each isolate a single platform capability (one channel, one resource, one call) for
engineers learning the platform's surface, and [`sdk/examples/`](../sdk/examples/README.md),
which demonstrates the SDK's own API surface (auth/config, CRUD, pagination, error handling).
Demos may compose several integrations' worth of capability into one narrative, run longer setup,
and depend on external SaaS accounts (e.g. HubSpot, Telegram, OpenAI); integrations stay small,
dependency-light, and focused on a single API call path.
