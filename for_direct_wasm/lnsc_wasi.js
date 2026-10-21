/**
   LuneScript から直接変換した wasm (WasmGC) を、ブラウザで実行する。

   変換した wasm は、C のランタイム (lnslua.wasm。モジュール名 "lnsrt") の
   memory と関数を import する。C のランタイムは WASI (preview1) のコマンドで、
   その main() が、変換した wasm の main (モジュール名 "lnsmain") を呼び出す。
   (LuneScript の src/misc/wasm/lnswasm.mjs の、ブラウザ版)

   ここでは、WASI の関数を、メモリ上のファイルシステム (MemFS) で実装する。
   ファイルは全て "/" 以下に置き、カレントディレクトリも "/" にする。

   worker から importScripts で読み込む。globalThis.LnsWasi を定義する。
*/
(function() {
    "use strict";

    // WASI の errno
    const ERRNO_SUCCESS = 0;
    const ERRNO_BADF = 8;
    const ERRNO_EXIST = 20;
    const ERRNO_INVAL = 28;
    const ERRNO_ISDIR = 31;
    const ERRNO_NOENT = 44;
    const ERRNO_NOSYS = 52;
    const ERRNO_NOTDIR = 54;
    const ERRNO_NOTEMPTY = 55;

    // WASI の filetype
    const FILETYPE_CHARACTER_DEVICE = 2;
    const FILETYPE_DIRECTORY = 3;
    const FILETYPE_REGULAR_FILE = 4;

    // path_open の oflags
    const OFLAGS_CREAT = 1;
    const OFLAGS_DIRECTORY = 2;
    const OFLAGS_EXCL = 4;
    const OFLAGS_TRUNC = 8;
    // fdflags
    const FDFLAGS_APPEND = 1;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** proc_exit で、実行を打ち切るための例外 */
    class ExitError extends Error {
        constructor( code ) {
            super( "exit " + code );
            this.code = code;
        }
    }

    /**
       メモリ上のファイルシステム。
       パス ("/" から始まる正規化したパス) → { data: Uint8Array, mtime: 秒 }。
       ディレクトリは、ファイルのパスから求める (空のディレクトリは持たない)。
    */
    class MemFS {
        constructor() {
            this.path2file = new Map();
        }

        /** パスを正規化する ("." と ".." を除き、"/" から始まるパスにする) */
        static normalize( path ) {
            let list = [];
            for ( let item of path.split( "/" ) ) {
                if ( item == "" || item == "." ) {
                    continue;
                }
                if ( item == ".." ) {
                    list.pop();
                } else {
                    list.push( item );
                }
            }
            return "/" + list.join( "/" );
        }

        writeFile( path, txt ) {
            let data = typeof txt == "string" ? encoder.encode( txt ) : txt;
            this.path2file.set( MemFS.normalize( path ),
                                { data: data, mtime: Date.now() / 1000 } );
        }

        readFile( path ) {
            let file = this.path2file.get( MemFS.normalize( path ) );
            return file ? decoder.decode( file.data ) : null;
        }

        isDir( path ) {
            if ( path == "/" ) {
                return true;
            }
            let prefix = path + "/";
            for ( let key of this.path2file.keys() ) {
                if ( key.startsWith( prefix ) ) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
       WASI (preview1) の関数を MemFS で実装する。

       fd 0〜2 は標準入出力、fd 3 は "/" (preopen)。
    */
    class Wasi {
        /**
           @param args コマンドの引数 (先頭はコマンド名)
           @param env 環境変数の Object
           @param fs MemFS
           @param write 標準出力・標準エラーに出力する関数 ( fd, txt )
        */
        constructor( args, env, fs, write ) {
            this.args = args.map( (arg) => encoder.encode( arg + "\0" ) );
            this.env = Object.entries( env ).map(
                ( [ key, val ] ) => encoder.encode( key + "=" + val + "\0" ) );
            this.fs = fs;
            this.write = write;
            this.memory = null;
            // fd → { kind: "stdio" | "dir" | "file", path, pos, append }
            this.fdMap = new Map( [
                [ 0, { kind: "stdio" } ],
                [ 1, { kind: "stdio" } ],
                [ 2, { kind: "stdio" } ],
                [ 3, { kind: "dir", path: "/", preopen: true } ],
            ] );
            this.nextFd = 4;
        }

        setMemory( memory ) {
            this.memory = memory;
        }

        view() {
            return new DataView( this.memory.buffer );
        }
        bytes( addr, len ) {
            return new Uint8Array( this.memory.buffer, addr, len );
        }
        getStr( addr, len ) {
            // TextDecoder は SharedArrayBuffer を受け付けないので、コピーする
            return decoder.decode( this.bytes( addr, len ).slice() );
        }

        /** dirfd からの相対パスを、正規化したパスにする */
        resolve( dirFd, addr, len ) {
            let dir = this.fdMap.get( dirFd );
            if ( !dir || dir.kind != "dir" ) {
                return null;
            }
            return MemFS.normalize( dir.path + "/" + this.getStr( addr, len ) );
        }

        /** iovec の配列 (ptr, len の組) を Uint8Array のリストにする */
        iovecs( iovs, iovsLen ) {
            let view = this.view();
            let list = [];
            for ( let index = 0; index < iovsLen; index++ ) {
                let ptr = view.getUint32( iovs + index * 8, true );
                let len = view.getUint32( iovs + index * 8 + 4, true );
                list.push( this.bytes( ptr, len ) );
            }
            return list;
        }

        /** 文字列のリスト (args / environ) を書き込む */
        putStrList( list, ptrList, buf ) {
            let view = this.view();
            for ( let item of list ) {
                view.setUint32( ptrList, buf, true );
                ptrList += 4;
                this.bytes( buf, item.length ).set( item );
                buf += item.length;
            }
            return ERRNO_SUCCESS;
        }
        putSizes( list, countPtr, sizePtr ) {
            let view = this.view();
            view.setUint32( countPtr, list.length, true );
            view.setUint32( sizePtr, list.reduce( (sum, item) => sum + item.length, 0 ), true );
            return ERRNO_SUCCESS;
        }

        /** filestat (64 バイト) を書き込む */
        putFilestat( buf, fileType, size, mtime ) {
            let view = this.view();
            this.bytes( buf, 64 ).fill( 0 );
            view.setUint8( buf + 16, fileType );
            view.setBigUint64( buf + 24, 1n, true );
            view.setBigUint64( buf + 32, BigInt( size ), true );
            let time = BigInt( Math.floor( mtime * 1e9 ) );
            view.setBigUint64( buf + 40, time, true );
            view.setBigUint64( buf + 48, time, true );
            view.setBigUint64( buf + 56, time, true );
        }

        /** wasm に渡す import の Object */
        getImports() {
            let self = this;
            return {
                args_get: ( argv, buf ) => self.putStrList( self.args, argv, buf ),
                args_sizes_get: ( count, size ) => self.putSizes( self.args, count, size ),
                environ_get: ( env, buf ) => self.putStrList( self.env, env, buf ),
                environ_sizes_get: ( count, size ) => self.putSizes( self.env, count, size ),

                clock_time_get: ( id, precision, timePtr ) => {
                    let ns;
                    if ( id == 0 ) {
                        // realtime
                        ns = BigInt( Date.now() ) * 1000000n;
                    } else {
                        // monotonic・CPU 時間
                        ns = BigInt( Math.floor( performance.now() * 1e6 ) );
                    }
                    self.view().setBigUint64( timePtr, ns, true );
                    return ERRNO_SUCCESS;
                },

                fd_prestat_get: ( fd, buf ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info || !info.preopen ) {
                        return ERRNO_BADF;
                    }
                    let view = self.view();
                    view.setUint8( buf, 0 );
                    view.setUint32( buf + 4, encoder.encode( info.path ).length, true );
                    return ERRNO_SUCCESS;
                },
                fd_prestat_dir_name: ( fd, path, len ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info || !info.preopen ) {
                        return ERRNO_BADF;
                    }
                    self.bytes( path, len ).set( encoder.encode( info.path ).subarray( 0, len ) );
                    return ERRNO_SUCCESS;
                },

                fd_fdstat_get: ( fd, buf ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info ) {
                        return ERRNO_BADF;
                    }
                    let view = self.view();
                    let fileType = { stdio: FILETYPE_CHARACTER_DEVICE,
                                     dir: FILETYPE_DIRECTORY,
                                     file: FILETYPE_REGULAR_FILE }[ info.kind ];
                    view.setUint8( buf, fileType );
                    view.setUint16( buf + 2, info.append ? FDFLAGS_APPEND : 0, true );
                    // rights は全て許可する
                    view.setBigUint64( buf + 8, 0xffffffffffffffffn, true );
                    view.setBigUint64( buf + 16, 0xffffffffffffffffn, true );
                    return ERRNO_SUCCESS;
                },
                fd_fdstat_set_flags: ( fd, flags ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info ) {
                        return ERRNO_BADF;
                    }
                    info.append = ( flags & FDFLAGS_APPEND ) != 0;
                    return ERRNO_SUCCESS;
                },

                fd_read: ( fd, iovs, iovsLen, nreadPtr ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info ) {
                        return ERRNO_BADF;
                    }
                    let total = 0;
                    if ( info.kind == "file" ) {
                        let file = self.fs.path2file.get( info.path );
                        let data = file ? file.data : new Uint8Array( 0 );
                        for ( let buf of self.iovecs( iovs, iovsLen ) ) {
                            let chunk = data.subarray( info.pos, info.pos + buf.length );
                            buf.set( chunk );
                            info.pos += chunk.length;
                            total += chunk.length;
                            if ( chunk.length < buf.length ) {
                                break;
                            }
                        }
                    } else if ( info.kind == "dir" ) {
                        return ERRNO_ISDIR;
                    }
                    // 標準入力は常に EOF
                    self.view().setUint32( nreadPtr, total, true );
                    return ERRNO_SUCCESS;
                },

                fd_write: ( fd, iovs, iovsLen, nwrittenPtr ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info ) {
                        return ERRNO_BADF;
                    }
                    let list = self.iovecs( iovs, iovsLen );
                    let total = list.reduce( (sum, buf) => sum + buf.length, 0 );
                    if ( info.kind == "stdio" ) {
                        let all = new Uint8Array( total );
                        let pos = 0;
                        for ( let buf of list ) {
                            all.set( buf, pos );
                            pos += buf.length;
                        }
                        self.write( fd, all );
                    } else if ( info.kind == "file" ) {
                        let file = self.fs.path2file.get( info.path );
                        if ( info.append ) {
                            info.pos = file.data.length;
                        }
                        let end = info.pos + total;
                        if ( end > file.data.length ) {
                            let data = new Uint8Array( end );
                            data.set( file.data );
                            file.data = data;
                        }
                        for ( let buf of list ) {
                            file.data.set( buf, info.pos );
                            info.pos += buf.length;
                        }
                        file.mtime = Date.now() / 1000;
                    } else {
                        return ERRNO_ISDIR;
                    }
                    self.view().setUint32( nwrittenPtr, total, true );
                    return ERRNO_SUCCESS;
                },

                fd_seek: ( fd, offset, whence, newOffsetPtr ) => {
                    let info = self.fdMap.get( fd );
                    if ( !info ) {
                        return ERRNO_BADF;
                    }
                    if ( info.kind != "file" ) {
                        // 標準入出力などは seek できない (ESPIPE)
                        return 70;
                    }
                    let size = self.fs.path2file.get( info.path ).data.length;
                    let base = [ 0, info.pos, size ][ whence ];
                    let pos = base + Number( offset );
                    if ( base === undefined || pos < 0 ) {
                        return ERRNO_INVAL;
                    }
                    info.pos = pos;
                    self.view().setBigUint64( newOffsetPtr, BigInt( pos ), true );
                    return ERRNO_SUCCESS;
                },

                fd_close: ( fd ) => {
                    if ( !self.fdMap.has( fd ) ) {
                        return ERRNO_BADF;
                    }
                    self.fdMap.delete( fd );
                    return ERRNO_SUCCESS;
                },
                fd_renumber: ( from, to ) => {
                    let info = self.fdMap.get( from );
                    if ( !info || !self.fdMap.has( to ) ) {
                        return ERRNO_BADF;
                    }
                    self.fdMap.set( to, info );
                    self.fdMap.delete( from );
                    return ERRNO_SUCCESS;
                },

                path_open: ( dirFd, dirFlags, pathAddr, pathLen, oflags,
                             rightsBase, rightsInheriting, fdflags, fdPtr ) => {
                    let path = self.resolve( dirFd, pathAddr, pathLen );
                    if ( path == null ) {
                        return ERRNO_BADF;
                    }
                    let info;
                    let file = self.fs.path2file.get( path );
                    if ( file ) {
                        if ( ( oflags & OFLAGS_CREAT ) && ( oflags & OFLAGS_EXCL ) ) {
                            return ERRNO_EXIST;
                        }
                        if ( oflags & OFLAGS_DIRECTORY ) {
                            return ERRNO_NOTDIR;
                        }
                        if ( oflags & OFLAGS_TRUNC ) {
                            file.data = new Uint8Array( 0 );
                            file.mtime = Date.now() / 1000;
                        }
                        info = { kind: "file", path: path, pos: 0 };
                    } else if ( self.fs.isDir( path ) ) {
                        if ( oflags & OFLAGS_CREAT ) {
                            return ERRNO_ISDIR;
                        }
                        info = { kind: "dir", path: path };
                    } else if ( oflags & OFLAGS_CREAT ) {
                        if ( oflags & OFLAGS_DIRECTORY ) {
                            return ERRNO_INVAL;
                        }
                        self.fs.path2file.set(
                            path, { data: new Uint8Array( 0 ), mtime: Date.now() / 1000 } );
                        info = { kind: "file", path: path, pos: 0 };
                    } else {
                        return ERRNO_NOENT;
                    }
                    info.append = ( fdflags & FDFLAGS_APPEND ) != 0;
                    let fd = self.nextFd++;
                    self.fdMap.set( fd, info );
                    self.view().setUint32( fdPtr, fd, true );
                    return ERRNO_SUCCESS;
                },

                path_filestat_get: ( dirFd, flags, pathAddr, pathLen, buf ) => {
                    let path = self.resolve( dirFd, pathAddr, pathLen );
                    if ( path == null ) {
                        return ERRNO_BADF;
                    }
                    let file = self.fs.path2file.get( path );
                    if ( file ) {
                        self.putFilestat( buf, FILETYPE_REGULAR_FILE, file.data.length, file.mtime );
                    } else if ( self.fs.isDir( path ) ) {
                        self.putFilestat( buf, FILETYPE_DIRECTORY, 0, 0 );
                    } else {
                        return ERRNO_NOENT;
                    }
                    return ERRNO_SUCCESS;
                },

                path_remove_directory: ( dirFd, pathAddr, pathLen ) => {
                    let path = self.resolve( dirFd, pathAddr, pathLen );
                    if ( path == null ) {
                        return ERRNO_BADF;
                    }
                    if ( self.fs.path2file.has( path ) ) {
                        return ERRNO_NOTDIR;
                    }
                    // 空のディレクトリは持たないので、ファイルがあれば空ではない
                    return self.fs.isDir( path ) ? ERRNO_NOTEMPTY : ERRNO_NOENT;
                },
                path_unlink_file: ( dirFd, pathAddr, pathLen ) => {
                    let path = self.resolve( dirFd, pathAddr, pathLen );
                    if ( path == null ) {
                        return ERRNO_BADF;
                    }
                    if ( !self.fs.path2file.delete( path ) ) {
                        return self.fs.isDir( path ) ? ERRNO_ISDIR : ERRNO_NOENT;
                    }
                    return ERRNO_SUCCESS;
                },
                path_rename: ( srcFd, srcAddr, srcLen, dstFd, dstAddr, dstLen ) => {
                    let src = self.resolve( srcFd, srcAddr, srcLen );
                    let dst = self.resolve( dstFd, dstAddr, dstLen );
                    if ( src == null || dst == null ) {
                        return ERRNO_BADF;
                    }
                    let file = self.fs.path2file.get( src );
                    if ( !file ) {
                        return ERRNO_NOENT;
                    }
                    self.fs.path2file.delete( src );
                    self.fs.path2file.set( dst, file );
                    return ERRNO_SUCCESS;
                },

                proc_exit: ( code ) => {
                    throw new ExitError( code );
                },
            };
        }
    }

    /**
       変換した wasm と C のランタイムの、コンパイル済みのモジュール。
       実行 (run) のたびに instance を作るので、状態は実行ごとに初期化される。
    */
    class Program {
        /**
           @param module 変換した wasm の WebAssembly.Module
           @param rtModule C のランタイムの WebAssembly.Module
        */
        constructor( module, rtModule ) {
            this.module = module;
            this.rtModule = rtModule;
        }

        /**
           実行する。

           @param args コマンドの引数 (先頭はコマンド名)
           @param fs MemFS
           @return { code: 終了コード, stdout: 標準出力, stderr: 標準エラー,
                     output: 標準出力と標準エラーを出力の順に合わせたもの }
        */
        async run( args, fs ) {
            let chunkList = { 1: [], 2: [], all: [] };
            let write = ( fd, bytes ) => {
                chunkList[ fd == 2 ? 2 : 1 ].push( bytes );
                chunkList.all.push( bytes );
            };
            let wasi = new Wasi( args, {}, fs, write );

            let mainExports = null;
            let rtExports = null;
            const rtImports = {
                wasi_snapshot_preview1: wasi.getImports(),
                lnsmain: { main: () => mainExports.main() },
                lnsjs: {
                    // io.popen はブラウザでは使えない
                    popen: () => -1,
                    popen_data: () => {},
                },
            };
            // Lua の値 ($LuaVal) が GC で回収された時に、Lua の registry の登録を解除する
            const luaValRegistry = new FinalizationRegistry( (ref) => {
                if ( rtExports ) {
                    rtExports.lnsl_unref( ref );
                }
            } );

            let rtInstance = await WebAssembly.instantiate( this.rtModule, rtImports );
            rtExports = rtInstance.exports;
            wasi.setMemory( rtExports.memory );
            let instance = await WebAssembly.instantiate( this.module, {
                lnsrt: rtExports,
                lnsjs: {
                    luaval_new: ( luaVal, ref ) => {
                        luaValRegistry.register( luaVal, ref );
                    },
                },
            } );
            mainExports = instance.exports;

            let code = 0;
            try {
                rtExports._start();
            } catch ( err ) {
                if ( err instanceof ExitError ) {
                    code = err.code;
                } else {
                    // trap など。メッセージは標準エラーの後に付ける
                    write( 2, encoder.encode( "\n" + String( err ) + "\n" ) );
                    code = 1;
                }
            }
            // 実行が終わったので、以降に GC で回収された値の登録は解除しない
            rtExports = null;

            let toTxt = ( list ) => {
                let total = list.reduce( (sum, buf) => sum + buf.length, 0 );
                let all = new Uint8Array( total );
                let pos = 0;
                for ( let buf of list ) {
                    all.set( buf, pos );
                    pos += buf.length;
                }
                return decoder.decode( all );
            };
            return { code: code,
                     stdout: toTxt( chunkList[ 1 ] ),
                     stderr: toTxt( chunkList[ 2 ] ),
                     output: toTxt( chunkList.all ) };
        }
    }

    globalThis.LnsWasi = { MemFS, Wasi, Program };
})();
