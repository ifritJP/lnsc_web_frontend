/**
   lnsc を実行する worker。
*/
 
(async function() {
    function Log() {
        console.log( "lns-worker: ", ...arguments );
    }
    
    
    // worker に "wasm_exec.js" を読み込む
    importScripts("../oss/go/wasm_exec.js");
    importScripts("../oss/jszip/dist/jszip.min.js");

    let lnsc = null;
    
    class Lnsc {
        constructor( lnscIF, runPromise ) {
            this.lnscIF = lnscIF;
            this.runPromise = runPromise;

            // lnsc のコンソール出力を consoleTxtList に格納する
            this.consoleTxtList = [];
            this.lnscIF.setConsoleWriter( (txt) => {
                this.consoleTxtList.push( txt );
            } );
        }

        // frontEnd からのメッセージ処理
        processMessage( message ) {
            // this.consoleTxtList をクリアしておく
            this.consoleTxtList = [];

            
            Log( message.data.kind, message.data.no );
            let resp = {};
            if ( message.data.kind == "conv2lua" ) {
                resp = this.conv2lua( message.data );
            } else if ( message.data.kind == "getIndent" ) {
                resp = this.getIndent( message.data );
            } else if ( message.data.kind == "runLnsc" ) {
                resp = this.runLnsc( message.data );
            } else if ( message.data.kind == "complete" ) {
                resp = this.complete( message.data );
            } else if ( message.data.kind == "diag" ) {
                resp = this.diag( message.data );
            } else {
                Log( "not found kind -- ", message.data.kind );
            }

            resp.no = message.data.no;
            resp.console = this.consoleTxtList.join( ""  );
            self.postMessage( resp );

            console.log( "processed -- ", message.data.kind, message.data.no );
        }
        
        
        conv2lua( info ) {
            let luaCode = this.lnscIF.lns2lua( info.lnsCode );
            if ( !luaCode ) {
                return { luaCode: "", execLog: "" };
            }
            let result = { luaCode: luaCode };
            if ( !info.andExec ) {
                return result;
            } else {
                result.execLog = this.lnscIF.exeLua( luaCode );
                return result;
            }
        }

        getIndent( info ) {
            let indentTxt = this.lnscIF.getIndent(
                info.lnsCode, info.targetLineNo, info.endLineNo );
            return { indent: JSON.parse( indentTxt ).indent };
        }

        runLnsc( info ) {
            console.log( "runLnsc worker", info.args );
            let result = this.lnscIF.runLnsc(
                Object.entries( info.name2code ), ...info.args );
            
            console.log( "runLnsc end", result );

            if ( !result ) {
                // lnsc が落ちたので、null でクリアしておく。
                lnsc = null;
            }

            return { result: result, console:this.consoleTxtList.join( "" ) };
        }
        
        cloneAndAdd( name2code, name, code ) {
            let newName2code = Object.fromEntries( Object.entries( name2code ) );
            newName2code[ name ] = code;
            return newName2code;
        }

        path2mod( path ) {
            return path.replace( /\.lns$/, "" ).replace( /\//, "." );
        }
        
        complete( info ) {
            let name = "_.lns";
            let result = this.runLnsc(
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

        diag( info ) {
            let name = "_.lns";
            return this.runLnsc(
                { name2code: this.cloneAndAdd( info.name2code, name, info.lnsCode ),
                  args: [ name, "diag" ] } );
        }
    }
   

    let messageList = [];
    function processMessage() {
        while ( messageList.length > 0 ) {
            if ( lnsc == null ) {
                // lnsc 構築前は message を処理せずに保持しておく
                console.log( "keep", messageList.length );
                break;
            } else {
                let message = messageList.shift();
                lnsc.processMessage( message );
            }
        }
    }

    self.addEventListener( "message", async function (message) {
        if ( message.data == "reloadLnsc" ) {
            await loadLnsc();
            Log( "reloadLnsc" );
        } else {
            messageList.push( message );
        }
        processMessage(); 
    } );

    async function loadWAsm() {
        // main.wasm をロードし、 WebAssembly で実行
        //let asmBin = await (await fetch('./lnsc.wasm')).arrayBuffer();
        
        let zipIF = new JSZip();
        let zipedBin = await (await fetch('./lnsc.zip')).arrayBuffer();
        let lnsc_wasm_zip = await zipIF.loadAsync(zipedBin);
        return await lnsc_wasm_zip.file( "for_wasm/lnsc.wasm" ).async( "uint8array" );
    }

    let asmBin = await loadWAsm();


    
    async function loadLnsc() {

        console.log( "loadLnsc" );

        let go = new Go(); // definition in wasm_exec.js
        let res = await WebAssembly.instantiate( asmBin, go.importObject);
        
        // execute the go main method
        let runPromise = go.run(res.instance);
        
        runPromise.then( ()=> {
            // main が終了した場合はメッセージを通知する
            Log( "lnsc: detect exit" );
            self.postMessage( { no:-1 } );
        });
        // 実行すると __lnsc に初期化用関数がセットされる
        lnsc = new Lnsc( __lnsc(), runPromise );
        console.log( "loadLnsc end" );
    }

    await loadLnsc();
    

    // 初期化完了を通知
    self.postMessage( {no:0, result: "complete setup" } );
})();
