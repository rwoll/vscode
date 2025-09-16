/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { QuickInputDebugInterceptor } from '../browser/quickInputDebugInterceptor.js';
import { IQuickInputDebugEvent } from '../common/quickInputDebug.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { Emitter } from '../../../base/common/event.js';

class MockConfigurationService implements Partial<IConfigurationService> {
	private readonly _onDidChangeConfiguration = new Emitter<any>();
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _values = new Map<string, any>();

	getValue<T>(section: string): T {
		return this._values.get(section) as T;
	}

	setValue(section: string, value: any): void {
		this._values.set(section, value);
		this._onDidChangeConfiguration.fire({ affectsConfiguration: (key: string) => key === section });
	}
}

suite('QuickInputDebugInterceptor', () => {
	let interceptor: QuickInputDebugInterceptor;
	let mockConfig: MockConfigurationService;
	let loggedEvents: IQuickInputDebugEvent[];

	setup(() => {
		mockConfig = new MockConfigurationService();
		interceptor = new QuickInputDebugInterceptor(mockConfig as any);
		loggedEvents = [];

		interceptor.onDidLogEvent(event => {
			loggedEvents.push(event);
		});
	});

	teardown(() => {
		interceptor.dispose();
	});

	test('should be disabled by default', () => {
		assert.strictEqual(interceptor.isEnabled(), false);
	});

	test('should enable via configuration', () => {
		mockConfig.setValue('debug.quickInput.enabled', true);
		assert.strictEqual(interceptor.isEnabled(), true);
	});

	test('should log operations when enabled', () => {
		interceptor.setEnabled(true);
		
		const startTime = interceptor.logOperation('test', ['arg1', 'arg2'], 'ext.id');
		interceptor.logResult(startTime, 'result');

		assert.strictEqual(loggedEvents.length, 2);
		assert.strictEqual(loggedEvents[0].operation, 'test.start');
		assert.deepStrictEqual(loggedEvents[0].args, ['arg1', 'arg2']);
		assert.strictEqual(loggedEvents[0].extensionId, 'ext.id');
		
		assert.strictEqual(loggedEvents[1].operation, 'operation.success');
		assert.strictEqual(loggedEvents[1].result, 'result');
		assert.ok(loggedEvents[1].duration! > 0);
	});

	test('should not log when disabled', () => {
		interceptor.setEnabled(false);
		
		const startTime = interceptor.logOperation('test', ['arg1'], 'ext.id');
		interceptor.logResult(startTime, 'result');

		assert.strictEqual(loggedEvents.length, 0);
	});

	test('should log errors', () => {
		interceptor.setEnabled(true);
		
		const startTime = interceptor.logOperation('test', []);
		interceptor.logError(startTime, new Error('Test error'));

		assert.strictEqual(loggedEvents.length, 2);
		assert.strictEqual(loggedEvents[1].operation, 'operation.error');
		assert.strictEqual(loggedEvents[1].error, 'Test error');
	});
});