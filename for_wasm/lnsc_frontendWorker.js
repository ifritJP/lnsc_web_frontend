/**
   lnsc を実行する worker。
*/
 
(async function() {
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

                
                console.log( message.data.kind );
                let resp = {};
                if ( message.data.kind == "conv2lua_and_exec" ) {
                    resp = this.conv2lua_and_exec( message.data );
                } else {
                    console.log( "not found kind -- ", message.data.kind );
                }

                resp.no = message.data.no;
                resp.console = this.consoleTxtList.join( ""  );
                self.postMessage( resp );
            });
        }
        
        
        conv2lua_and_exec( info ) {
            let luaCode = this.lnscIF.lns2lua( info.lnsCode );
            if ( luaCode ) {
                return { luaCode: luaCode,
                         execLog: this.lnscIF.exeLua( luaCode ) };
            }
            return { luaCode: "", execLog: "" };
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
        messageList.push( message );
        processMessage();
    } );
    

    async function loadLnsc() {
        // main.wasm をロードし、 WebAssembly で実行
        //let asmBin = await (await fetch('./lnsc.wasm')).arrayBuffer();
        
        let zipIF = new JSZip();
        let zipedBin = await (await fetch('./lnsc.zip')).arrayBuffer();
        let lnsc_wasm_zip = await zipIF.loadAsync(zipedBin);
        let asmBin = await lnsc_wasm_zip.file( "for_wasm/lnsc.wasm" ).async( "uint8array" );

        const go = new Go(); // definition in wasm_exec.js
        let res = await WebAssembly.instantiate( asmBin, go.importObject);
        
        go.run(res.instance); // execute the go main method
        // 実行すると __lnsc に初期化用関数がセットされる
        return new Lnsc( __lnsc() );
    }

    lnsc = await loadLnsc();
    

    // 初期化完了を通知
    self.postMessage( {no:0, result: "complete setup" } );

    // 処理中に来たメッセージを処理
    processMessage();
})();
