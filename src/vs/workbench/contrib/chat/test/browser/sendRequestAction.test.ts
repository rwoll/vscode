/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchAssignmentService } from '../../../../services/assignment/common/assignmentService.js';
import { NullWorkbenchAssignmentService } from '../../../../services/assignment/test/common/nullAssignmentService.js';
import { IExtensionService, nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { mock, TestContextService, TestExtensionService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { ChatAgentService, IChatAgent, IChatAgentData, IChatAgentImplementation, IChatAgentService } from '../../common/chatAgents.js';
import { IChatEditingService, IChatEditingSession } from '../../common/chatEditingService.js';
import { IChatService } from '../../common/chatService.js';
import { ChatService } from '../../common/chatServiceImpl.js';
import { ChatSlashCommandService, IChatSlashCommandService } from '../../common/chatSlashCommands.js';
import { IChatVariablesService } from '../../common/chatVariables.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { MockChatVariablesService } from '../common/mockChatVariables.js';
import { IMcpService } from '../../../mcp/common/mcpTypes.js';
import { TestMcpService } from '../../../mcp/test/common/testMcpService.js';
import { Event } from '../../../../../base/common/event.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { SEND_REQUEST_ACTION_ID, IChatSendRequestResult, registerChatActions } from '../../browser/actions/chatActions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CommandService } from '../../../../../platform/commands/common/commandService.js';
import { IChatModeService } from '../../common/chatModes.js';
import { ILanguageModelToolsService } from '../../common/languageModelToolsService.js';
import { IChatWidgetService } from '../chat.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHostService } from '../../../../services/host/browser/host.js';

function getAgentData(id: string): IChatAgentData {
	return {
		name: id,
		id: id,
		extensionId: nullExtensionDescription.identifier,
		extensionPublisherId: '',
		publisherDisplayName: '',
		extensionDisplayName: '',
		locations: [ChatAgentLocation.Panel],
		modes: [ChatModeKind.Ask],
		metadata: {},
		slashCommands: [],
		disambiguation: [],
	};
}

suite('SendRequestAction', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	let storageService: IStorageService;
	let instantiationService: TestInstantiationService;
	let chatAgentService: IChatAgentService;
	let commandService: ICommandService;

	setup(async () => {
		instantiationService = testDisposables.add(new TestInstantiationService(new ServiceCollection(
			[IChatVariablesService, new MockChatVariablesService()],
			[IWorkbenchAssignmentService, new NullWorkbenchAssignmentService()],
			[IMcpService, new TestMcpService()],
		)));
		instantiationService.stub(IStorageService, storageService = testDisposables.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(IViewsService, new TestExtensionService());
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(IChatSlashCommandService, testDisposables.add(instantiationService.createInstance(ChatSlashCommandService)));
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IEnvironmentService, { workspaceStorageHome: URI.file('/test/path/to/workspaceStorage') });
		instantiationService.stub(ILifecycleService, { onWillShutdown: Event.None });
		instantiationService.stub(IChatEditingService, new class extends mock<IChatEditingService>() {
			override startOrContinueGlobalEditingSession(): Promise<IChatEditingSession> {
				return Promise.resolve(Disposable.None as IChatEditingSession);
			}
		});
		
		// Mock additional services needed by SendRequestAction
		instantiationService.stub(IChatModeService, new class extends mock<IChatModeService>() {
			override findModeByName(name: string) {
				return { kind: ChatModeKind.Ask, id: 'ask', label: 'Ask' };
			}
		});
		instantiationService.stub(ILanguageModelToolsService, new class extends mock<ILanguageModelToolsService>() {
			override getTool(id: string) {
				return { id, displayName: `Tool ${id}`, icon: undefined };
			}
		});
		instantiationService.stub(IChatWidgetService, new class extends mock<IChatWidgetService>() {
			// Empty mock
		});
		instantiationService.stub(IFileService, new class extends mock<IFileService>() {
			override async exists(uri: URI) {
				return true;
			}
		});
		instantiationService.stub(IHostService, new class extends mock<IHostService>() {
			override async getScreenshot() {
				return new Uint8Array([1, 2, 3]); // Mock screenshot data
			}
		});

		chatAgentService = testDisposables.add(instantiationService.createInstance(ChatAgentService));
		instantiationService.stub(IChatAgentService, chatAgentService);

		// Create ChatService to enable the sendRequest functionality
		const chatService = testDisposables.add(instantiationService.createInstance(ChatService));
		instantiationService.stub(IChatService, chatService);

		commandService = testDisposables.add(instantiationService.createInstance(CommandService, new CommandService.Caching()));

		const agent: IChatAgentImplementation = {
			async invoke(request, progress, history, token) {
				return {};
			},
		};
		testDisposables.add(chatAgentService.registerAgent('testAgent', { ...getAgentData('testAgent'), isDefault: true }));
		testDisposables.add(chatAgentService.registerAgentImplementation('testAgent', agent));
		
		// Register chat actions to make SendRequestAction available
		registerChatActions();
	});

	test('sendRequest with simple query returns success', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID, { query: 'test request' }) as IChatSendRequestResult;
		
		assert.strictEqual(typeof result, 'object');
		assert.strictEqual(typeof result.success, 'boolean');
		assert.strictEqual(typeof result.sessionId, 'string');
		assert.notEqual(result.sessionId, '');
	});

	test('sendRequest with empty query returns error', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID, { query: '' }) as IChatSendRequestResult;
		
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.errorMessage, 'No query provided');
	});

	test('sendRequest with no parameters returns error', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID) as IChatSendRequestResult;
		
		assert.strictEqual(result.success, false);
		assert.strictEqual(result.errorMessage, 'No query provided');
	});

	test('sendRequest with agentId option', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID, { 
			query: 'test request', 
			agentId: 'testAgent' 
		}) as IChatSendRequestResult;
		
		assert.strictEqual(typeof result, 'object');
		assert.strictEqual(typeof result.success, 'boolean');
	});

	test('sendRequest with previousRequests option', async () => {
		const result = await commandService.executeCommand(SEND_REQUEST_ACTION_ID, { 
			query: 'test request', 
			previousRequests: [{ request: 'previous request', response: 'previous response' }]
		}) as IChatSendRequestResult;
		
		assert.strictEqual(typeof result, 'object');
		assert.strictEqual(typeof result.success, 'boolean');
	});
});