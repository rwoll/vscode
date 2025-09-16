/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPickOptions, IInputOptions, IQuickInputService, IQuickInput, IQuickPick, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { ExtHostContext, MainThreadQuickOpenShape, ExtHostQuickOpenShape, TransferQuickPickItem, MainContext, TransferQuickInput, TransferQuickInputButton, IInputBoxOptions, TransferQuickPickItemOrSeparator } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { URI } from '../../../base/common/uri.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IQuickInputDebugInterceptor } from '../../../platform/quickinput/common/quickInputDebug.js';
import { QuickInputDebugInterceptor } from '../../../platform/quickinput/browser/quickInputDebugInterceptor.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';

interface QuickInputSession {
	input: IQuickInput;
	handlesToItems: Map<number, TransferQuickPickItem>;
	store: DisposableStore;
}

function reviveIconPathUris(iconPath: { dark: URI; light?: URI | undefined }) {
	iconPath.dark = URI.revive(iconPath.dark);
	if (iconPath.light) {
		iconPath.light = URI.revive(iconPath.light);
	}
}

@extHostNamedCustomer(MainContext.MainThreadQuickOpen)
export class MainThreadQuickOpen implements MainThreadQuickOpenShape {

	private readonly _proxy: ExtHostQuickOpenShape;
	private readonly _quickInputService: IQuickInputService;
	private readonly _debugInterceptor: IQuickInputDebugInterceptor;
	private readonly _items: Record<number, {
		resolve(items: TransferQuickPickItemOrSeparator[]): void;
		reject(error: Error): void;
	}> = {};

	constructor(
		extHostContext: IExtHostContext,
		@IQuickInputService quickInputService: IQuickInputService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostQuickOpen);
		this._quickInputService = quickInputService;
		this._debugInterceptor = new QuickInputDebugInterceptor(configurationService);
	}

	public dispose(): void {
		this._debugInterceptor.dispose();
		for (const [_id, session] of this.sessions) {
			session.store.dispose();
		}
	}

	/**
	 * Get the debug interceptor for external access (e.g., IPC channels)
	 */
	public getDebugInterceptor(): IQuickInputDebugInterceptor {
		return this._debugInterceptor;
	}

	$show(instance: number, options: IPickOptions<TransferQuickPickItem>, token: CancellationToken): Promise<number | number[] | undefined> {
		const startTime = this._debugInterceptor.logOperation('$show', [instance, options]);
		
		const contents = new Promise<TransferQuickPickItemOrSeparator[]>((resolve, reject) => {
			this._items[instance] = { resolve, reject };
		});

		options = {
			...options,
			onDidFocus: el => {
				if (el) {
					this._proxy.$onItemSelected((<TransferQuickPickItem>el).handle);
				}
			}
		};

		if (options.canPickMany) {
			return this._quickInputService.pick(contents, options as { canPickMany: true }, token)
				.then(items => {
					const result = items ? items.map(item => item.handle) : undefined;
					this._debugInterceptor.logResult(startTime, result);
					return result;
				})
				.catch(error => {
					this._debugInterceptor.logError(startTime, error);
					throw error;
				});
		} else {
			return this._quickInputService.pick(contents, options, token)
				.then(item => {
					const result = item ? item.handle : undefined;
					this._debugInterceptor.logResult(startTime, result);
					return result;
				})
				.catch(error => {
					this._debugInterceptor.logError(startTime, error);
					throw error;
				});
		}
	}

	$setItems(instance: number, items: TransferQuickPickItemOrSeparator[]): Promise<void> {
		if (this._items[instance]) {
			this._items[instance].resolve(items);
			delete this._items[instance];
		}
		return Promise.resolve();
	}

	$setError(instance: number, error: Error): Promise<void> {
		if (this._items[instance]) {
			this._items[instance].reject(error);
			delete this._items[instance];
		}
		return Promise.resolve();
	}

	// ---- input

	$input(options: IInputBoxOptions | undefined, validateInput: boolean, token: CancellationToken): Promise<string | undefined> {
		const startTime = this._debugInterceptor.logOperation('$input', [options, validateInput]);
		
		const inputOptions: IInputOptions = Object.create(null);

		if (options) {
			inputOptions.title = options.title;
			inputOptions.password = options.password;
			inputOptions.placeHolder = options.placeHolder;
			inputOptions.valueSelection = options.valueSelection;
			inputOptions.prompt = options.prompt;
			inputOptions.value = options.value;
			inputOptions.ignoreFocusLost = options.ignoreFocusOut;
		}

		if (validateInput) {
			inputOptions.validateInput = (value) => {
				return this._proxy.$validateInput(value);
			};
		}

		return this._quickInputService.input(inputOptions, token)
			.then(result => {
				this._debugInterceptor.logResult(startTime, result);
				return result;
			})
			.catch(error => {
				this._debugInterceptor.logError(startTime, error);
				throw error;
			});
	}

	// ---- QuickInput

	private sessions = new Map<number, QuickInputSession>();

	$createOrUpdate(params: TransferQuickInput): Promise<void> {
		const sessionId = params.id;
		let session = this.sessions.get(sessionId);
		if (!session) {
			const store = new DisposableStore();
			const input = params.type === 'quickPick' ? this._quickInputService.createQuickPick() : this._quickInputService.createInputBox();
			store.add(input);
			store.add(input.onDidAccept(() => {
				this._proxy.$onDidAccept(sessionId);
			}));
			store.add(input.onDidTriggerButton(button => {
				this._proxy.$onDidTriggerButton(sessionId, (button as TransferQuickInputButton).handle);
			}));
			store.add(input.onDidChangeValue(value => {
				this._proxy.$onDidChangeValue(sessionId, value);
			}));
			store.add(input.onDidHide(() => {
				this._proxy.$onDidHide(sessionId);
			}));

			if (params.type === 'quickPick') {
				// Add extra events specific for quickpick
				const quickpick = input as IQuickPick<IQuickPickItem>;
				store.add(quickpick.onDidChangeActive(items => {
					this._proxy.$onDidChangeActive(sessionId, items.map(item => (item as TransferQuickPickItem).handle));
				}));
				store.add(quickpick.onDidChangeSelection(items => {
					this._proxy.$onDidChangeSelection(sessionId, items.map(item => (item as TransferQuickPickItem).handle));
				}));
				store.add(quickpick.onDidTriggerItemButton((e) => {
					this._proxy.$onDidTriggerItemButton(sessionId, (e.item as TransferQuickPickItem).handle, (e.button as TransferQuickInputButton).handle);
				}));
			}

			session = {
				input,
				handlesToItems: new Map(),
				store
			};
			this.sessions.set(sessionId, session);
		}
		const { input, handlesToItems } = session;
		for (const param in params) {
			if (param === 'id' || param === 'type') {
				continue;
			}
			if (param === 'visible') {
				if (params.visible) {
					input.show();
				} else {
					input.hide();
				}
			} else if (param === 'items') {
				handlesToItems.clear();
				params[param].forEach((item: TransferQuickPickItemOrSeparator) => {
					if (item.type === 'separator') {
						return;
					}

					if (item.buttons) {
						item.buttons = item.buttons.map((button: TransferQuickInputButton) => {
							if (button.iconPath) {
								reviveIconPathUris(button.iconPath);
							}

							return button;
						});
					}
					handlesToItems.set(item.handle, item);
				});
				(input as any)[param] = params[param];
			} else if (param === 'activeItems' || param === 'selectedItems') {
				(input as any)[param] = params[param]
					.filter((handle: number) => handlesToItems.has(handle))
					.map((handle: number) => handlesToItems.get(handle));
			} else if (param === 'buttons') {
				(input as any)[param] = params.buttons!.map(button => {
					if (button.handle === -1) {
						return this._quickInputService.backButton;
					}

					if (button.iconPath) {
						reviveIconPathUris(button.iconPath);
					}

					return button;
				});
			} else {
				(input as any)[param] = params[param];
			}
		}
		return Promise.resolve(undefined);
	}

	$dispose(sessionId: number): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.store.dispose();
			this.sessions.delete(sessionId);
		}
		return Promise.resolve(undefined);
	}
}
