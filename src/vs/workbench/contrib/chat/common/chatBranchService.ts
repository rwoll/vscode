/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISCMService } from '../../scm/common/scm.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { debounce } from '../../../../base/common/decorators.js';

export const IChatBranchService = createDecorator<IChatBranchService>('IChatBranchService');

export interface IChatBranchChangeEvent {
	previousBranch: string | undefined;
	currentBranch: string | undefined;
	repositoryRoot: string;
}

export interface IChatBranchService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeBranch: Event<IChatBranchChangeEvent>;

	getCurrentBranch(): string | undefined;
	getRepositoryRoot(): string | undefined;
	getBranchKey(branch: string | undefined, repositoryRoot: string | undefined): string;
}

export class ChatBranchService extends Disposable implements IChatBranchService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeBranch = new Emitter<IChatBranchChangeEvent>();
	readonly onDidChangeBranch: Event<IChatBranchChangeEvent> = this._onDidChangeBranch.event;

	private _currentBranch: string | undefined;
	private _repositoryRoot: string | undefined;

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(this.scmService.onDidAddRepository(this.onRepositoryAdded, this));
		this._register(this.scmService.onDidRemoveRepository(this.onRepositoryRemoved, this));

		// Initialize with existing repositories
		for (const repository of this.scmService.repositories) {
			this.onRepositoryAdded(repository);
		}
	}

	getCurrentBranch(): string | undefined {
		return this._currentBranch;
	}

	getRepositoryRoot(): string | undefined {
		return this._repositoryRoot;
	}

	getBranchKey(branch: string | undefined, repositoryRoot: string | undefined): string {
		// Create a unique key that combines repository and branch
		// This ensures branch names are unique across different repositories
		const repoKey = repositoryRoot ? repositoryRoot.replace(/[^a-zA-Z0-9]/g, '_') : 'no-repo';
		const branchKey = branch || 'no-branch';
		return `${repoKey}:${branchKey}`;
	}

	private onRepositoryAdded(repository: any): void {
		this.logService.trace('[ChatBranchService] Repository added:', repository.provider?.rootUri?.fsPath);
		
		// Check if this is a git repository
		if (repository.provider?.id === 'git') {
			this._repositoryRoot = repository.provider.rootUri?.fsPath;
			this.updateCurrentBranch(repository);
			
			// Listen for state changes in the git repository
			this._register(repository.provider.onDidChangeState?.(() => {
				this.debouncedUpdateBranch(repository);
			}));
		}
	}

	private onRepositoryRemoved(repository: any): void {
		this.logService.trace('[ChatBranchService] Repository removed:', repository.provider?.rootUri?.fsPath);
		
		if (repository.provider?.rootUri?.fsPath === this._repositoryRoot) {
			const previousBranch = this._currentBranch;
			const previousRoot = this._repositoryRoot;
			
			this._currentBranch = undefined;
			this._repositoryRoot = undefined;
			
			this._onDidChangeBranch.fire({
				previousBranch,
				currentBranch: undefined,
				repositoryRoot: previousRoot || ''
			});
		}
	}

	@debounce(100)
	private debouncedUpdateBranch(repository: any): void {
		this.updateCurrentBranch(repository);
	}

	private updateCurrentBranch(repository: any): void {
		try {
			// Access the HEAD information from the git repository
			const head = repository.provider?.HEAD;
			const newBranch = head?.name;
			const repositoryRoot = repository.provider?.rootUri?.fsPath;

			if (newBranch !== this._currentBranch || repositoryRoot !== this._repositoryRoot) {
				const previousBranch = this._currentBranch;
				const previousRoot = this._repositoryRoot;

				this._currentBranch = newBranch;
				this._repositoryRoot = repositoryRoot;

				this.logService.trace('[ChatBranchService] Branch changed:', {
					from: previousBranch,
					to: newBranch,
					repository: repositoryRoot
				});

				this._onDidChangeBranch.fire({
					previousBranch,
					currentBranch: newBranch,
					repositoryRoot: repositoryRoot || previousRoot || ''
				});
			}
		} catch (error) {
			this.logService.error('[ChatBranchService] Error updating current branch:', error);
		}
	}
}