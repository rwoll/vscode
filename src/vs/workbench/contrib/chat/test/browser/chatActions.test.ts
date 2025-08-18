/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IChatViewOpenOptions } from '../../browser/actions/chatActions.js';

suite('ChatActions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('IChatViewOpenOptions should support model field', () => {
		// Test that the interface now supports the model field
		const options: IChatViewOpenOptions = {
			query: 'test query',
			model: {
				vendor: 'test-vendor',
				id: 'test-model-id',
				family: 'test-family'
			}
		};

		assert.strictEqual(options.query, 'test query');
		assert.strictEqual(options.model?.vendor, 'test-vendor');
		assert.strictEqual(options.model?.id, 'test-model-id');
		assert.strictEqual(options.model?.family, 'test-family');
	});

	test('IChatViewOpenOptions model field should be optional', () => {
		// Test that the model field is optional
		const options: IChatViewOpenOptions = {
			query: 'test query'
		};

		assert.strictEqual(options.query, 'test query');
		assert.strictEqual(options.model, undefined);
	});
});