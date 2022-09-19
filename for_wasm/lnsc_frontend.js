/**
   lnsc を制御する frontend。
   実際の lnsc は lnsc_frontendWorker.js で動かす。
 */
(function() {
    function Log() {
        console.log( "lns-front: ", ...arguments );
    }
    
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

        // worker を初期化
        initWorker( initResolve ) {
            this.no2resolve.set( 0, initResolve );

            this.worker.addEventListener( "message", (message) => {
                let data = message.data;

                if ( data.no == -1 ) {
                    this.worker.postMessage( "reloadLnsc" );
                } else {                 
                    let resolve = this.no2resolve.get( data.no );
                    if ( resolve ) {
                        this.no2resolve.delete( data.no );
                        if ( data.no == 0 ) {
                            resolve( this );
                            Log( "init" );
                        } else {
                            resolve( data );
                        }
                    }
                }
            });
        }

        // worker を kill して再起動
        killAndClear() {
            this.worker.terminate();

            // 要求済みの resolve を全て解決する
            for ( let items of this.no2resolve.entries() ) {
                let messageNo = items[ 0 ];
                let resolve = items[ 1 ];
                resolve( { no: messageNo } );
            }
            this.no2resolve.clear();

            // 再起動
            new Promise( (resolve, reject) => {
                this.worker = new Worker('lnsc_frontendWorker.js');
                this.initWorker( resolve );
            } );
        }

        // メッセージを worker に post する。
        // worker から結果が戻ってきたら resolve にセットする。
        post( resolve, timeoutSec, message ) {
            message.no = this.processNo;
            this.processNo++;
            if ( this.processNo > 100 ) {
                this.processNo = 1;
            }
            this.no2resolve.set( message.no, resolve );
            this.worker.postMessage( message );


            let messageNo = message.no;
            // worker 暴走防止のため timeoutSec 秒後に kill タイマーを設定
            setTimeout(() => {
                if ( this.no2resolve.get( messageNo ) ) {
                    // 処理中の要求が残っている場合は暴走として kill する
                    this.killAndClear();
                }
            } , timeoutSec * 1000 );
        }

        /**
           lnsCode を lua に変換する

           @param lnsCode Lns コード
           @param andExec 変換後の Lua コードを実行する場合 true
           @param timeoutSec 処理のタイムアウト時間(秒)
           @return Promise 以下を保持する Object
              - luaCode 変換後の Lua コード
              - execLog Lua を実行した時の出力結果
              - console 変換時のコンソールログ
        */
        async conv2lua( lnsCode, andExec, timeoutSec ) {
            return new Promise( (resolve, reject) => {
                this.post( resolve, timeoutSec,
                           { kind:"conv2lua",
                             lnsCode: lnsCode,
                             andExec: andExec } );
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
