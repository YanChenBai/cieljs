# @cieljs/console

`@cieljs/console` provides the Vue 3 UI for Ciel Console. It includes the combined console,
chat, execution trace inspection, session and usage views, content rendering, and extension
points for custom tool and message renderers.

```vue
<script setup lang="ts">
import { CielConsole } from '@cieljs/console';
import type { TraceClient } from '@cieljs/trace';

import '@cieljs/console/style.css';

defineProps<{ client: TraceClient }>();
</script>

<template>
  <CielConsole :client="client" />
</template>
```

Focused integrations can use `CielChat` or `ExecutionTraceInspect`. Custom renderers use
`ToolRenderers` and `MessageRenderers`, and the package also exports the content, tool-call,
message, session, usage, and follow-scroll building blocks.
