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
    
    class Lnsc {
        constructor( lnscIF ) {
            this.lnscIF = lnscIF;

            // lnsc のコンソール出力を consoleTxtList に格納する
            this.consoleTxtList = [];
            this.lnscIF.setConsoleWriter( (txt) => {
                this.consoleTxtList.push( txt );
            } );
        }

        // frontEnd からのメッセージ処理
        processMessage( messageList ) {
            messageList.forEach( (message) => {
                // this.consoleTxtList をクリアしておく
                this.consoleTxtList = [];

                
                Log( message.data.kind );
                let resp = {};
                if ( message.data.kind == "conv2lua" ) {
                    resp = this.conv2lua( message.data );
                } else {
                    Log( "not found kind -- ", message.data.kind );
                }

                resp.no = message.data.no;
                resp.console = this.consoleTxtList.join( ""  );
                self.postMessage( resp );
            });
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
    }
   

    let lnsc = null;

    let messageList = [];
    function processMessage() {
        if ( lnsc == null ) {
            // lnsc 構築前は message を処理せずに保持しておく
        } else {
            lnsc.processMessage( messageList );
            messageList = [];
        }
    }

    self.addEventListener( "message", (message) => {
        if ( message.data == "reloadLnsc" ) {
            loadLnsc();
            Log( "reloadLnsc" );
        } else {
            messageList.push( message );
            processMessage();
        }
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

        const go = new Go(); // definition in wasm_exec.js
        let res = await WebAssembly.instantiate( asmBin, go.importObject);

        // execute the go main method
        go.run(res.instance).then( ()=> {
            // main が終了した場合はメッセージを通知する
            Log( "lnsc: detect exit" );
            self.postMessage( { no:-1 } );
        });
        // 実行すると __lnsc に初期化用関数がセットされる
        lnsc = new Lnsc( __lnsc() );
    }

    await loadLnsc();
    

    // 初期化完了を通知
    self.postMessage( {no:0, result: "complete setup" } );

    // 処理中に来たメッセージを処理
    processMessage();
})();
