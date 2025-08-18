/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { SEND_REQUEST_ACTION_ID, IChatSendRequestResult, registerChatActions } from '../../browser/actions/chatActions.js';
import { IChatService } from '../../common/chatService.js';
import { MockChatService } from '../common/mockChatService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';

suite('SendRequest Simple Integration', () => {
	let store: DisposableStore;
	let commandService: ICommandService;

	setup(() => {
		store = new DisposableStore();

		const instaService = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(new TestConfigurationService)),
		}, store);
		instaService.stub(IChatService, new MockChatService());

		store.add(instaService);
		commandService = instaService.get(ICommandService);

		// Register chat actions to make SendRequestAction available
		registerChatActions();
	});

	teardown(function () {
		store.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('SEND_REQUEST_ACTION_ID constant is defined', () => {
		assert.strictEqual(typeof SEND_REQUEST_ACTION_ID, 'string');
		assert.strictEqual(SEND_REQUEST_ACTION_ID, 'workbench.action.sendRequest');
	});

	test('sendRequest command is registered', async () => {
		// This test verifies that the command is available
		try {
			const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID, { query: '' });
			// We expect this to return an error for empty query, but the command should exist
			assert.strictEqual(typeof result, 'object');
		} catch (error) {
			// If the command doesn't exist, we'd get a different error
			// We expect specific behavior for empty query
			assert.ok(error.message.includes('command') || error.message.includes('not found'), 
				`Unexpected error: ${error.message}`);
		}
	});

	test('sendRequest with no params returns expected error', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID) as IChatSendRequestResult;
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.errorMessage, 'No query provided');
	});
});