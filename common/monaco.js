const langID = 'LuneScript';
const startCompleteLen = 2;

function setupLanguage( frontend ) {
    monaco.languages.register({
        id: langID,
    });

    monaco.languages.setMonarchTokensProvider( langID, {
        keywords: [
	    "self", "fn", "elseif", "else", "while", "repeat", "for",
	    "apply", "of", "foreach", "forsort", "in", "return", "class", "false",
	    "nil", "null", "true", "switch", "match", "case", "default", "_default",
	    "extend", "proto",
	    "override", "macro", "let", "unwrap", "if", "module", "subfile", "allmut",
	    "mut", "__init", "local", "pub", "pro", "pri", "form", "advertise", "provide" ,
	    "wrap", "static", "global", "sync", "then", "do", "interface", "enum",
	    "glue", "when", "alge", "non", "alias", "dep",
	    "abstract", "final", "trust", "import", "import\\.l", "import\\.d",
	    "as", "not", "and", "or", "break", "new",
        ],
        types: [
	    "int", "real", "sym", "stat", "stem",
	    "Map", "Array", "List", "Set", "str", "bool"
        ],
        symbols:  /[@=><!~?:&|+\-*\/\^%]+/,
        operators: [
            '+', '-', '*', '/', '^', '%', '&', '~', '|', '|>>', '|<<',
            '..', '<', '<=', '>', '>=', '==', '~=', '@',  
            '@@', '@@@', '=', '-', '#', '~', '`{', ',,', ',,,', ',,,,',
        ],
        opeSym: [
            'and', 'or', 'not', 
        ],
        
        tokenizer: {
            root: [
                [/[a-z_$][\w$]*/, {
                    cases: {
                        //'@typeKeywords': 'keyword',
                        '@keywords': 'keyword',
                        '@opeSym': 'operator',
                        '@types': 'type',
                        //'@default': 'identifier'
                    }
                }],
                // numbers
                [/\d*\.\d+([eE][\-+]?\d+)?[fFdD]?/, 'number.float'],
                [/0[xX][0-9a-fA-F_]*[0-9a-fA-F][Ll]?/, 'number.hex'],
                [/0[0-7_]*[0-7][Ll]?/, 'number.octal'],
                [/0[bB][0-1_]*[0-1][Ll]?/, 'number.binary'],
                [/\d+[lL]?/, 'number'],

                // strings
                { include: "@whitespace" },
                { include: "@strings" },

                // [/@symbols/, { cases: { '@operators': 'delimiter',
                //                         '@default'  : '' } } ],
            ],
            whitespace: [
                [/\s+/, "white"],
                [/```/, "string", "@endDblDocString"],
                [/\/\*/, "comment", "@comment"],
                [/\/\/.*$/, "comment"],
            ],
            comment: [
                [/[^\/*]+/, "comment"],
                [/\*\//, "comment", "@pop"],
                [/[\/*]/, "comment"]
            ],
            endDblDocString: [
                [/[^`]+/, "string"],
                [/\\`/, "string"],
                [/```/, "string", "@popall"],
                [/`/, "string"]
            ],
            strings: [
                [/'$/, "string.escape", "@popall"],
                [/'/, "string.escape", "@stringBody"],
                [/"$/, "string.escape", "@popall"],
                [/"/, "string.escape", "@dblStringBody"]
            ],
            stringBody: [
                [/[^\\']+$/, "string", "@popall"],
                [/[^\\']+/, "string"],
                [/\\./, "string"],
                [/'/, "string.escape", "@popall"],
                [/\\$/, "string"]
            ],
            dblStringBody: [
                [/[^\\"]+$/, "string", "@popall"],
                [/[^\\"]+/, "string"],
                [/\\./, "string"],
                [/"/, "string.escape", "@popall"],
                [/\\$/, "string"]
            ]
        },
    });


    // 処理中の補完 Promise。
    // これが null 以外の場合、 await する。
    let processingPromise = null;
    monaco.languages.registerCompletionItemProvider(langID, {
        // "." で補完開始
        triggerCharacters: ["."],
        // 補完関数
        provideCompletionItems: async function( model, position, context ) {
            //console.log( position, context.triggerCharacter, model );

            if ( processingPromise != null ) {
                // 他の補完が処理中の場合、 incomplete で返す。
                return { incomplete: true };
            }
            
            if ( context.triggerKind == monaco.languages.CompletionTriggerKind.Invoke ) {
                let info = model.__lnsDoc.getToken( position );
                console.log( info[0], info[0].length );
                if ( info[0].length < startCompleteLen ) {
                    return null;
                }
            }
            
            let range = new monaco.Range( position.lineNumber, position.column,
                                          position.lineNumber, position.column + 1 );

            let complete;

            let code = model.getValueInRange(
                new monaco.Range(
                    1, 0, 
                    range.endLineNumber, range.endColumn ) );


            processingPromise = frontend.complete(
                    code + "lune", range.startLineNumber, range.startColumn );

            let compResult = await processingPromise;
            processingPromise = null;

            console.log( "console", compResult.complete );

            complete = compResult.complete.lunescript;
            
            if ( complete ) { 
                let suggestions = complete.candidateList.map(
                    (X) => {
                        let candidate = X.candidate;
                        let targetRange = new monaco.Range(
                            range.startLineNumber,
                            range.startColumn - complete.prefix.length,
                            range.startLineNumber,
                            range.startColumn );
                        return {
                            label: candidate.displayTxt,
                            kind: monaco.languages.CompletionItemKind.Snippet,
                            insertText: candidate.displayTxt,
                            range: targetRange,
                            //command: { id: 'editor.action.insertLineAfter' }
                        };
                    });
                return { suggestions: suggestions };
            }
            return null;
        },
    });
}

class Doc {
    constructor( model ) {
        this.model = model;
        model.__lnsDoc = this;

        this.reAnyChar = /\S/;
    }

    updateIndent( lineNo, indent ) {
        let line = this.model.getLineContent( lineNo );
        let orgLine = line;
        let index = line.search( this.reAnyChar );
        if ( index == -1 ) {
            // 文字がない行の場合
            if ( line.length < indent ) {
                line = " ".repeat(indent - line.length) + line;
            }
        } else if ( index != indent ) {
            line = " ".repeat(indent) + line.substring( index );
        }
        if ( line != orgLine ) {
            this.model.applyEdits( [
                { range: { startLineNumber: lineNo,
                           startColumn: 0,
                           endLineNumber: lineNo,
                           endColumn: orgLine.length + 1,
                         },
                  text: line }
            ] );
        }
    }

    getToken( position ) {
        let line = this.model.getLineContent( position.lineNumber );
        let result = this.model.findPreviousMatch(
            "\\W", position, true, true, null, false );
        let tokenRange = new monaco.Range(
            result.range.endLineNumber, result.range.endColumn,
            position.lineNumber, position.column );
        return [ this.model.getValueInRange( tokenRange ), tokenRange ];
    }
}

class Editor {
    constructor( element, frontend, lnsCode ) {
        this.frontend = frontend;
        let monacoEditor = monaco.editor.create( element, {
            // デフォルトの補完を動かすと、 lnsc の補完が正常に動かないので抑制
            wordBasedSuggestions:false,
            // acceptSuggestionOnCommitCharacter: false,
            // quickSuggestions: false,
            // suggest: false,
            autoClosingBrackets: false,
            autoIndent: "none",
	    theme: "vs-dark",
            // "vs" | "vs-dark" | "hc-black" | "hc-light"
            language: langID,
            //language: 'javascript',
	    value: lnsCode,
        });
        this.monacoEditor = monacoEditor;
        this.doc = new Doc( monacoEditor.getModel() );

        this.setKeyBind( monacoEditor );


        let editor = this;
        this.monacoEditor.onKeyUp( async function (e) {
            if (e.keyCode === monaco.KeyCode.Tab) {
                e.preventDefault();
                e.stopPropagation();
                // タブキーが押されたときの処理
                editor.updateIndent( monacoEditor.getSelection() );
            } else if ( e.keyCode === monaco.KeyCode.Enter ||
                        e.keyCode == monaco.KeyCode.KeyJ && e.ctrlKey ||
                        e.keyCode === monaco.KeyCode.BracketLeft ||
                        e.keyCode === monaco.KeyCode.BracketRight )
            {
                // Enter, C-j, {, }
                let selection = monacoEditor.getSelection();
                editor.updateIndent( selection );
            }
        });
        this.monacoEditor.onKeyDown( function (e) {
            if (e.keyCode === monaco.KeyCode.Tab) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        this.updateIndent( this.monacoEditor.getModel().getFullModelRange() );
    }

    setKeyBind( monacoEditor ) {

        // Enter キーのアクションがなさそうなので、
        // MyEnter として \n のトリガーを登録する。
        monaco.editor.addCommand(
            { id: "MyEnter", run: () => {
                monacoEditor.trigger('keyboard', 'type', { text: '\n' });
            } } );
        
        monaco.editor.addKeybindingRules( [
            {
                // C-f
                keybinding: monaco.KeyCode.KeyF | monaco.KeyMod.CtrlCmd,
                command: "cursorRight"
            },
            {
                // C-b
                keybinding: monaco.KeyCode.KeyB | monaco.KeyMod.CtrlCmd,
                command: "cursorLeft"
            },
            {
                // C-p
                keybinding: monaco.KeyCode.KeyP | monaco.KeyMod.CtrlCmd,
                command: "cursorUp"
            },
            {
                // C-n
                // ブラウザのデフォルトショートカット C-n が上書きできないので、
                // C-M-n を設定
                keybinding: monaco.KeyCode.KeyN | monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt,
                command: "cursorDown"
            },
            {
                // C-j
                keybinding: monaco.KeyCode.KeyJ | monaco.KeyMod.CtrlCmd,
                command: "MyEnter"
            },
            {
                // C-d
                keybinding: monaco.KeyCode.KeyD | monaco.KeyMod.CtrlCmd,
                command: "deleteRight"
            },
            {
                // C-e
                keybinding: monaco.KeyCode.KeyE | monaco.KeyMod.CtrlCmd,
                command: "cursorLineEnd"
            },
            {
                // C-a
                keybinding: monaco.KeyCode.KeyA | monaco.KeyMod.CtrlCmd,
                command: "cursorLineStart"
            },
            
            
        ]);
    }

    async updateIndent( selection ) {
        let range = {
            startLineNumber: 1,
            startColumn: 0,
            endLineNumber: selection.endLineNumber,
            endColumn: this.monacoEditor.getModel().getLineLength( selection.endLineNumber ) + 1,
        };
        let txt = this.monacoEditor.getModel().getValueInRange( range );
        let result = await this.frontend.getIndent(
            txt + " ___LNS___",
            selection.startLineNumber, selection.endLineNumber );
        result.indent.lines.forEach( (obj) => {
            let info = obj.info;
            if ( info.lineNo >= selection.startLineNumber &&
                 info.lineNo <= selection.endLineNumber )
            {
                this.doc.updateIndent( info.lineNo, info.column - 1 );
            }
        } );
    }

    getText() {
        return this.monacoEditor.getModel().getValue();
    }
}

export function init( element, frontend, lnsCode ) {
    setupLanguage( frontend );
    
    let editor = new Editor( element, frontend, lnsCode );
    return editor;
}
