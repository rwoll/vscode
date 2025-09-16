/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ChatWidgetHistoryService } from '../common/chatWidgetHistoryService.js';
import { IChatBranchService } from '../common/chatBranchService.js';
import { mock } from '../../../../base/test/common/mock.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { ChatAgentLocation } from '../common/constants.js';

suite('ChatWidgetHistoryService with Branch Context', () => {
	let historyService: ChatWidgetHistoryService;
	let branchService: IChatBranchService;
	let storageService: IStorageService;
	
	setup(() => {
		storageService = new InMemoryStorageService();
		
		// Mock branch service
		branchService = new class extends mock<IChatBranchService>() {
			private _currentBranch = 'main';
			private _repositoryRoot = '/test/repo';
			
			getCurrentBranch() { return this._currentBranch; }
			getRepositoryRoot() { return this._repositoryRoot; }
			getBranchKey(branch: string | undefined, repo: string | undefined) {
				const repoKey = repo ? repo.replace(/[^a-zA-Z0-9]/g, '_') : 'no-repo';
				const branchKey = branch || 'no-branch';
				return `${repoKey}:${branchKey}`;
			}
			
			// Helper methods for testing
			setBranch(branch: string | undefined) { this._currentBranch = branch; }
			setRepository(repo: string | undefined) { this._repositoryRoot = repo; }
		};
		
		historyService = new ChatWidgetHistoryService(storageService, branchService);
	});
	
	test('should use branch-specific keys when git repository is available', () => {
		const history1 = [{ text: 'Hello from main branch' }];
		historyService.saveHistory(ChatAgentLocation.Chat, history1);
		
		// Switch to different branch
		(branchService as any).setBranch('feature-branch');
		const history2 = [{ text: 'Hello from feature branch' }];
		historyService.saveHistory(ChatAgentLocation.Chat, history2);
		
		// Check that histories are separate
		const retrievedHistory2 = historyService.getHistory(ChatAgentLocation.Chat);
		assert.strictEqual(retrievedHistory2.length, 1);
		assert.strictEqual(retrievedHistory2[0].text, 'Hello from feature branch');
		
		// Switch back to main
		(branchService as any).setBranch('main');
		const retrievedHistory1 = historyService.getHistory(ChatAgentLocation.Chat);
		assert.strictEqual(retrievedHistory1.length, 1);
		assert.strictEqual(retrievedHistory1[0].text, 'Hello from main branch');
	});
	
	test('should fallback to non-branch-specific keys when no git repository', () => {
		// Set no repository
		(branchService as any).setRepository(undefined);
		(branchService as any).setBranch(undefined);
		
		const history = [{ text: 'Hello without git' }];
		historyService.saveHistory(ChatAgentLocation.Chat, history);
		
		const retrieved = historyService.getHistory(ChatAgentLocation.Chat);
		assert.strictEqual(retrieved.length, 1);
		assert.strictEqual(retrieved[0].text, 'Hello without git');
	});
	
	test('should maintain separate histories for different chat locations', () => {
		const chatHistory = [{ text: 'Chat panel history' }];
		const terminalHistory = [{ text: 'Terminal history' }];
		
		historyService.saveHistory(ChatAgentLocation.Chat, chatHistory);
		historyService.saveHistory(ChatAgentLocation.Terminal, terminalHistory);
		
		const retrievedChat = historyService.getHistory(ChatAgentLocation.Chat);
		const retrievedTerminal = historyService.getHistory(ChatAgentLocation.Terminal);
		
		assert.strictEqual(retrievedChat[0].text, 'Chat panel history');
		assert.strictEqual(retrievedTerminal[0].text, 'Terminal history');
	});
});