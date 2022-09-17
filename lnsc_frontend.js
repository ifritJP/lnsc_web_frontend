/**
   lnsc を制御する frontend。
   実際の lnsc は lnsc_frontendWorker.js で動かす。
 */
(function() {
    class Frontend {
        constructor( worker,  initResolve ) {
            // lnsc を実行する worker
            this.worker = worker;

            // worker への依頼番号。 0 は初期セットアップ用
            this.processNo = 1;
            // processNo → resolve のマップ
            this.no2resolve = new Map();

            this.initWorker( initResolve );
        }

        initWorker( initResolve ) {
            this.no2resolve.set( 0, initResolve );

            this.worker.addEventListener( "message", (message) => {
                let data = message.data;

                let resolve = this.no2resolve.get( data.no );
                if ( resolve ) {
                    this.no2resolve.delete( data.no );
                    if ( data.no == 0 ) {
                        resolve( this );
                    } else {
                        resolve( data );
                    }
                }
            });
        }

        setupUI( runDiv ) {
            let buttonRun = document.createElement( "input" );
            buttonRun.type = "button";
            buttonRun.value = "run";

            // eventListener 内では、 this がこのインスタンスを示さないので
            // selfFrontEnd にセットする。
            let selfFrontEnd = this;
            buttonRun.addEventListener( "click", async function( event ) {
                let result = await selfFrontEnd.conv2lua( `
// fn fib_lns( num:int ) : int {
//    if num < 2 {
//       return num;
//    }
//    return fib_lns( num - 2 ) + fib_lns( num - 1 );
// }
// let prev = os.clock();
// print( fib_lns( 22 ) );
// print( "hoge" );
// print( os.clock() - prev );
print( "hoge");
` );
                console.log( "luaCode:-------", result.luaCode );
                console.log( "exec:-------", result.execLog );
                console.log( "console:-------", result.console );
                
            });
            runDiv.appendChild( buttonRun );
            
        }


        killAndClear() {
            this.worker.terminate();
            this.no2resolve.clear();


            // 再起動
            new Promise( (resolve, reject) => {
                this.worker = new Worker('lnsc_frontendWorker.js');
                this.initWorker( resolve );
            } );
        }

        // メッセージを worker に post する。
        // worker から結果が戻ってきたら resolve にセットする。
        post( resolve, message ) {
            message.no = this.processNo;
            this.processNo++;
            if ( this.processNo > 100 ) {
                this.processNo = 1;
            }
            this.no2resolve.set( message.no, resolve );
            this.worker.postMessage( message );


            // worker 暴走防止のため 4 秒後に kill タイマーを設定
            setTimeout(() => {
                if ( this.no2resolve.size > 0 ) {
                    // 処理中の要求が残っている場合は暴走として kill する
                    this.killAndClear();
                }
            } , 8000 );
        }

        // lnsCode を lua に変換する
        conv2lua( lnsCode ) {
            return new Promise( (resolve, reject) => {
                this.post( resolve, { kind:"conv2lua_and_exec", lnsCode: lnsCode } );
            } );
        }
    }
    let frontEnd = null;
    document.__getLnsFrontEnd = async () => {
        if ( frontEnd ) {
            return frontEnd;
        }
        return new Promise( (resolve, reject) => {
            let worker = new Worker('lnsc_frontendWorker.js');
            frontEnd = new Frontend( worker, resolve );
        } );
    };
})();
