# VSCode QuickPick API Debugging Proxy

This implementation provides a comprehensive debugging proxy for VSCode's QuickInput API that allows extensions and external processes to monitor quickpick operations via IPC.

## Problem Solved

The original request was to create a proxy/wrapper around the VSCode API that exposes the request/response of quickpickers to an IPC process for debugging purposes. This implementation provides exactly that functionality.

## Architecture

```
Extension API Call
       ↓
QuickInputProxyService (logs if debugging enabled)
       ↓
Real QuickInputService (executes the operation)
       ↓
QuickInputDebugService (emits debug events)
       ↓
IPC Channel (QuickInputDebugChannel)
       ↓
External Debugging Process (QuickInputDebugMonitor)
```

## Key Components

### 1. IPC Layer (`quickInputDebugIpc.ts`)
- `IQuickInputDebugService` - Service interface for debug logging
- `IQuickInputDebugEvent` - Event structure for debug data
- `QuickInputDebugChannel` - IPC server channel
- `QuickInputDebugChannelClient` - IPC client channel

### 2. Proxy Service (`quickInputProxyService.ts`)
- `QuickInputProxyService` - Main proxy that wraps IQuickInputService
- Logs all operations when debugging is enabled
- Minimal performance impact when disabled
- Captures timing, request, response, and error data

### 3. Debug Service (`quickInputDebugService.ts`)
- `QuickInputDebugService` - Simple service that emits debug events
- Thread-safe event emission
- Memory-efficient event handling

### 4. Enhanced Workbench Service (`quickInputService.ts`)
- Enhanced `QuickInputService` with debugging capability
- Configuration-driven debugging (`workbench.quickInput.debug.enabled`)
- Automatic setup and teardown

### 5. Monitoring Utility (`quickInputDebugMonitor.ts`)
- `QuickInputDebugMonitor` - Example external process monitor
- Connects to IPC channel and logs events
- Sanitizes data for safe logging

## Usage

### 1. Enable Debugging
Add to VS Code settings:
```json
{
  "workbench.quickInput.debug.enabled": true
}
```

### 2. Connect External Process
```typescript
const ipcChannel = getQuickInputDebugChannel(); // Your IPC setup
const monitor = new QuickInputDebugMonitor(ipcChannel);
// All quickpick operations are now logged
```

### 3. Monitor Events
Debug events include:
- Operation type (`pick.start`, `pick.success`, `input.start`, etc.)
- Request data (picks, options)
- Response data (selected items)
- Timing information
- Error details

## Example Debug Output

```javascript
{
  timestamp: '2023-12-01T10:30:00.000Z',
  operation: 'pick.start',
  picks: [
    { label: 'File 1', id: 'file1' },
    { label: 'File 2', id: 'file2' }
  ],
  options: { canPickMany: false, placeHolder: 'Choose a file' }
}

{
  timestamp: '2023-12-01T10:30:01.250Z',
  operation: 'pick.success',
  duration: 1250,
  result: { label: 'File 1', id: 'file1' }
}
```

## Test Coverage

- Unit tests for proxy service (`quickInputProxy.test.ts`)
- Mock service for testing
- Validates logging behavior when enabled/disabled
- Tests async operations and error handling

## Performance Considerations

- **Disabled**: Zero performance impact (default state)
- **Enabled**: Minimal overhead for event creation and IPC communication
- **Memory**: Large pick arrays are summarized to prevent memory issues
- **Async**: All operations remain fully asynchronous

## Security Considerations

- Debug logs may contain sensitive data from quickpick items
- Only enable in development/debugging environments
- IPC access should be restricted to authorized debugging tools
- Data sanitization included in monitoring utilities

## Files Added/Modified

### New Files:
1. `src/vs/platform/quickinput/common/quickInputDebugIpc.ts` - IPC interfaces
2. `src/vs/platform/quickinput/browser/quickInputDebugService.ts` - Debug service
3. `src/vs/platform/quickinput/browser/quickInputProxyService.ts` - Main proxy
4. `src/vs/platform/quickinput/browser/quickInputDebugMonitor.ts` - External monitor
5. `src/vs/platform/quickinput/test/browser/quickInputProxy.test.ts` - Tests
6. `src/vs/platform/quickinput/DEBUG_API.md` - API documentation
7. `src/vs/platform/quickinput/EXAMPLE_USAGE.ts` - Usage examples

### Modified Files:
1. `src/vs/workbench/services/quickinput/browser/quickInputService.ts` - Enhanced with debugging

## Integration Points

This implementation integrates seamlessly with VS Code's existing architecture:
- Uses standard dependency injection patterns
- Follows VS Code's service interfaces
- Compatible with existing IPC patterns
- Respects configuration service patterns
- Maintains all existing functionality

The proxy approach ensures no breaking changes to existing code while providing comprehensive debugging capabilities for quickpick operations.