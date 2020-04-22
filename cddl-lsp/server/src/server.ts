import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Hover,
	HoverParams,
	MarkupContent,
} from 'vscode-languageserver';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import * as wasm from 'cddl';
import { standardPrelude, controlOperators } from './keywords';
import { WorkDoneProgress } from 'vscode-languageserver/lib/progress';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let hasDiagnosticRelatedInformationCapability: boolean = false;

let cddl: any;

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.']
			},
			hoverProvider: true,
			definitionProvider: true,
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	let settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all uppercase words length 2 and more
	let text = textDocument.getText();

	let errors: any[] = [];
	try {
		cddl = wasm.cddl_from_str(text);
	} catch (e) {
		errors = e;
	}

	let diagnostics: Diagnostic[] = [];
	while (errors.length < settings.maxNumberOfProblems) {
		for (const error of errors) {
			let diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: textDocument.positionAt(error.position.range[0]),
					end: textDocument.positionAt(error.position.range[1])
				},
				message: error.message,
				source: 'cddl'
			};
			// if (hasDiagnosticRelatedInformationCapability) {
			// 	diagnostic.relatedInformation = [
			// 		{
			// 			location: {
			// 				uri: textDocument.uri,
			// 				range: Object.assign({}, diagnostic.range)
			// 			},
			// 			message: 'Spelling matters'
			// 		},
			// 		{
			// 			location: {
			// 				uri: textDocument.uri,
			// 				range: Object.assign({}, diagnostic.range)
			// 			},
			// 			message: 'Particularly for names'
			// 		}
			// 	];
			// }
			diagnostics.push(diagnostic);
		}

		break;
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

let triggeredOnControl = false;

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		let completionItems: CompletionItem[] = [];

		let char = documents.get(textDocumentPosition.textDocument.uri)?.getText({ start: { character: textDocumentPosition.position.character - 1, line: textDocumentPosition.position.line }, end: textDocumentPosition.position });

		if (char === '.') {
			triggeredOnControl = true;

			for (let index = 0; index < controlOperators.length; index++) {
				completionItems[index] = {
					label: controlOperators[index].label,
					kind: CompletionItemKind.Keyword,
					data: index,
					documentation: controlOperators[index].documentation
				};
			}


			return completionItems;
		}

		for (let index = 0; index < standardPrelude.length; index++) {
			completionItems[index] = {
				label: standardPrelude[index].label,
				kind: CompletionItemKind.Keyword,
				data: index,
				documentation: standardPrelude[index].documentation
			};
		}

		return completionItems;
	}
);


// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (triggeredOnControl) {
			for (let index = 0; index < controlOperators.length; index++) {
				if (item.data === index) {
					item.insertText = item.label.substring(1);
					return item;
				}
			}
		}

		for (let index = 0; index < standardPrelude.length; index++) {
			if (item.data === index) {
				item.detail = standardPrelude[index].detail;
				break;
			}
		}

		return item;
	}
);

connection.onHover(
	(params: HoverParams): Hover | undefined => {
		let identifier = getIdentifierAtPosition(params);

		if (identifier === undefined) {
			return undefined;
		}

		for (const itemDetail of standardPrelude) {
			if (identifier === itemDetail.label) {
				return {
					contents: itemDetail.detail
				};
			}
		}

		for (const itemDetail of controlOperators) {
			if (identifier == itemDetail.label) {
				return {
					contents: itemDetail.documentation ? itemDetail.documentation as MarkupContent : itemDetail.detail
				};
			}
		}
	}
);

connection.onDefinition(params => {
	let ident = getIdentifierAtPosition(params);

	let document = documents.get(params.textDocument.uri);

	if (document === undefined) {
		return undefined;
	}

	if (ident) {
		for (const rule of cddl.rules) {
			if (rule.Type) {
				if (rule.Type.rule.name.ident === ident) {
					let start_position = document.positionAt(rule.Type.rule.name.span[0]);
					let end_position = document.positionAt(rule.Type.rule.name.span[1]);

					return {
						uri: params.textDocument.uri,
						range: {
							start: {
								character: start_position.character,
								line: start_position.line,
							},
							end: {
								character: end_position.character,
								line: end_position.line
							}
						}
					};
				}

				if (rule.Type.rule.generic_param) {
					for (const gp of rule.Type.rule.generic_param.params) {
						if (gp.ident === ident) {
							let start_position = document.positionAt(gp.span[0]);
							let end_position = document.positionAt(gp.span[1]);

							return {
								uri: params.textDocument.uri,
								range: {
									start: {
										character: start_position.character,
										line: start_position.line,
									},
									end: {
										character: end_position.character,
										line: end_position.line
									}
								}
							};
						}
					}
				}
			}

			if (rule.Group && rule.Group.rule.name.ident === ident) {
				let start_position = document.positionAt(rule.Group.rule.name.span[0]);
				let end_position = document.positionAt(rule.Group.rule.name.span[1]);

				return {
					uri: params.textDocument.uri,
					range: {
						start: {
							character: start_position.character,
							line: start_position.line,
						},
						end: {
							character: end_position.character,
							line: end_position.line
						}
					}
				};
			}
		}
	}

	return undefined;
});


function getIdentifierAtPosition(docParams: TextDocumentPositionParams): string | undefined {
	let document = documents.get(docParams.textDocument.uri);

	if (document === undefined) {
		return undefined;
	}

	let documentText = document.getText();
	let offset = document.offsetAt(docParams.position);

	if (offset === undefined) {
		return undefined;
	}

	let start = offset;
	let end = offset;

	if (documentText && (documentText.length < offset || documentText[offset] === ' ')) {
		return undefined;
	}

	while ((documentText[start] !== ' '
		&& documentText[start] !== '<'
		&& documentText[start] !== '>'
		&& documentText[start] !== '{'
		&& documentText[start] !== '}'
		&& documentText[start] !== '\n') && start > 0) {
		start--;
	}
	while ((documentText[end] !== ' '
		&& documentText[end] !== ','
		&& documentText[end] !== '<'
		&& documentText[end] !== '>'
		&& documentText[end] !== '}'
		&& documentText[end] !== '\n') && end < documentText.length) {
		end++;
	}

	return documentText?.substring(start == 0 ? 0 : start + 1, end);
}


/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.textDocument.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.textDocument.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.textDocument.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.textDocument.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
