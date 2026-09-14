# @cieljs/trace

`@cieljs/trace` is Ciel's UI-independent trace data layer. It collects Agent and runtime
events, projects execution records, persists them through PGlite, and exposes oRPC queries
and subscriptions.

```ts
import { Storage } from '@cieljs/storage';
import { TraceHost, createTraceRouter, traceStorage } from '@cieljs/trace/host';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [traceStorage],
});
await using host = await TraceHost.open({ storage });
const router = createTraceRouter(host);
```

Applications choose the oRPC link and own its connection lifecycle:

```ts
import { createTraceClient } from '@cieljs/trace/client';
import { RPCLink } from '@orpc/client/message-port';

const client = createTraceClient(new RPCLink({ port }));
```

Persistence uses the `trace` PostgreSQL schema, `trace.records` table, and
`trace:projection-state` projection key.
