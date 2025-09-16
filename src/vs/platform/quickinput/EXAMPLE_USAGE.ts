/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example: How to use the QuickInput Debug API from an extension or debugging tool

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { QuickInputDebugMonitor } from 'vs/platform/quickinput/browser/quickInputDebugMonitor';

/**
 * Example extension that demonstrates debugging quickpick operations
 */
export class ExampleQuickPickDebuggingExtension {

	private debugMonitor: QuickInputDebugMonitor | undefined;

	/**
	 * Enable debugging by connecting to the IPC channel
	 */
	enableDebugging(ipcChannel: IChannel): void {
		// Create the debug monitor to listen to events
		this.debugMonitor = new QuickInputDebugMonitor(ipcChannel);
		
		console.log('QuickInput debugging enabled - all picker operations will be logged');
	}

	/**
	 * Disable debugging
	 */
	disableDebugging(): void {
		this.debugMonitor?.dispose();
		this.debugMonitor = undefined;
		
		console.log('QuickInput debugging disabled');
	}

	/**
	 * Example of triggering a quickpick that will be logged
	 */
	async demonstrateQuickPick(): Promise<void> {
		// This is how an extension would normally create a quickpick
		// With debugging enabled, this will be logged to the IPC channel
		
		const quickPick = vscode.window.createQuickPick();
		quickPick.items = [
			{ label: 'Option 1', description: 'First option' },
			{ label: 'Option 2', description: 'Second option' },
			{ label: 'Option 3', description: 'Third option' }
		];
		quickPick.placeholder = 'Choose an option for debugging demo';
		
		quickPick.onDidChangeSelection(selection => {
			console.log('Selected:', selection[0]?.label);
			quickPick.hide();
		});
		
		quickPick.show();
		
		// When debugging is enabled, the following will be logged:
		// 1. createQuickPick operation
		// 2. show operation  
		// 3. Any user interactions
		// 4. Final selection or cancellation
	}
}

/**
 * Example configuration for enabling debugging in settings.json
 */
export const EXAMPLE_SETTINGS = {
	"workbench.quickInput.debug.enabled": true
};

/**
 * Example debug output when the above quickpick is used:
 * 
 * QuickInput Debug Event: {
 *   timestamp: '2023-12-01T10:30:00.000Z',
 *   operation: 'createQuickPick',
 *   options: { useSeparators: false }
 * }
 * 
 * QuickInput Debug Event: {
 *   timestamp: '2023-12-01T10:30:00.150Z',
 *   operation: 'pick.start',
 *   picks: [
 *     { label: 'Option 1', description: 'First option' },
 *     { label: 'Option 2', description: 'Second option' },
 *     { label: 'Option 3', description: 'Third option' }
 *   ],
 *   options: { placeholder: 'Choose an option for debugging demo' }
 * }
 * 
 * QuickInput Debug Event: {
 *   timestamp: '2023-12-01T10:30:02.450Z',
 *   operation: 'pick.success',
 *   duration: 2300,
 *   result: { label: 'Option 2', description: 'Second option' }
 * }
 */