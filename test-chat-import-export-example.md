# Chat Import/Export Command Usage Examples

This document demonstrates how to use the new chat import/export commands with filepath arguments.

## Export a Chat Session

### From VS Code Command Palette (F1)
1. Open command palette
2. Type "Export Chat"
3. Choose a location

### From Extension using executeCommand

```typescript
import * as vscode from 'vscode';

// Export to a specific filepath (string)
await vscode.commands.executeCommand(
    'workbench.action.chat.export',
    '/path/to/export/chat.json'
);

// Export to a URI
const uri = vscode.Uri.file('/path/to/export/chat.json');
await vscode.commands.executeCommand(
    'workbench.action.chat.export',
    uri
);

// Export with dialog (no arguments)
await vscode.commands.executeCommand('workbench.action.chat.export');
```

## Import a Chat Session

### From VS Code Command Palette (F1)
1. Open command palette
2. Type "Import Chat"
3. Select a file

### From Extension using executeCommand

```typescript
import * as vscode from 'vscode';

// Import from a specific filepath (string)
await vscode.commands.executeCommand(
    'workbench.action.chat.import',
    '/path/to/import/chat.json'
);

// Import from a URI
const uri = vscode.Uri.file('/path/to/import/chat.json');
await vscode.commands.executeCommand(
    'workbench.action.chat.import',
    uri
);

// Import with dialog (no arguments)
await vscode.commands.executeCommand('workbench.action.chat.import');
```

## Chat Session JSON Format

The exported JSON file contains:

```json
{
  "initialLocation": "panel",
  "requests": [...],
  "responderUsername": "GitHub Copilot",
  "responderAvatarIconUri": null
}
```

This is the `IExportableChatData` format used internally by VS Code.

## Notes

- Both commands accept either a URI object or a string filepath
- If no argument is provided, a file dialog will be shown
- The import command validates the JSON structure before importing
- The export command uses the currently focused chat widget's session
