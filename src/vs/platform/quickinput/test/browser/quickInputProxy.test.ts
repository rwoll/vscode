/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IQuickAccessController } from '../common/quickAccess.js';
import { IInputBox, IInputOptions, IKeyMods, IPickOptions, IQuickInputButton, IQuickInputService, IQuickNavigateConfiguration, IQuickPick, IQuickPickItem, IQuickTree, IQuickTreeItem, IQuickWidget, QuickPickInput } from '../common/quickInput.js';
import { QuickInputDebugService } from '../browser/quickInputDebugService.js';
import { QuickInputProxyService } from '../browser/quickInputProxyService.js';
import { IQuickInputDebugEvent } from '../common/quickInputDebugIpc.js';
import { timeout } from '../../../base/common/async.js';

class MockQuickInputService implements IQuickInputService {
	declare readonly _serviceBrand: undefined;

	private readonly _onShow = new Emitter<void>();
	private readonly _onHide = new Emitter<void>();

	readonly onShow = this._onShow.event;
	readonly onHide = this._onHide.event;

	get backButton(): IQuickInputButton {
		return {} as any;
	}

	get currentQuickInput() {
		return undefined;
	}

	get quickAccess(): IQuickAccessController {
		return {} as any;
	}

	async pick<T extends IQuickPickItem, O extends IPickOptions<T>>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], 
		options?: O, 
		token: CancellationToken = CancellationToken.None
	): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		// Simulate async operation
		await timeout(10);
		
		const items = Array.isArray(picks) ? picks : await picks;
		return items[0] as any;
	}

	async input(options: IInputOptions = {}, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {
		await timeout(10);
		return 'test input';
	}

	createQuickPick(): any { return {} as any; }
	createInputBox(): IInputBox { return {} as any; }
	createQuickWidget(): IQuickWidget { return {} as any; }
	createQuickTree(): any { return {} as any; }
	focus(): void { }
	toggle(): void { }
	navigate(): void { }
	async accept(): Promise<void> { }
	async back(): Promise<void> { }
	async cancel(): Promise<void> { }
}

suite('QuickInputProxyService', () => {
	let mockService: MockQuickInputService;
	let debugService: QuickInputDebugService;
	let proxyService: QuickInputProxyService;
	let loggedEvents: IQuickInputDebugEvent[];

	setup(() => {
		mockService = new MockQuickInputService();
		debugService = new QuickInputDebugService();
		proxyService = new QuickInputProxyService(mockService, debugService);
		loggedEvents = [];

		debugService.onDidLogEvent(event => {
			loggedEvents.push(event);
		});
	});

	test('should proxy pick operations and log when debugging enabled', async () => {
		proxyService.setDebuggingEnabled(true);

		const testPicks = [{ label: 'Test Item', id: 'test' }];
		const testOptions = { canPickMany: false };

		const result = await proxyService.pick(testPicks, testOptions);

		assert.strictEqual(result?.label, 'Test Item');
		assert.strictEqual(loggedEvents.length, 2); // start and success events
		
		const startEvent = loggedEvents[0];
		assert.strictEqual(startEvent.operation, 'pick.start');
		assert.deepStrictEqual(startEvent.picks, testPicks);
		assert.deepStrictEqual(startEvent.options, testOptions);

		const successEvent = loggedEvents[1];
		assert.strictEqual(successEvent.operation, 'pick.success');
		assert.ok(successEvent.duration! > 0);
		assert.strictEqual(successEvent.result?.label, 'Test Item');
	});

	test('should not log when debugging disabled', async () => {
		proxyService.setDebuggingEnabled(false);

		const testPicks = [{ label: 'Test Item', id: 'test' }];
		await proxyService.pick(testPicks);

		assert.strictEqual(loggedEvents.length, 0);
	});

	test('should log input operations', async () => {
		proxyService.setDebuggingEnabled(true);

		const testOptions = { prompt: 'Enter text' };
		const result = await proxyService.input(testOptions);

		assert.strictEqual(result, 'test input');
		assert.strictEqual(loggedEvents.length, 2); // start and success events
		
		const startEvent = loggedEvents[0];
		assert.strictEqual(startEvent.operation, 'input.start');
		assert.deepStrictEqual(startEvent.options, testOptions);

		const successEvent = loggedEvents[1];
		assert.strictEqual(successEvent.operation, 'input.success');
		assert.strictEqual(successEvent.result, 'test input');
	});

	test('should proxy other operations without logging request/response', async () => {
		proxyService.setDebuggingEnabled(true);

		proxyService.focus();
		proxyService.toggle();

		assert.strictEqual(loggedEvents.length, 2);
		assert.strictEqual(loggedEvents[0].operation, 'focus');
		assert.strictEqual(loggedEvents[1].operation, 'toggle');
	});
});