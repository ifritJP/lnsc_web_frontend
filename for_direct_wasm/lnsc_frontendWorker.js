/**
   lnsc を実行する worker (direct wasm 版)。

   go を経由せずに wasm (WasmGC) に変換した lnsc を使う。
   frontend (lnsc_frontend.js) とのメッセージは、go-wasm 版 (../for_wasm) と同じ。

   go-wasm 版は lnsc を常駐させて関数を呼ぶが、direct wasm 版の lnsc は WASI のコマンドなので、
   要求のたびに、コマンドの引数とメモリ上のファイル (MemFS) を用意して実行する。
   wasm のコンパイルは最初の 1 回だけ行う。

   使う wasm (gzip したものを読み込む):
    - lnsc.wasm: lnsc (LuneScript の lune/base/front.lns を -langWasm で変換したもの)
    - indent.wasm: インデントの計算 (LuneScript の tools/formatter と indent.lns)
    - lnslua.wasm: C のランタイムと Lua (LuneScript の src/misc/wasm/lnslua.c)。
      lnsc.wasm・indent.wasm は、どちらも Lua を使う
*/

(async function() {
    function Log() {
        console.log( "lns-worker: ", ...arguments );
    }
    const parentUrl = self.location.href.replace(/\/[^/]+$/, '/' );

    importScripts( parentUrl + "lnsc_wasi.js" );

    /** gzip した wasm を読み込み、コンパイルする */
    async function loadWasm( name ) {
        let resp = await fetch( parentUrl + name + ".gz" );
        if ( !resp.ok ) {
            throw new Error( `failed to load ${name} -- ${resp.status}` );
        }
        let stream = resp.body.pipeThrough( new DecompressionStream( "gzip" ) );
        let bin = await new Response( stream ).arrayBuffer();
        return await WebAssembly.compile( bin );
    }

    class Lnsc {
        constructor( lnscProgram, indentProgram ) {
            this.lnscProgram = lnscProgram;
            this.indentProgram = indentProgram;
        }

        // frontEnd からのメッセージ処理
        async processMessage( message ) {
            Log( message.data.kind, message.data.no );
            let resp = {};
            try {
                if ( message.data.kind == "conv2lua" ) {
                    resp = await this.conv2lua( message.data );
                } else if ( message.data.kind == "getIndent" ) {
                    resp = await this.getIndent( message.data );
                } else if ( message.data.kind == "runLnsc" ) {
                    resp = await this.runLnsc( message.data );
                } else if ( message.data.kind == "complete" ) {
                    resp = await this.complete( message.data );
                } else if ( message.data.kind == "diag" ) {
                    resp = await this.diag( message.data );
                } else {
                    Log( "not found kind -- ", message.data.kind );
                }
            } catch ( err ) {
                Log( "error", err );
                resp.console = String( err );
            }

            resp.no = message.data.no;
            if ( resp.console === undefined ) {
                resp.console = "";
            }
            self.postMessage( resp );

            console.log( "processed -- ", message.data.kind, message.data.no );
        }

        /** name2code (パス名 → Lns コード) を置いた MemFS を作る */
        createFS( name2code ) {
            let fs = new LnsWasi.MemFS();
            for ( let [ name, code ] of Object.entries( name2code || {} ) ) {
                fs.writeFile( "/" + name, code );
            }
            return fs;
        }

        /** lnsc を実行する。args は lnsc の引数 (コマンド名を除く) */
        async execLnsc( fs, args ) {
            return await this.lnscProgram.run( [ "lnsc", ...args ], fs );
        }

        async conv2lua( info ) {
            const path = "lnsc_frontend.lns";
            let fs = this.createFS( info.name2code );
            fs.writeFile( "/" + path, info.lnsCode );

            // 変換のメッセージ (エラー・警告) は標準エラーに出る
            let convResult = await this.execLnsc( fs, [ path, "lua" ] );
            if ( convResult.code != 0 ) {
                return { luaCode: "", execLog: "", console: convResult.output };
            }
            let result = { luaCode: convResult.stdout, console: convResult.stderr };
            if ( !info.andExec ) {
                return result;
            }
            let exeResult = await this.execLnsc( fs, [ path, "exe" ] );
            let output = exeResult.output;
            // 変換時と同じ警告などが先頭に出るので、除く
            if ( convResult.stderr != "" && output.startsWith( convResult.stderr ) ) {
                output = output.substring( convResult.stderr.length );
            }
            result.execLog = output;
            return result;
        }

        async getIndent( info ) {
            let fs = new LnsWasi.MemFS();
            fs.writeFile( "/code.lns", info.lnsCode );
            let result = await this.indentProgram.run(
                [ "indent", "code.lns",
                  String( info.targetLineNo ), String( info.endLineNo ) ], fs );
            try {
                return { indent: JSON.parse( result.stdout ).indent };
            } catch ( err ) {
                Log( "getIndent", result.output );
                return { indent: { lines: [] }, console: result.output };
            }
        }

        async runLnsc( info ) {
            console.log( "runLnsc worker", info.args );
            let result = await this.execLnsc( this.createFS( info.name2code ), info.args );
            console.log( "runLnsc end", result.code );
            return { result: result.code == 0, console: result.output };
        }

        cloneAndAdd( name2code, name, code ) {
            let newName2code = Object.fromEntries( Object.entries( name2code || {} ) );
            newName2code[ name ] = code;
            return newName2code;
        }

        path2mod( path ) {
            return path.replace( /\.lns$/, "" ).replace( /\//, "." );
        }

        async complete( info ) {
            let name = "_.lns";
            let result = await this.runLnsc(
                { name2code: this.cloneAndAdd( info.name2code, name, info.lnsCode ),
                  args: [ name, "comp", this.path2mod( name ),
                          info.lineNo, info.column ] } );
            let completeObj;
            try {
                completeObj = JSON.parse( result.console );
            } catch ( e ) {
                return { complete: {}, console: result.console };
            }
            return { complete: completeObj };
        }

        async diag( info ) {
            let name = "_.lns";
            return await this.runLnsc(
                { name2code: this.cloneAndAdd( info.name2code, name, info.lnsCode ),
                  args: [ name, "diag" ] } );
        }
    }

    // 要求は 1 つずつ順に処理する
    let lnsc = null;
    let messageList = [];
    let processing = false;
    async function processMessage() {
        if ( processing ) {
            return;
        }
        processing = true;
        while ( messageList.length > 0 ) {
            if ( lnsc == null ) {
                // lnsc 構築前は message を処理せずに保持しておく
                console.log( "keep", messageList.length );
                break;
            }
            await lnsc.processMessage( messageList.shift() );
        }
        processing = false;
    }

    self.addEventListener( "message", function (message) {
        if ( message.data == "reloadLnsc" ) {
            // 要求のたびに instance を作るので、再読み込みは不要
            Log( "reloadLnsc" );
        } else {
            messageList.push( message );
        }
        processMessage();
    } );

    Log( "loadLnsc" );
    let [ lnscModule, indentModule, rtModule ] = await Promise.all(
        [ "lnsc.wasm", "indent.wasm", "lnslua.wasm" ].map( loadWasm ) );
    lnsc = new Lnsc( new LnsWasi.Program( lnscModule, rtModule ),
                     new LnsWasi.Program( indentModule, rtModule ) );
    Log( "loadLnsc end" );

    // 初期化完了を通知
    self.postMessage( {no:0, result: "complete setup" } );
    processMessage();
})();
