# QuickInput Debug API

This API provides a debugging proxy for VS Code's QuickInput service that allows extensions and external processes to monitor quickpick operations via IPC.

## Overview

The QuickInput Debug API consists of:

1. **QuickInputDebugService** - Logs quickinput operations and fires events
2. **QuickInputProxyService** - Wraps the real QuickInputService and logs operations when debugging is enabled  
3. **QuickInputDebugChannel/Client** - IPC channel for external processes to receive debug events
4. **QuickInputDebugMonitor** - Example utility for monitoring debug events

## Configuration

Enable debugging by setting the configuration:

```json
{
  "workbench.quickInput.debug.enabled": true
}
```

## Usage for Extension Debugging

When debugging is enabled, all quickpick operations will be logged including:

- `pick()` operations with request picks, options, and response
- `input()` operations with options and response  
- Other operations like `focus()`, `toggle()`, `navigate()`, etc.
- Timing information for async operations
- Error information if operations fail

## Usage for External Process Debugging

External processes can connect to the debug events via IPC:

```typescript
import { QuickInputDebugMonitor } from './quickInputDebugMonitor.js';

// Get IPC channel (implementation depends on your setup)
const ipcChannel = getQuickInputDebugChannel();

const monitor = new QuickInputDebugMonitor(ipcChannel);
// Events will be logged to console automatically
```

## Debug Event Structure

```typescript
interface IQuickInputDebugEvent {
  readonly timestamp: number;      // When the operation occurred
  readonly operation: string;      // Operation name (e.g., 'pick.start', 'pick.success')
  readonly picks?: any[];          // Input picks for pick operations
  readonly options?: any;          // Options passed to the operation
  readonly result?: any;           // Result of the operation
  readonly error?: string;         // Error message if operation failed
  readonly duration?: number;      // Duration in milliseconds for async operations
}
```

## Example Debug Output

```
QuickInput Debug Event: {
  timestamp: '2023-12-01T10:30:00.000Z',
  operation: 'pick.start',
  picks: [
    { label: 'Option 1', id: 'opt1' },
    { label: 'Option 2', id: 'opt2' }
  ],
  options: { canPickMany: false, placeHolder: 'Choose an option' }
}

QuickInput Debug Event: {
  timestamp: '2023-12-01T10:30:00.150Z', 
  operation: 'pick.success',
  duration: 150,
  result: { label: 'Option 1', id: 'opt1' }
}
```

## Performance Impact

- When debugging is disabled (default), there is minimal performance impact
- When enabled, logging adds small overhead but operations remain async
- Large pick arrays are summarized in logs to avoid memory issues

## Security Considerations

- Debug logs may contain sensitive information from quickpick items
- Only enable debugging in development environments
- External IPC access should be restricted to authorized debugging tools