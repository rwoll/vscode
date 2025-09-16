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
		
		// If we found a repository, try to initialize immediately
		this.initializeFromExistingRepositories();
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
		let repoKey = 'no-repo';
		if (repositoryRoot) {
			// Sanitize repository path to create a safe key
			// Remove any non-alphanumeric characters and limit length
			repoKey = repositoryRoot
				.replace(/[^a-zA-Z0-9]/g, '_')
				.substring(0, 50) // Limit length to prevent overly long keys
				.toLowerCase();
		}
		
		const branchKey = (branch || 'no-branch').substring(0, 50); // Limit branch name length too
		return `${repoKey}:${branchKey}`;
	}

	private onRepositoryAdded(repository: any): void {
		this.logService.trace('[ChatBranchService] Repository added:', repository?.provider?.label || 'unknown');
		
		// Check if this is a git repository 
		// The repository object is an ISCMRepository with a provider
		if (repository?.provider?.id === 'git') {
			const rootUri = repository.provider.rootUri;
			this._repositoryRoot = rootUri?.fsPath;
			this.updateCurrentBranch(repository);
			
			// Listen for resource changes which indicate repository state changes
			// This is safer than trying to access specific git events
			this._register(repository.provider.onDidChangeResources(() => {
				this.debouncedUpdateBranch(repository);
			}));
		}
	}

	private onRepositoryRemoved(repository: any): void {
		const removedRoot = repository?.provider?.rootUri?.fsPath;
		this.logService.trace('[ChatBranchService] Repository removed:', removedRoot);
		
		if (removedRoot === this._repositoryRoot) {
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

	private initializeFromExistingRepositories(): void {
		// Try to find a git repository if we haven't found one yet
		if (!this._repositoryRoot && !this._currentBranch) {
			for (const repository of this.scmService.repositories) {
				if (repository.provider?.id === 'git') {
					this.updateCurrentBranch(repository);
					break; // Use the first git repository we find
				}
			}
		}
	}

	@debounce(100)
	private debouncedUpdateBranch(repository: any): void {
		this.updateCurrentBranch(repository);
	}

	private updateCurrentBranch(repository: any): void {
		try {
			// For git repositories, we need to access the branch through the provider's state
			// Different git extensions might expose this differently
			let newBranch: string | undefined;
			let repositoryRoot: string | undefined;
			
			if (repository?.provider) {
				repositoryRoot = repository.provider.rootUri?.fsPath;
				
				// Try different ways to access the current branch
				// This depends on how the git extension exposes the branch information
				// We'll use a safe approach that works with different git extension implementations
				if (repository.provider.HEAD) {
					newBranch = repository.provider.HEAD.name;
				} else if (repository.provider.state?.HEAD) {
					newBranch = repository.provider.state.HEAD.name;
				}
				// Additional fallback - check for branch in label or status
				else if (repository.provider.label && repository.provider.label.includes('(')) {
					// Some implementations include branch in label like "Git (main)"
					const match = repository.provider.label.match(/\(([^)]+)\)$/);
					if (match) {
						newBranch = match[1];
					}
				}
			}

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