var lnsFront = {
};
lnsFront.lnsOStream = null;
lnsFront.luaOStream = null;
lnsFront.setLuaCode = null;
lnsFront.getLnsLibCode = null;

lnsFront.setup = null;
lnsFront.baseUrl = null;
lnsFront.idSeed = 0;
lnsFront.id2Elements = {};
// LuneScript の lua ファイルを格納するマップ。
// modName -> lua コード
lnsFront.lnsLibCodeMap = {};
// ユーザのスクリプトを実行する時間(秒)のリミット。 この時間を越える場合はエラーさせる。
lnsFront.defaultMaxTime = 2;

// このスクリプトの baseUrl を取得する
Array.from( document.getElementsByTagName('script') ).forEach(
    function( script) {
        if ( script.src != null ) {
            if ( script.src.match( /lunescript-front\.js$/ ) ) {
                lnsFront.baseUrl = script.src.replace( RegExp( "/[^/]+$" ), "/" );
            }
        }
    });

    
lnsFront.compile = function ( frontId, maxTime ) {
    lnsFront.id2Elements[ frontId ].consoleEle.value = "";
    if ( lnsFront.id2Elements[ frontId ].luaCodeEle ) {
        lnsFront.id2Elements[ frontId ].luaCodeEle.value = "";
    }
    
    var editor = lnsFront.id2Elements[ frontId ].lnsCodeEle;

    var stackTop = fengari.lua.lua_gettop( fengari.L );

    if ( fengari.lauxlib.luaL_loadstring(
    	fengari.L, fengari.to_luastring( lnsFront.lnsLibCodeMap[ "lns" ] ) ) != fengari.lua.LUA_OK )
    {
    	lnsFront.luaOStream(
            frontId,
            fengari.to_jsstring( fengari.lua.lua_tostring( fengari.L, -1 ) )  + "\n" );
    }
    else {
        if ( typeof maxTime != "number" || maxTime > 10 ) {
            maxTime = lnsFront.defaultMaxTime;
        }
	fengari.lua.lua_pushinteger( fengari.L, frontId );
	fengari.lua.lua_pushinteger( fengari.L, maxTime );
	fengari.lua.lua_pushstring( fengari.L, fengari.to_luastring( editor.value ) );
    	if ( fengari.lua.lua_pcall( fengari.L, 3, 0, 0 ) != fengari.lua.LUA_OK ) {
            let result = fengari.lua.lua_tostring( fengari.L, -1 );
            if ( result != null ) {
    	        lnsFront.luaOStream( frontId, fengari.to_jsstring( result ) + "\n" );
            }
	}
        // hook を解除する
        fengari.lua.lua_sethook( fengari.L, null, 0, 0 );
    }

    fengari.lua.lua_settop( fengari.L, stackTop );

    lnsFront.luaOStream( frontId, "------\n" );
    lnsFront.luaOStream( frontId, "end" );
};

// modName で指定されたモジュールのコードを返す。
// lua コードからコールされる。
lnsFront.getLnsLibCode = function( frontId, modName ) {
    if ( lnsFront.lnsLibCodeMap[ modName ] ) {
	return lnsFront.lnsLibCodeMap[ modName ];
    }
    return "";
};

// LuneScript の lua ファイルを読み込み、lnsLibCodeMap に格納する
lnsFront.loadLnsLibCode = function( frontId, modName, path ) {
    var fileReq = new XMLHttpRequest();
    fileReq.addEventListener("load", function( event ) {
    	lnsFront.lnsLibCodeMap[ modName ] = fileReq.response;
	if ( lnsFront.isReadyLnsLibCode() ) {
	    lnsFront.compile( frontId );
	}
    });
    fileReq.open( "GET", lnsFront.baseUrl + path );
    fileReq.send();
}

// LuneScript の 全ての lua ファイルを読み込み済みか確認する
lnsFront.isReadyLnsLibCode = function() {
    var ready = true;
    Object.keys(lnsFront.lnsLibCodeMap).forEach( function( key ) {
	if ( !lnsFront.lnsLibCodeMap[ key ] || lnsFront.lnsLibCodeMap[ key ] == "" ) {
	    ready = false;
	}
    });
    return ready;
}

lnsFront.preloadLnsCode = function( frontId ) {
    // LuneScript の lua ファイルを読み込んでおくために、
    // lunescript-main-1.rockspec から全ファイル構成を取得する
    var xmlReq = new XMLHttpRequest();
    xmlReq.addEventListener("load", function( event ) {
    	const regexp = RegExp( '(lune.base.\\w+).*"src/(lune/base/[\\w\.]+)"', 'g' );

    	lnsFront.lnsLibCodeMap[ "lns" ] = false;
    	for ( match of xmlReq.response.matchAll( regexp ) ) {
    	    var path = match[2];
	    var module = match[1];
    	    lnsFront.lnsLibCodeMap[ module ] = false;
    	};

	lnsFront.loadLnsLibCode( frontId, "lns", "lns.lua" );
	// loadLnsLibCode する前に、lnsLibCodeMap をセットしておく
    	for ( match of xmlReq.response.matchAll( regexp ) ) {
    	    var path = match[2];
	    var module = match[1];
	    lnsFront.loadLnsLibCode( frontId, module, path );
    	};
    });
    xmlReq.open( "GET", lnsFront.baseUrl + "lunescript-main-1.rockspec");
    xmlReq.send();
}

lnsFront.setup = function( consoleId, luaCodeId, lnsCodeId, executeId ) {

    lnsFront.idSeed++;
    var frontId = lnsFront.idSeed;
    
    var elements = {};
    lnsFront.id2Elements[ frontId ] = elements;
    elements.consoleEle = document.getElementById( consoleId );
    elements.luaCodeEle = document.getElementById( luaCodeId );
    elements.lnsCodeEle = document.getElementById( lnsCodeId );
    elements.executeEle = document.getElementById( executeId );
    
    if ( frontId == 1 ) {
        elements.consoleEle.value = "loading...";
        setTimeout( function() {
            if ( window.fengari == null ) {
                // fengari がロードされていない場合はロードする
                var script = document.createElement( "script" );
                script.type = "text/javascript";
                script.src = lnsFront.baseUrl + "fengari-web.js";
                script.addEventListener( "load", function() {
                    lnsFront.preloadLnsCode( 1 );
                });
                document.head.appendChild( script );
            }
            else {
                lnsFront.preloadLnsCode( 1 );
            }
        }, 100 );
    }


    
    lnsFront.lnsOStream = function( id, txt ) {
        lnsFront.id2Elements[ id ].consoleEle.value += txt;
    };
    lnsFront.luaOStream = function( id, txt ) {
        lnsFront.id2Elements[ id ].consoleEle.value += txt;
    };
    lnsFront.setLuaCode = function( id, code ) {
        if ( lnsFront.id2Elements[ id ].luaCodeEle ) {
            lnsFront.id2Elements[ id ].luaCodeEle.value = code;
        }
    };
    if ( elements.executeEle ) {
        elements.executeEle.onclick = function() {
	    if ( lnsFront.isReadyLnsLibCode() ) {
	        lnsFront.compile( frontId );
	    }
	    else {
	        alert( "not ready" );
	    }
        };
    }
    
    
    var url = new URL( document.location );
    var urlSearch = new URLSearchParams( url.search );
    var console = lnsFront.id2Elements[ frontId ].consoleEle;
    if ( urlSearch.has( "param") ) {
        elements.lnsCodeEle.value = urlSearch.get( "param");
    }

    if ( frontId != 1 ) {
        lnsFront.compile( frontId );
    }

    return frontId;
};
