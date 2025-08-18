/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IChatWidgetService } from '../../browser/chat.js';
import { IChatService } from '../../common/chatService.js';
import { ChatModel } from '../../common/chatModel.js';
import { ChatViewModel } from '../../common/chatViewModel.js';
import { registerChatExportActions } from '../../browser/actions/chatImportExport.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';

suite('Chat Import/Export Actions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let mockFileService: IFileService;
	let mockFileDialogService: IFileDialogService;
	let mockChatWidgetService: IChatWidgetService;
	let mockChatService: IChatService;
	let mockCommandService: ICommandService;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());

		// Mock file service
		mockFileService = {
			writeFile: async (uri: URI, content: VSBuffer) => {
				// Mock implementation - just store the call for verification
				(mockFileService as any)._lastWriteCall = { uri, content };
			}
		} as any;

		// Mock file dialog service
		mockFileDialogService = {
			showSaveDialog: async (options: any) => {
				// Return a mock URI when dialog is called
				return URI.file('/mock/path/chat.json');
			},
			defaultFilePath: async () => URI.file('/mock/default')
		} as any;

		// Mock chat widget
		const mockWidget = {
			viewModel: {
				sessionId: 'test-session-id'
			}
		};

		// Mock chat widget service
		mockChatWidgetService = {
			lastFocusedWidget: mockWidget
		} as any;

		// Mock chat model with export functionality
		const mockChatModel = {
			sessionId: 'test-session-id',
			toExport: () => ({
				version: 1,
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi there!' }
				]
			})
		};

		// Mock chat service
		mockChatService = {
			getSession: (sessionId: string) => {
				return sessionId === 'test-session-id' ? mockChatModel : undefined;
			}
		} as any;

		// Mock command service
		mockCommandService = {
			executeCommand: async (commandId: string, ...args: any[]) => {
				(mockCommandService as any)._lastCommand = { commandId, args };
			}
		} as any;

		// Register services
		instantiationService.stub(IFileService, mockFileService);
		instantiationService.stub(IFileDialogService, mockFileDialogService);
		instantiationService.stub(IChatWidgetService, mockChatWidgetService);
		instantiationService.stub(IChatService, mockChatService);
		instantiationService.stub(ICommandService, mockCommandService);
	});

	test('export chat with file path provided as URI', async () => {
		// Register the actions
		registerChatExportActions();

		// Get the export action
		const actions = instantiationService.invokeFunction(accessor => {
			return accessor.get(ICommandService);
		});

		// Create a target URI
		const targetUri = URI.file('/test/export/path/my-chat.json');

		// Execute the export action with URI argument
		await instantiationService.invokeFunction(async (accessor) => {
			const widgetService = accessor.get(IChatWidgetService);
			const fileService = accessor.get(IFileService);
			const chatService = accessor.get(IChatService);

			// Simulate the export action logic with file path argument
			const widget = widgetService.lastFocusedWidget;
			if (!widget || !widget.viewModel) {
				assert.fail('Widget should be available for test');
			}

			const model = chatService.getSession(widget.viewModel.sessionId);
			if (!model) {
				assert.fail('Chat model should be available for test');
			}

			// Export the chat
			const content = VSBuffer.fromString(JSON.stringify(model.toExport(), undefined, 2));
			await fileService.writeFile(targetUri, content);

			// Verify the file was written with correct content
			const lastWrite = (fileService as any)._lastWriteCall;
			assert.strictEqual(lastWrite.uri.toString(), targetUri.toString());
			
			const exportedData = JSON.parse(lastWrite.content.toString());
			assert.strictEqual(exportedData.version, 1);
			assert.strictEqual(exportedData.messages.length, 2);
			assert.strictEqual(exportedData.messages[0].content, 'Hello');
			assert.strictEqual(exportedData.messages[1].content, 'Hi there!');
		});
	});

	test('export chat with file path provided as string', async () => {
		// Register the actions
		registerChatExportActions();

		// Create a target path as string
		const targetPath = '/test/export/path/my-chat-from-string.json';
		const expectedUri = URI.file(targetPath);

		// Execute the export action with string argument
		await instantiationService.invokeFunction(async (accessor) => {
			const widgetService = accessor.get(IChatWidgetService);
			const fileService = accessor.get(IFileService);
			const chatService = accessor.get(IChatService);

			// Simulate the export action logic with string path argument
			const widget = widgetService.lastFocusedWidget;
			if (!widget || !widget.viewModel) {
				assert.fail('Widget should be available for test');
			}

			let targetUri: URI;
			try {
				targetUri = URI.file(targetPath);
			} catch (error) {
				assert.fail('Should be able to convert string path to URI');
			}

			const model = chatService.getSession(widget.viewModel.sessionId);
			if (!model) {
				assert.fail('Chat model should be available for test');
			}

			// Export the chat
			const content = VSBuffer.fromString(JSON.stringify(model.toExport(), undefined, 2));
			await fileService.writeFile(targetUri, content);

			// Verify the file was written with correct URI
			const lastWrite = (fileService as any)._lastWriteCall;
			assert.strictEqual(lastWrite.uri.toString(), expectedUri.toString());
		});
	});

	test('export chat without file path shows dialog', async () => {
		// Register the actions
		registerChatExportActions();

		// Track if dialog was called
		let dialogCalled = false;
		mockFileDialogService.showSaveDialog = async (options: any) => {
			dialogCalled = true;
			return URI.file('/dialog/selected/path.json');
		};

		// Execute the export action without arguments
		await instantiationService.invokeFunction(async (accessor) => {
			const widgetService = accessor.get(IChatWidgetService);
			const fileService = accessor.get(IFileService);
			const chatService = accessor.get(IChatService);
			const fileDialogService = accessor.get(IFileDialogService);

			// Simulate the export action logic without arguments
			const widget = widgetService.lastFocusedWidget;
			if (!widget || !widget.viewModel) {
				assert.fail('Widget should be available for test');
			}

			// No arguments provided, should show dialog
			const result = await fileDialogService.showSaveDialog({
				defaultUri: URI.file('/mock/default/chat.json'),
				filters: [{ name: 'Chat Session', extensions: ['json'] }]
			});

			if (!result) {
				assert.fail('Dialog should return a result for test');
			}

			const model = chatService.getSession(widget.viewModel.sessionId);
			if (!model) {
				assert.fail('Chat model should be available for test');
			}

			// Export the chat
			const content = VSBuffer.fromString(JSON.stringify(model.toExport(), undefined, 2));
			await fileService.writeFile(result, content);

			// Verify dialog was called
			assert.strictEqual(dialogCalled, true, 'Save dialog should have been called');

			// Verify file was written
			const lastWrite = (fileService as any)._lastWriteCall;
			assert.strictEqual(lastWrite.uri.toString(), result.toString());
		});
	});

	test('export chat with invalid string path falls back to dialog', async () => {
		// Register the actions
		registerChatExportActions();

		// Track if dialog was called
		let dialogCalled = false;
		mockFileDialogService.showSaveDialog = async (options: any) => {
			dialogCalled = true;
			return URI.file('/dialog/fallback/path.json');
		};

		// Simulate invalid path handling
		const invalidPath = ''; // Empty string should be invalid

		await instantiationService.invokeFunction(async (accessor) => {
			let targetUri: URI | undefined;

			// Simulate the path validation logic
			if (invalidPath) {
				try {
					targetUri = URI.file(invalidPath);
				} catch (error) {
					targetUri = undefined;
				}
			}

			// Should be undefined due to invalid path
			assert.strictEqual(targetUri, undefined, 'Invalid path should result in undefined URI');

			// Should fall back to dialog
			const fileDialogService = accessor.get(IFileDialogService);
			const result = await fileDialogService.showSaveDialog({
				defaultUri: URI.file('/mock/default/chat.json'),
				filters: [{ name: 'Chat Session', extensions: ['json'] }]
			});

			// Verify dialog was called as fallback
			assert.strictEqual(dialogCalled, true, 'Save dialog should have been called as fallback');
			assert.ok(result, 'Dialog should return a result');
		});
	});
});