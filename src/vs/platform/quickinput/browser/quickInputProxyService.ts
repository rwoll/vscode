/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IQuickAccessController } from '../common/quickAccess.js';
import { IInputBox, IInputOptions, IKeyMods, IPickOptions, IQuickInputButton, IQuickInputService, IQuickNavigateConfiguration, IQuickPick, IQuickPickItem, IQuickTree, IQuickTreeItem, IQuickWidget, QuickPickInput } from '../common/quickInput.js';
import { IQuickInputDebugEvent, IQuickInputDebugService } from '../common/quickInputDebugIpc.js';

export const IQuickInputProxyService = createDecorator<IQuickInputProxyService>('quickInputProxyService');

export interface IQuickInputProxyService extends IQuickInputService {
	setDebuggingEnabled(enabled: boolean): void;
}

export class QuickInputProxyService extends Disposable implements IQuickInputProxyService {
	declare readonly _serviceBrand: undefined;

	private _debuggingEnabled = false;

	constructor(
		private readonly realService: IQuickInputService,
		private readonly debugService: IQuickInputDebugService
	) {
		super();
	}

	setDebuggingEnabled(enabled: boolean): void {
		this._debuggingEnabled = enabled;
	}

	private logEvent(operation: string, data: any, result?: any, error?: string, startTime?: number): void {
		if (!this._debuggingEnabled) {
			return;
		}

		const event: IQuickInputDebugEvent = {
			timestamp: Date.now(),
			operation,
			duration: startTime ? Date.now() - startTime : undefined,
			...data,
			result,
			error
		};
		
		this.debugService.logPickOperation(event);
	}

	// Proxy all IQuickInputService methods
	get backButton(): IQuickInputButton {
		return this.realService.backButton;
	}

	get onShow(): Event<void> {
		return this.realService.onShow;
	}

	get onHide(): Event<void> {
		return this.realService.onHide;
	}

	get currentQuickInput() {
		return this.realService.currentQuickInput;
	}

	get quickAccess(): IQuickAccessController {
		return this.realService.quickAccess;
	}

	async pick<T extends IQuickPickItem, O extends IPickOptions<T>>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], 
		options?: O, 
		token: CancellationToken = CancellationToken.None
	): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		const startTime = Date.now();
		
		this.logEvent('pick.start', {
			picks: Array.isArray(picks) ? picks : '[Promise]',
			options
		}, undefined, undefined, startTime);

		try {
			const result = await this.realService.pick(picks, options, token);
			
			this.logEvent('pick.success', {
				picks: Array.isArray(picks) ? picks : '[Promise]',
				options
			}, result, undefined, startTime);

			return result;
		} catch (error: any) {
			this.logEvent('pick.error', {
				picks: Array.isArray(picks) ? picks : '[Promise]',
				options
			}, undefined, error?.message || String(error), startTime);

			throw error;
		}
	}

	async input(options: IInputOptions = {}, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {
		const startTime = Date.now();
		
		this.logEvent('input.start', { options }, undefined, undefined, startTime);

		try {
			const result = await this.realService.input(options, token);
			
			this.logEvent('input.success', { options }, result, undefined, startTime);

			return result;
		} catch (error: any) {
			this.logEvent('input.error', { options }, undefined, error?.message || String(error), startTime);

			throw error;
		}
	}

	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;
	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: boolean } = { useSeparators: false }): IQuickPick<T, { useSeparators: boolean }> {
		this.logEvent('createQuickPick', { options });
		return this.realService.createQuickPick(options as any);
	}

	createInputBox(): IInputBox {
		this.logEvent('createInputBox', {});
		return this.realService.createInputBox();
	}

	createQuickWidget(): IQuickWidget {
		this.logEvent('createQuickWidget', {});
		return this.realService.createQuickWidget();
	}

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T> {
		this.logEvent('createQuickTree', {});
		return this.realService.createQuickTree();
	}

	focus(): void {
		this.logEvent('focus', {});
		this.realService.focus();
	}

	toggle(): void {
		this.logEvent('toggle', {});
		this.realService.toggle();
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void {
		this.logEvent('navigate', { next, quickNavigate });
		this.realService.navigate(next, quickNavigate);
	}

	accept(keyMods?: IKeyMods): Promise<void> {
		this.logEvent('accept', { keyMods });
		return this.realService.accept(keyMods);
	}

	back(): Promise<void> {
		this.logEvent('back', {});
		return this.realService.back();
	}

	cancel(): Promise<void> {
		this.logEvent('cancel', {});
		return this.realService.cancel();
	}
}