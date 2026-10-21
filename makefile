LNS_DIR=oss/LuneScript

ifneq "$(wildcard Makefile.local)" ""
include Makefile.local
endif


help:
	@echo make help
	@echo make build
	@echo make build-direct-wasm [DIRECT_LNSC=lnsc]

build:
	(cd $(LNS_DIR) && git reset --hard remotes/origin/master)
	(cd $(LNS_DIR) && git checkout master && git pull)
#	(cd $(LNS_DIR) && git pull)
ifdef QUIC
	make -C $(LNS_DIR)/src build-wasm-quick
else
	make -C $(LNS_DIR)/src build-wasm
endif
	cp $(LNS_DIR)/src/lnsc.wasm for_wasm/
	zip for_wasm/lnsc.zip for_wasm/lnsc.wasm
# copy 'go/wasm_exec.js'
# because go's wasm needs the wasm_exec.js for the go version that built the module.
	cp $(shell go env GOROOT)/misc/wasm/wasm_exec.js oss/go/wasm_exec.js


get_submodule:
	git submodule update --init --recursive


# direct wasm 版 (go を経由せずに wasm (WasmGC) に変換した lnsc) を for_direct_wasm に作る。
# $(LNS_DIR) の LuneScript をそのまま使う (git の操作はしない)。
#  - lnsc.wasm: lnsc (lune/base/front.lns を -langWasm で変換)
#  - indent.wasm: インデントの計算 (tools/formatter と for_direct_wasm/indent.lns を -langWasm で変換)
#  - lnslua.wasm: C のランタイムと Lua (make -C $(LNS_DIR)/src wasm-lua。wasi-sdk が必要)
# 変換には、-langWasm に対応した lnsc (DIRECT_LNSC。デフォルトは $(LNS_DIR)/src/lnsc) を使う。
# 生成した wasm は gzip して置く (worker が DecompressionStream で展開する)。
DIRECT_LNSC=$(abspath $(LNS_DIR)/src/lnsc)
DIRECT_WORK=$(abspath for_direct_wasm/work)
DIRECT_LNS_DIR=$(abspath $(LNS_DIR))
build-direct-wasm:
	$(MAKE) -C $(LNS_DIR)/src wasm-lua
	rm -rf $(DIRECT_WORK)
	mkdir -p $(DIRECT_WORK)/lnsc $(DIRECT_WORK)/indent
	rsync -a --include='*.lua' --include='*.lns' --exclude='*.*' $(DIRECT_LNS_DIR)/src/lune $(DIRECT_WORK)/lnsc
	(cd $(DIRECT_WORK)/lnsc; env -u LUA_PATH $(DIRECT_LNSC) lune/base/front.lns SAVE . -langWasm --uptodate forceAll > /dev/null)
	cp $(DIRECT_WORK)/lnsc/lune/base/front.wasm $(DIRECT_WORK)/lnsc.wasm
# formatter は lnsc のモジュールを go/github:... の形で import しているが、
# wasm には AST からまとめる必要があるので、lune.base.〜 の import にする
	rsync -a --include='*.lua' --include='*.lns' --exclude='*.*' $(DIRECT_LNS_DIR)/src/lune $(DIRECT_WORK)/indent
	mkdir -p $(DIRECT_WORK)/indent/lns
	cp $(DIRECT_LNS_DIR)/tools/formatter/lns/*.lns $(DIRECT_WORK)/indent/lns
	sed -i 's@go/github:com\.ifritJP\.LuneScript\.src\.@@' $(DIRECT_WORK)/indent/lns/*.lns
	cp for_direct_wasm/indent.lns $(DIRECT_WORK)/indent
	(cd $(DIRECT_WORK)/indent; env -u LUA_PATH $(DIRECT_LNSC) indent.lns SAVE . -langWasm --uptodate forceAll > /dev/null)
	cp $(DIRECT_WORK)/indent/indent.wasm $(DIRECT_WORK)/indent.wasm
	cp $(DIRECT_LNS_DIR)/src/work/wasm-lua/lnslua.wasm $(DIRECT_WORK)
	for name in lnsc indent lnslua; do \
		gzip -9 -n -c $(DIRECT_WORK)/$$name.wasm > for_direct_wasm/$$name.wasm.gz; \
	done
	rm -rf $(DIRECT_WORK)
	ls -l for_direct_wasm/*.wasm.gz
