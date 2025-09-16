# QuickInput Debug Interceptor

This simple implementation provides debugging capabilities for VS Code's QuickInput API by intercepting calls at the main thread level where extensions communicate with the main process.

## How it works

The interceptor is added to `MainThreadQuickOpen` and logs all quickpick operations that come from extensions via IPC. This provides visibility into:

- What data extensions are passing to quickpick operations
- How long operations take
- Success/failure results
- Which extensions are making the calls

## Configuration

Enable debugging by adding to VS Code settings:

```json
{
  "debug.quickInput.enabled": true
}
```

## Debug Events

When enabled, the interceptor logs events with this structure:

```typescript
interface IQuickInputDebugEvent {
  timestamp: number;        // When the operation occurred
  operation: string;        // e.g., '$show.start', '$input.start', 'operation.success'
  extensionId?: string;     // Which extension made the call (if available)
  args?: any[];            // Arguments passed to the operation
  result?: any;            // Result of the operation
  error?: string;          // Error message if operation failed
  duration?: number;       // Duration in milliseconds for completed operations
}
```

## Example Output

```javascript
// Extension calls vscode.window.showQuickPick()
{
  timestamp: 1701432600000,
  operation: '$show.start',
  args: [1, { placeHolder: 'Choose an option', canPickMany: false }]
}

// User selects an item
{
  timestamp: 1701432602150,
  operation: 'operation.success',
  result: 42,  // handle of selected item
  duration: 2150
}
```

## Access for External Tools

External debugging tools can access the interceptor via the MainThreadQuickOpen instance:

```typescript
// Get the debug interceptor
const mainThreadQuickOpen = /* get instance */;
const debugInterceptor = mainThreadQuickOpen.getDebugInterceptor();

// Listen to events
debugInterceptor.onDidLogEvent(event => {
  console.log('QuickInput Debug:', event);
});
```

## Architecture

This approach is much simpler than a full proxy service:

```
Extension Host          Main Process
┌─────────────────┐    ┌─────────────────────────┐
│ Extension calls │───▶│ MainThreadQuickOpen     │
│ vscode.window.  │    │ ├─ Debug Interceptor ── │───▶ Log Events
│ showQuickPick() │    │ └─ QuickInputService    │
└─────────────────┘    └─────────────────────────┘
```

The interceptor sits at the exact boundary where extension calls are received by the main process, providing perfect visibility into extension-initiated quickpick operations with minimal complexity.

## Performance

- Zero overhead when disabled (default)
- Minimal logging overhead when enabled
- No impact on VS Code's core functionality
- Simple implementation with no complex proxy patterns