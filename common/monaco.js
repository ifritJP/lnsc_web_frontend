function setupLanguage( frontend ) {
    monaco.languages.register({
        id: 'LuneScript',
    });

    monaco.languages.setMonarchTokensProvider( 'LuneScript', {
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


    // Register new completionItemProvider on Monaco's language import
    monaco.languages.registerCompletionItemProvider('LuneScript', {
        // "." で補完開始
        triggerCharacters: ["."],
        // 補完関数
        provideCompletionItems: async function( model, position, context, token ) {
            //console.log( position, context.triggerCharacter, model, token );
            
            let complete = await frontend.complete( "prlune\n", 1, 2 );
            console.log( "console", complete.complete );

            const suggestions = [];
            let range = {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column + 1,
            };
            suggestions.push(
                {
                    label: "hoge",
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: 'test',
                    range: range,
                    //command: { id: 'editor.action.insertLineAfter' }
                });
            return { suggestions: suggestions };
        },
    });
}

class Doc {
    constructor( model ) {
        this.model = model;

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
}

class Editor {
    constructor( element, frontend, lnsCode ) {
        this.frontend = frontend;
        let monacoEditor = monaco.editor.create( element, {
            autoClosingBrackets: false,
            autoIndent: "none",
	    theme: "vs-dark",
            // "vs" | "vs-dark" | "hc-black" | "hc-light"
            language: 'LuneScript',
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
            } else if ( e.keyCode === monaco.KeyCode.Enter ) {
                // Enter
                let selection = monacoEditor.getSelection();
                editor.updateIndent( selection );
            } else if ( e.keyCode == monaco.KeyCode.KeyJ && e.ctrlKey ) {
                // C-j
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
                command: "editor.action.insertLineAfter"
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
