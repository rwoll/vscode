/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { InstantiationService } from '../../../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ChatBranchService, IChatBranchService } from '../common/chatBranchService.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ISCMService } from '../../scm/common/scm.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

suite('ChatBranchService', () => {
	let branchService: ChatBranchService;
	let instantiationService: TestInstantiationService;
	
	setup(() => {
		instantiationService = new TestInstantiationService();
		
		// Mock SCM service
		const mockScmService = new class extends mock<ISCMService>() {
			repositories = [];
			onDidAddRepository = () => ({ dispose: () => {} });
			onDidRemoveRepository = () => ({ dispose: () => {} });
		};
		
		// Mock workspace context service
		const mockWorkspaceService = new class extends mock<IWorkspaceContextService>() {};
		
		instantiationService.stub(ISCMService, mockScmService);
		instantiationService.stub(IWorkspaceContextService, mockWorkspaceService);
		
		branchService = instantiationService.createInstance(ChatBranchService);
	});
	
	test('should generate unique branch keys', () => {
		const key1 = branchService.getBranchKey('main', '/path/to/repo');
		const key2 = branchService.getBranchKey('feature', '/path/to/repo');
		const key3 = branchService.getBranchKey('main', '/path/to/other-repo');
		
		assert.notStrictEqual(key1, key2, 'Different branches should have different keys');
		assert.notStrictEqual(key1, key3, 'Same branch in different repos should have different keys');
		assert.strictEqual(key1, branchService.getBranchKey('main', '/path/to/repo'), 'Same branch and repo should have same key');
	});
	
	test('should handle undefined branch and repository', () => {
		const key1 = branchService.getBranchKey(undefined, undefined);
		const key2 = branchService.getBranchKey('main', undefined);
		const key3 = branchService.getBranchKey(undefined, '/path/to/repo');
		
		assert.ok(key1, 'Should handle undefined values');
		assert.ok(key2, 'Should handle undefined repository');
		assert.ok(key3, 'Should handle undefined branch');
	});
	
	test('should sanitize repository paths for safe keys', () => {
		const key = branchService.getBranchKey('main', '/path/with spaces/and-special@chars');
		assert.ok(key.includes('path_with_spaces_and_special_chars'), 'Should sanitize repository path');
	});
});