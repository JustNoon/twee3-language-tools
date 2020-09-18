import * as vscode from 'vscode';
import * as yaml from 'yaml';
import * as macroListCore from './macros.json';

export interface macro {
	id: number;
	pair: number;
	name: string;
	open: boolean;
	endVariant: boolean;
	range: vscode.Range;
}

export interface macroDef {
	name?: string;
	container?: boolean;
	children?: string[];
	parents?: string[];
	deprecated?: boolean;
	deprecatedSuggestions?: string[];
}

export const decor = vscode.window.createTextEditorDecorationType({
	backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
	borderRadius: "0.25rem",
	textDecoration: "underline"
});

export const macroRegex = /<<(\/|end)?([A-Za-z][\w-]*|[=-])/g;

export const macroList = async function () {
	let list: any = Object.assign(Object.create(null), macroListCore);

	let customList: any = {};
	
	for (let v of await vscode.workspace.findFiles("**/*.twee-config.{json,yaml,yml}")) {
		let file = await vscode.workspace.openTextDocument(v);
		try {
			customList = yaml.parse(file.getText())["sugarcube-2"]?.macros || {};
		} catch(ex) {
			vscode.window.showErrorMessage(`\nCouldn't parse ${file.fileName}!\n\n${ex}\n\n`);
		}
		list = Object.assign(list, customList);
	}

	return list;
};

export const collect = async function (raw: string) {
	const list = await macroList();
	
	let macros: macro[] = [];
	let id = 0;
	let opened: any = {};

	let lines = raw.split(/\r?\n/);
	lines.forEach((line, i) => {
		let re = macroRegex;
		let ex;
		while((ex = re.exec(line)) !== null) {
			let open = true,
				endVariant = false,
				pair = id,
				name = ex[2];

			if (ex[1] === "end") {
				if (list[ex[2]]) {
					endVariant = true;
					open = false;
				} else {
					name = ex[1] + ex[2];
				}
			}

			if (ex[1] === "/" || endVariant) open = false;

			let range = new vscode.Range(i, ex.index, i, ex.index + ex[0].length);

			opened[name] = opened[name] || [];
			if (open) opened[name].push(id);
			else {
				if (opened[name].length) {
					pair = opened[name].pop();
					macros[pair].pair = id;
				}
			}
			
			macros.push({ id, pair, name, open, range, endVariant });

			id++;
		}
	});

	return { list, macros };
};

export const diagnostics = async function (raw: string) {
	let d: vscode.Diagnostic[] = [];

	let collected = await collect(raw);
	
	collected.macros.forEach(el => {
		let cur: macroDef;
		if (el.name.startsWith("end") && collected.list[el.name.substring(3)]) {
			cur = collected.list[el.name.substring(3)];
			el.open = false;
		} else {
			cur = collected.list[el.name];
		}

		if (cur) {
			if (cur.container && el.id === el.pair) {
				d.push({
					severity: vscode.DiagnosticSeverity.Error,
					range: el.range,
					message: `\nMalformed container macro! ${el.open ? "Closing" : "Opening"} '${el.name}' tag not found!\n\n`,
					source: 'sc2-ex',
					code: 101
				});
			} else if (!cur.container && !el.open) {
				d.push({
					severity: vscode.DiagnosticSeverity.Error,
					range: el.range,
					message: `\nIllegal closing tag! '${el.name}' is not a container macro!\n\n`,
					source: 'sc2-ex',
					code: 104
				});
			} else if (el.endVariant && vscode.workspace.getConfiguration("twee3LanguageTools.sugarcube-2").get("endMacroWarnings")) {
				d.push({
					severity: vscode.DiagnosticSeverity.Warning,
					range: el.range,
					message: `\n'<<end...>>' closing macros are deprecated! Use '<</${el.name}>>' instead.\n\n`,
					source: 'sc2-ex',
					code: 102
				});
			} else if (cur.deprecated && vscode.workspace.getConfiguration("twee3LanguageTools.sugarcube-2").get("deprecatedMacroWarnings")) {
				let suggestions = cur.deprecatedSuggestions?.reduce((a, c) => {
					return a + `- ${c}\n`
				}, "");
				d.push({
					severity: vscode.DiagnosticSeverity.Warning,
					range: el.range,
					message:
						`\nDeprecated macro!\n\n` +
						(suggestions ? `Instead use:\n${suggestions}\n` : ""),
					source: 'sc2-ex',
					code: 103
				});
			}
		} else if (vscode.workspace.getConfiguration("twee3LanguageTools.sugarcube-2").get("undefinedMacroWarnings")) {
			d.push({
				severity: vscode.DiagnosticSeverity.Warning,
				range: el.range,
				message: `\nUnrecognized macro! '${el.name}' has not been defined in config files!\n\n`,
				source: 'sc2-ex',
				code: 100
			});
		}
	});

	return d;
};