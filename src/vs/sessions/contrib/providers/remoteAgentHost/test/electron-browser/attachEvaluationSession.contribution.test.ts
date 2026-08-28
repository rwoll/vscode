/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import type { RecordedTimerEvent } from '../../../../../../base/test/common/virtualScheduling/index.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { AgentSession } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostEvaluationSessionAttachmentService, IAgentHostEvaluationSessionAttachmentService } from '../../../../../../platform/agentHost/common/agentHostEvaluationSessionAttachment.js';
import type { NativeParsedArgs } from '../../../../../../platform/environment/common/argv.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { INativeWorkbenchEnvironmentService } from '../../../../../../workbench/services/environment/electron-browser/environmentService.js';
import type { ISession } from '../../../../../services/sessions/common/session.js';
import { ISessionsManagementService, type ISessionsChangeEvent } from '../../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../../services/sessions/browser/sessionsService.js';
import {
	ATTACH_EVALUATION_SESSION_BUDGET_MS,
	ATTACH_TO_EVALUATION_SESSION_ARG,
	AttachEvaluationSessionContribution,
	parseAttachEvaluationSessionDirective,
} from '../../electron-browser/attachEvaluationSession.contribution.js';

const SESSION_RESOURCE = URI.from({ scheme: 'remote-local-copilot', path: '/session-abc' });
const DIRECTIVE = SESSION_RESOURCE.toString();
const BACKEND_SESSION = AgentSession.uri('copilot', 'session-abc');

interface IRecordedOpen {
	readonly resource: string;
	readonly options: { preserveFocus?: boolean } | undefined;
}

suite('AttachEvaluationSessionContribution', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let openedSessions: IRecordedOpen[];
	let listedSessions: Set<string>;
	let sessionsChanged: Emitter<ISessionsChangeEvent>;
	let sessionsServiceReads: number;
	let openError: Error | undefined;
	let attachmentService: AgentHostEvaluationSessionAttachmentService;
	let whenOpened: Promise<void>;
	let signalOpened: () => void;

	setup(() => {
		openedSessions = [];
		listedSessions = new Set([DIRECTIVE]);
		sessionsChanged = store.add(new Emitter<ISessionsChangeEvent>());
		sessionsServiceReads = 0;
		openError = undefined;
		attachmentService = new AgentHostEvaluationSessionAttachmentService();
		whenOpened = new Promise<void>(resolve => { signalOpened = resolve; });
	});

	function createContribution(directive: string | undefined): DisposableStore {
		const disposables = store.add(new DisposableStore());
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IAgentHostEvaluationSessionAttachmentService, attachmentService);
		instantiationService.stub(INativeWorkbenchEnvironmentService, new class extends mock<INativeWorkbenchEnvironmentService>() {
			override readonly args = { [ATTACH_TO_EVALUATION_SESSION_ARG]: directive } as NativeParsedArgs;
		});
		instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
			override async openSession(resource: URI, options?: { preserveFocus?: boolean }): Promise<void> {
				sessionsServiceReads++;
				openedSessions.push({ resource: resource.toString(), options });
				signalOpened();
				if (openError) {
					throw openError;
				}
			}
		});
		instantiationService.stub(ISessionsManagementService, new class extends mock<ISessionsManagementService>() {
			override readonly onDidChangeSessions = sessionsChanged.event;
			override getSession(resource: URI): ISession | undefined {
				return listedSessions.has(resource.toString()) ? {} as ISession : undefined;
			}
		});
		disposables.add(instantiationService.createInstance(AttachEvaluationSessionContribution));
		return disposables;
	}

	suite('directive', () => {

		test('accepts only the canonical form of a remote Agent Host session URI', () => {
			assert.strictEqual(parseAttachEvaluationSessionDirective(DIRECTIVE)?.toString(), DIRECTIVE);
			assert.strictEqual(parseAttachEvaluationSessionDirective('REMOTE-local-copilot:/session-abc'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:/session abc'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('agent:/session-abc'), undefined);
		});

		test('rejects missing or malformed values', () => {
			assert.strictEqual(parseAttachEvaluationSessionDirective(undefined), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective(''), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective(42 as unknown as string), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:/'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('not a uri'), undefined);
		});
	});

	suite('startup', () => {

		test('registers and opens nothing without the launch argument', async () => {
			createContribution(undefined);
			await Promise.resolve();
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(sessionsServiceReads, 0);
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});

		test('opens only the exact listed session and registers its backend', async () => {
			createContribution(DIRECTIVE);
			await whenOpened;
			assert.deepStrictEqual(openedSessions, [{ resource: DIRECTIVE, options: { preserveFocus: false } }]);
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), true);
			assert.strictEqual(attachmentService.isAttached(AgentSession.uri('copilot', 'session-other')), false);
		});

		test('failed open clears the registration', async () => {
			openError = new Error('open failed');
			createContribution(DIRECTIVE);
			await whenOpened;
			await Promise.resolve();
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});

		test('definitive session removal clears the registration', async () => {
			createContribution(DIRECTIVE);
			await whenOpened;
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), true);
			listedSessions.delete(DIRECTIVE);
			sessionsChanged.fire({} as ISessionsChangeEvent);
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});

		test('window disposal clears the registration immediately', async () => {
			const disposables = createContribution(DIRECTIVE);
			await whenOpened;
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), true);
			disposables.dispose();
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});

		test('waits for listing before opening without polling', async () => {
			let history: readonly RecordedTimerEvent[] = [];
			await runWithFakedTimers({ useFakeTimers: false, onHistory: recorded => { history = recorded; } }, async () => {
				listedSessions.clear();
				createContribution(DIRECTIVE);
				await Promise.resolve();
				assert.strictEqual(openedSessions.length, 0);

				listedSessions.add(DIRECTIVE);
				sessionsChanged.fire({} as ISessionsChangeEvent);
				await whenOpened;
				assert.deepStrictEqual(openedSessions.map(open => open.resource), [DIRECTIVE]);
			});
			assert.deepStrictEqual(history, []);
		});

		test('ignores unrelated listing changes', async () => {
			listedSessions.clear();
			const disposables = createContribution(DIRECTIVE);
			listedSessions.add('remote-local-copilot:/other-session');
			sessionsChanged.fire({} as ISessionsChangeEvent);
			await Promise.resolve();
			assert.strictEqual(openedSessions.length, 0);
			disposables.dispose();
		});

		test('cancellation abandons an unlisted session and leaves no registration', async () => {
			await runWithFakedTimers({}, async () => {
				listedSessions.clear();
				const disposables = createContribution(DIRECTIVE);
				await new Promise(resolve => setTimeout(resolve, ATTACH_EVALUATION_SESSION_BUDGET_MS + 1));
				assert.strictEqual(openedSessions.length, 0);
				assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
				disposables.dispose();
			});
		});

		test('disposing while waiting prevents a later listing from attaching', async () => {
			listedSessions.clear();
			const disposables = createContribution(DIRECTIVE);
			disposables.dispose();
			listedSessions.add(DIRECTIVE);
			sessionsChanged.fire({} as ISessionsChangeEvent);
			await Promise.resolve();
			assert.strictEqual(openedSessions.length, 0);
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});
	});

	suite('attachment service', () => {

		test('matches only the exact backend session and clears after final disposal', () => {
			const first = attachmentService.register(SESSION_RESOURCE);
			const second = attachmentService.register(SESSION_RESOURCE);
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), true);
			assert.strictEqual(attachmentService.isAttached(AgentSession.uri('copilot', 'session-other')), false);
			assert.strictEqual(attachmentService.isAttached(AgentSession.uri('other', 'session-abc')), false);

			first.dispose();
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), true);
			second.dispose();
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});

		test('rejects resources outside the remote Agent Host session namespace', () => {
			assert.throws(() => attachmentService.register(URI.parse('agent:/session-abc')));
			assert.throws(() => attachmentService.register(URI.parse('remote-local-copilot:/')));
			assert.strictEqual(attachmentService.isAttached(BACKEND_SESSION), false);
		});
	});
});
